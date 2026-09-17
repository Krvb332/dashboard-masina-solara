"""Teste de performanță backend, rulate explicit cu ``-m perf``.

Nu au praguri stricte de trecere: scopul lor este să măsoare, la ritmul real
de telemetrie, cât costă fiecare pas pe mașina pe care rulează, și să
tipărească cifrele pentru raportul de audit. Pică doar dacă un pas nu se
termină sau produce rezultate greșite.
"""

from __future__ import annotations

import json
import random
import time
from datetime import UTC, datetime, timedelta

import pytest

from app.api.ws import _build_frame
from app.core.alarms import AlarmEngine
from app.core.bus import TelemetryBus
from app.runtime import runtime
from app.schemas import Sample, TelemetryMessage
from app.storage.sqlite import SqliteStorage
from simulator.simulate import CarState, step

pytestmark = pytest.mark.perf

# O cursă de opt ore la 10 Hz.
RACE_HOURS = 8
RACE_SAMPLES = RACE_HOURS * 3600 * 10


def _messages(count: int, hz: float) -> list[TelemetryMessage]:
    state = CarState()
    rng = random.Random(7)
    start = datetime(2026, 9, 15, 9, 0, tzinfo=UTC)
    messages: list[TelemetryMessage] = []
    for index in range(count):
        signals = step(state, 1.0 / hz, rng)
        messages.append(
            TelemetryMessage(
                schema_version=1,
                vehicle_id="solar-car-01",
                session_id="perf",
                timestamp=start + timedelta(seconds=index / hz),
                sequence=index + 1,
                signals=signals,
            )
        )
    return messages


def _report(label: str, **values: object) -> None:
    parts = ", ".join(f"{key}={value}" for key, value in values.items())
    print(f"\n[perf {label}] {parts}")


# --- S2: ingest -------------------------------------------------------------


def test_s2_ingest_la_100_hz() -> None:
    count = 60_000  # zece minute la 100 Hz
    messages = _messages(count, 100.0)
    bus = TelemetryBus()

    started = time.perf_counter()
    for message in messages:
        bus.ingest(message)
    elapsed = time.perf_counter() - started

    per_message_us = elapsed / count * 1e6
    _report(
        "S2 ingest",
        mesaje=count,
        semnale_per_mesaj=len(messages[0].signals),
        total_s=f"{elapsed:.3f}",
        per_mesaj_us=f"{per_message_us:.1f}",
        mesaje_pe_s=f"{count / elapsed:,.0f}",
        cpu_la_100hz_pct=f"{per_message_us * 100 / 1e4:.2f}",
    )
    assert bus.stats.received == count
    assert bus.stats.dropped == 0


# --- S1: cadrul WebSocket și alarmele ---------------------------------------


def test_s1_construirea_si_serializarea_cadrului_ws() -> None:
    original = runtime.bus
    try:
        runtime.bus = TelemetryBus()
        for message in _messages(700, 10.0):
            runtime.bus.ingest(message)

        iterations = 300
        started = time.perf_counter()
        for _ in range(iterations):
            frame = _build_frame()
        build_ms = (time.perf_counter() - started) / iterations * 1e3

        started = time.perf_counter()
        for _ in range(iterations):
            raw = frame.model_dump_json()
        dump_ms = (time.perf_counter() - started) / iterations * 1e3

        started = time.perf_counter()
        for _ in range(iterations):
            runtime.bus.quality()
        quality_ms = (time.perf_counter() - started) / iterations * 1e3

        per_client_ms = build_ms + dump_ms
        _report(
            "S1 cadru WS",
            dimensiune_KB=f"{len(raw) / 1024:.1f}",
            quality_ms=f"{quality_ms:.3f}",
            build_frame_ms=f"{build_ms:.3f}",
            model_dump_json_ms=f"{dump_ms:.3f}",
            per_client_per_cadru_ms=f"{per_client_ms:.3f}",
            cpu_1_client_10hz_pct=f"{per_client_ms * 10 / 10:.2f}",
            cpu_5_clienti_10hz_pct=f"{per_client_ms * 10 * 5 / 10:.2f}",
            cpu_20_clienti_10hz_pct=f"{per_client_ms * 10 * 20 / 10:.2f}",
        )
        assert json.loads(raw)["latest"] is not None
    finally:
        runtime.bus = original


def test_s1_evaluarea_alarmelor() -> None:
    bus = TelemetryBus()
    for message in _messages(50, 10.0):
        bus.ingest(message)
    engine = AlarmEngine()

    iterations = 300
    started = time.perf_counter()
    for _ in range(iterations):
        engine.evaluate(bus)
    per_tick_ms = (time.perf_counter() - started) / iterations * 1e3

    _report(
        "S1 alarme",
        reguli=len(engine._rules),  # noqa: SLF001 - măsurătoare
        evaluate_ms=f"{per_tick_ms:.3f}",
        cpu_la_5hz_pct=f"{per_tick_ms * 5 / 10:.2f}",
    )
    assert per_tick_ms > 0


# --- S4: backfill din buffer -------------------------------------------------


def test_s4_history_din_buffer_plin() -> None:
    bus = TelemetryBus(buffer_size=6000)
    messages = _messages(6000, 10.0)
    for message in messages:
        bus.ingest(message)
    since = bus.latest.server_received_at - timedelta(seconds=30)  # type: ignore[union-attr]

    iterations = 50
    started = time.perf_counter()
    for _ in range(iterations):
        selected = bus.history(since=since, limit=3000)
    since_ms = (time.perf_counter() - started) / iterations * 1e3

    started = time.perf_counter()
    for _ in range(iterations):
        bus.history(limit=600)
    plain_ms = (time.perf_counter() - started) / iterations * 1e3

    _report(
        "S4 history",
        buffer=6000,
        history_since_30s_ms=f"{since_ms:.3f}",
        selectate=len(selected),
        history_limit_600_ms=f"{plain_ms:.3f}",
    )
    assert 0 < len(selected) <= 3000


# --- S3: SQLite pe o cursă de opt ore ----------------------------------------


@pytest.fixture
async def storage(tmp_path):
    store = SqliteStorage(str(tmp_path / "perf.db"))
    await store.connect()
    yield store
    await store.close()


async def test_s3_sqlite_pe_o_cursa_de_opt_ore(storage: SqliteStorage) -> None:
    start = datetime(2026, 9, 15, 9, 0, tzinfo=UTC)
    await storage.create_session("race", "solar-car-01", start)

    # Semnalele unui eșantion real, reluate cu timpi diferiți: costul e dat de
    # numărul de rânduri și de dimensiunea JSON-ului, nu de valori.
    template = _messages(50, 10.0)
    batch = 100
    written = 0
    started = time.perf_counter()
    while written < RACE_SAMPLES:
        samples = [
            Sample(
                timestamp=start + timedelta(seconds=(written + offset) / 10),
                server_received_at=start + timedelta(seconds=(written + offset) / 10 + 0.12),
                sequence=written + offset,
                signals=template[(written + offset) % len(template)].signals,
            )
            for offset in range(batch)
        ]
        await storage.write_samples("race", samples)
        written += batch
    write_s = time.perf_counter() - started

    started = time.perf_counter()
    first = await storage.read_samples("race", limit=20_000, offset=0)
    first_page_s = time.perf_counter() - started

    started = time.perf_counter()
    last = await storage.read_samples("race", limit=20_000, offset=RACE_SAMPLES - 20_000)
    last_page_s = time.perf_counter() - started

    started = time.perf_counter()
    sessions = await storage.list_sessions(50)
    list_s = time.perf_counter() - started

    started = time.perf_counter()
    size = 0
    async for chunk in storage.iter_csv("race"):
        size += len(chunk.encode("utf-8"))
    csv_s = time.perf_counter() - started

    db_bytes = sum(
        path.stat().st_size for path in storage._path.parent.glob("perf.db*")  # noqa: SLF001
    )
    _report(
        "S3 sqlite",
        randuri=RACE_SAMPLES,
        scriere_s=f"{write_s:.2f}",
        scriere_randuri_pe_s=f"{RACE_SAMPLES / write_s:,.0f}",
        scriere_per_lot_100_ms=f"{write_s / (RACE_SAMPLES / batch) * 1e3:.2f}",
        db_MB=f"{db_bytes / 1e6:.1f}",
        read_prima_pagina_20000_s=f"{first_page_s:.2f}",
        read_ultima_pagina_20000_s=f"{last_page_s:.2f}",
        list_sessions_ms=f"{list_s * 1e3:.1f}",
        csv_MB=f"{size / 1e6:.1f}",
        csv_s=f"{csv_s:.2f}",
        csv_MB_pe_s=f"{size / 1e6 / csv_s:.1f}",
    )
    assert len(first) == 20_000
    assert len(last) == 20_000
    assert sessions[0].sample_count == RACE_SAMPLES
