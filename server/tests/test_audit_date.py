"""Audit de corectitudine a datelor pe server: export CSV, NaN, ordinea timpilor.

Testele marcate ``xfail(strict=True)`` documentează defecte confirmate: pică pe
implementarea actuală și vor deveni erori („XPASS") în momentul în care defectul
este reparat, ca să nu rămână marcate degeaba.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime, timedelta

import pytest

from app.api.ws import _build_frame
from app.core.bus import TelemetryBus
from app.runtime import runtime
from app.schemas import Sample, TelemetryMessage
from app.storage.sqlite import SqliteStorage


@pytest.fixture
async def storage(tmp_path):
    store = SqliteStorage(str(tmp_path / "audit.db"))
    await store.connect()
    yield store
    await store.close()


def _reject_constant(name: str) -> float:
    raise ValueError(f"JSON strict nu permite constanta {name}")


async def _csv_rows(storage: SqliteStorage, session_id: str) -> list[dict[str, str]]:
    text = "".join([chunk async for chunk in storage.iter_csv(session_id)])
    lines = [line for line in text.splitlines() if line]
    header = lines[0].split(",")
    return [dict(zip(header, line.split(","), strict=True)) for line in lines[1:]]


# --- B1: precizia exportului CSV -------------------------------------------


@pytest.mark.xfail(strict=True, reason="B1: iter_csv formatează cu :g (6 cifre semnificative)")
async def test_b1_exportul_csv_pastreaza_coordonatele_gps(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("csv", "solar-car-01", start)
    sample = Sample(
        timestamp=start,
        server_received_at=start,
        sequence=1,
        signals={"gps_latitude_deg": 46.7712345678, "gps_longitude_deg": 23.6236789012},
    )
    await storage.write_samples("csv", [sample])

    rows = await _csv_rows(storage, "csv")
    latitude = float(rows[0]["gps_latitude_deg"])
    longitude = float(rows[0]["gps_longitude_deg"])
    # 1e-6 grade ≈ 11 cm: sub atât exportul nu deformează traseul.
    assert abs(latitude - 46.7712345678) < 1e-6
    assert abs(longitude - 23.6236789012) < 1e-6


@pytest.mark.xfail(strict=True, reason="B1: iter_csv formatează cu :g (6 cifre semnificative)")
async def test_b1_exportul_csv_pastreaza_contoarele_mari(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("csv2", "solar-car-01", start)
    sample = Sample(
        timestamp=start,
        server_received_at=start,
        sequence=1,
        signals={"energy_consumed_wh": 123456.789, "teensy_uptime_s": 28800.25},
    )
    await storage.write_samples("csv2", [sample])

    rows = await _csv_rows(storage, "csv2")
    assert float(rows[0]["energy_consumed_wh"]) == pytest.approx(123456.789, abs=0.01)
    assert float(rows[0]["teensy_uptime_s"]) == pytest.approx(28800.25, abs=0.01)


async def test_b1_masuratoare_eroare_csv(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("csv3", "solar-car-01", start)
    latitude = 46.7712345678
    await storage.write_samples(
        "csv3",
        [
            Sample(
                timestamp=start,
                server_received_at=start,
                sequence=1,
                signals={"gps_latitude_deg": latitude, "energy_consumed_wh": 123456.789},
            )
        ],
    )
    rows = await _csv_rows(storage, "csv3")
    exported = float(rows[0]["gps_latitude_deg"])
    meters = abs(exported - latitude) * 111_320
    print(
        f"\n[audit B1] latitudine {latitude} → CSV {rows[0]['gps_latitude_deg']} "
        f"(eroare {meters:.2f} m); energie 123456.789 Wh → CSV {rows[0]['energy_consumed_wh']}"
    )
    assert exported > 0


# --- B2: NaN în semnale --------------------------------------------------------


def _message_with_nan() -> TelemetryMessage:
    return TelemetryMessage.model_validate_json(
        '{"schema_version":1,"vehicle_id":"solar-car-01","session_id":"nan",'
        '"timestamp":"2026-09-15T09:00:00Z","sequence":1,'
        '"signals":{"vehicle_speed_kph":42.0,"motor_temp_c":NaN}}'
    )


def test_b2_serverul_accepta_nan_si_il_marcheaza_eroare_de_senzor() -> None:
    bus = TelemetryBus()
    bus.ingest(_message_with_nan())
    quality = bus.quality()
    assert math.isnan(quality["motor_temp_c"].value)  # type: ignore[arg-type]
    assert quality["motor_temp_c"].state == "sensor_error"
    assert quality["vehicle_speed_kph"].state == "valid"


@pytest.mark.xfail(strict=True, reason="B2: NaN se serializează ca null în latest.signals, iar contractul Zod cere number")
def test_b2_cadrul_ws_nu_contine_null_in_semnalele_ultimului_esantion() -> None:
    original = runtime.bus
    try:
        runtime.bus = TelemetryBus()
        runtime.bus.ingest(_message_with_nan())
        payload = json.loads(_build_frame().model_dump_json())
    finally:
        runtime.bus = original

    signals = payload["latest"]["signals"]
    # Contractul frontendului (`sampleSchema.signals: z.record(z.string(), z.number())`)
    # respinge tot cadrul dacă o valoare este null.
    assert all(isinstance(value, (int, float)) for value in signals.values()), signals


def test_b2_masuratoare_ce_ajunge_in_browser() -> None:
    original = runtime.bus
    try:
        runtime.bus = TelemetryBus()
        runtime.bus.ingest(_message_with_nan())
        raw = _build_frame().model_dump_json()
    finally:
        runtime.bus = original
    payload = json.loads(raw)
    print(
        f"\n[audit B2] latest.signals după un NaN: {payload['latest']['signals']}; "
        f"quality.motor_temp_c: {payload['quality']['motor_temp_c']}"
    )
    assert "motor_temp_c" in payload["latest"]["signals"]


@pytest.mark.xfail(strict=True, reason="B2: json.dumps scrie literalul NaN, care nu este JSON valid")
async def test_b2_esantionul_cu_nan_se_stocheaza_ca_json_valid(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("nan", "solar-car-01", start)
    await storage.write_samples(
        "nan",
        [
            Sample(
                timestamp=start,
                server_received_at=start,
                sequence=1,
                signals={"vehicle_speed_kph": 42.0, "motor_temp_c": float("nan")},
            )
        ],
    )
    cursor = await storage.db.execute("SELECT signals FROM samples WHERE session_id = 'nan'")
    row = await cursor.fetchone()
    assert row is not None
    # Un parser strict (cum e JSON.parse din browser) trebuie să poată citi rândul.
    json.loads(row["signals"], parse_constant=_reject_constant)


# --- D7: ordinea eșantioanelor la replay -----------------------------------


@pytest.mark.xfail(strict=True, reason="D7: read_samples ordonează după ts (ceasul mașinii), nu după server_ts")
async def test_d7_replayul_intoarce_esantioanele_in_ordinea_receptiei(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("clock", "solar-car-01", start)

    samples: list[Sample] = []
    for index in range(20):
        received = start + timedelta(seconds=index / 10)
        # Placa repornește la al zecelea eșantion și pornește cu ceasul implicit
        # (mult în urmă), până când GPS-ul îl resincronizează. Recepția pe server
        # rămâne monotonă; ceasul mașinii sare înapoi.
        vehicle = received - (timedelta(days=3650) if index >= 10 else timedelta(0))
        samples.append(
            Sample(
                timestamp=vehicle,
                server_received_at=received,
                sequence=index,
                signals={"vehicle_speed_kph": 40.0},
            )
        )
    await storage.write_samples("clock", samples)

    read = await storage.read_samples("clock", limit=100)
    received_order = [sample.server_received_at for sample in read]
    assert received_order == sorted(received_order)
