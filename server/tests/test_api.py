"""Verificări end-to-end pe API: ingest HTTP, catalog, WebSocket, sesiuni."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.signals import BY_KEY


def payload(sequence: int, **signals: float) -> dict:
    return {
        "schema_version": 1,
        "vehicle_id": "solar-car-01",
        "session_id": "api-test",
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "sequence": sequence,
        "signals": signals or {"vehicle_speed_kph": 55.0},
    }


@pytest.fixture
def client(tmp_path):
    """Fiecare test primește o magistrală și o bază de date proaspete."""
    from app import runtime as runtime_module
    from app.core.bus import TelemetryBus
    from app.core.sessions import SessionRecorder
    from app.storage.sqlite import SqliteStorage

    current = runtime_module.runtime
    current.bus = TelemetryBus()
    current.storage = SqliteStorage(str(tmp_path / "api.db"))
    current.recorder = SessionRecorder(current.bus, current.storage)

    with TestClient(app) as test_client:
        yield test_client


def test_catalogul_de_semnale(client: TestClient) -> None:
    response = client.get("/api/v1/signals")
    assert response.status_code == 200

    body = response.json()
    keys = {signal["key"] for signal in body["signals"]}
    assert keys == set(BY_KEY)
    assert {"key": "energy", "label": "Energie și baterie"} in body["groups"]


def test_ingest_si_health(client: TestClient) -> None:
    assert client.post("/api/v1/telemetry", json=payload(1)).status_code == 202
    assert client.post("/api/v1/telemetry", json=[payload(2), payload(3)]).status_code == 202

    health = client.get("/api/v1/health").json()
    assert health["stats"]["received"] == 3
    assert health["status"] == "ok"


def test_ingest_respinge_versiune_gresita_de_schema(client: TestClient) -> None:
    body = payload(1)
    body["schema_version"] = 99

    response = client.post("/api/v1/telemetry", json=body)
    assert response.json() == {"accepted": 0, "rejected": 1}


def test_ingest_respinge_mesaj_malformat(client: TestClient) -> None:
    response = client.post("/api/v1/telemetry", json={"vehicle_id": "x"})
    assert response.status_code == 422


def test_websocket_trimite_snapshot_apoi_cadre(client: TestClient) -> None:
    client.post("/api/v1/telemetry", json=payload(1, vehicle_speed_kph=61.0))

    with client.websocket_connect("/ws/telemetry", subprotocols=["telemetry.v1"]) as socket:
        snapshot = json.loads(socket.receive_text())
        assert snapshot["type"] == "snapshot"
        assert snapshot["latest"]["signals"]["vehicle_speed_kph"] == 61.0
        assert len(snapshot["history"]) == 1
        assert snapshot["quality"]["vehicle_speed_kph"]["state"] == "valid"
        assert snapshot["quality"]["motor_temp_c"]["state"] == "unavailable"

        frame = json.loads(socket.receive_text())
        assert frame["type"] == "frame"
        assert frame["stats"]["received"] == 1


def test_inregistrarea_unei_sesiuni(client: TestClient) -> None:
    client.post("/api/v1/telemetry", json=payload(1))

    started = client.post("/api/v1/sessions/start", params={"note": "tur de probă"}).json()
    assert started["vehicle_id"] == "solar-car-01"

    for sequence in range(2, 12):
        client.post("/api/v1/telemetry", json=payload(sequence))

    stopped = client.post("/api/v1/sessions/stop").json()
    assert stopped["id"] == started["id"]
    assert stopped["ended_at"] is not None

    sessions = client.get("/api/v1/sessions").json()
    assert any(session["id"] == started["id"] for session in sessions)

    export = client.get(f"/api/v1/sessions/{started['id']}/export.csv")
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")
    assert "vehicle_speed_kph" in export.text.splitlines()[0]


def test_oprirea_fara_inregistrare_activa(client: TestClient) -> None:
    assert client.post("/api/v1/sessions/stop").status_code == 409


def test_history_din_buffer(client: TestClient) -> None:
    for sequence in range(1, 6):
        client.post("/api/v1/telemetry", json=payload(sequence))

    history = client.get("/api/v1/history", params={"limit": 3}).json()
    assert [sample["sequence"] for sample in history] == [3, 4, 5]
