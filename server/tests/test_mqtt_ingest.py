"""Decodarea mesajelor primite pe MQTT.

Nu pornim un broker aici: testăm partea care poate greși independent de rețea -
validarea payloadului și efectul asupra magistralei.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from app.core.bus import TelemetryBus
from app.ingest.mqtt import _handle_payload


@pytest.fixture(autouse=True)
def fresh_bus(monkeypatch):
    from app import runtime as runtime_module

    bus = TelemetryBus()
    monkeypatch.setattr(runtime_module.runtime, "bus", bus)
    return bus


def payload(sequence: int = 1, **signals: float) -> bytes:
    return json.dumps(
        {
            "schema_version": 1,
            "vehicle_id": "solar-car-01",
            "session_id": "mqtt-test",
            "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "sequence": sequence,
            "signals": signals or {"vehicle_speed_kph": 44.0},
        }
    ).encode()


def test_mesaj_valid_ajunge_pe_magistrala(fresh_bus: TelemetryBus) -> None:
    _handle_payload(payload(1, vehicle_speed_kph=44.0))

    assert fresh_bus.stats.received == 1
    assert fresh_bus.latest is not None
    assert fresh_bus.latest.signals["vehicle_speed_kph"] == 44.0


def test_json_malformat_este_numarat_nu_aruncat(fresh_bus: TelemetryBus) -> None:
    _handle_payload(b"{ nu este json")

    assert fresh_bus.stats.received == 0
    assert fresh_bus.stats.invalid == 1


def test_mesaj_fara_campuri_obligatorii_este_respins(fresh_bus: TelemetryBus) -> None:
    _handle_payload(json.dumps({"vehicle_id": "solar-car-01"}).encode())

    assert fresh_bus.stats.invalid == 1


def test_payload_gol_este_ignorat(fresh_bus: TelemetryBus) -> None:
    _handle_payload(None)

    assert fresh_bus.stats.received == 0
    assert fresh_bus.stats.invalid == 0


def test_gap_de_secventa_pe_mqtt(fresh_bus: TelemetryBus) -> None:
    _handle_payload(payload(1))
    _handle_payload(payload(4))

    assert fresh_bus.stats.dropped == 2
