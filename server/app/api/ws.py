"""WebSocket-ul de date live.

Mașina poate trimite la 50-100 Hz, dar browserul nu are nevoie de atât. Aici se
face *coalescing*: la fiecare tick trimitem ultima stare cunoscută, nu coada
acumulată. Un client lent rămâne în urmă cu o singură actualizare, nu cu o coadă
care crește la nesfârșit.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..auth import role_for_token
from ..config import settings
from ..core.bus import utcnow
from ..runtime import runtime
from ..schemas import SnapshotFrame, TelemetryFrame

logger = logging.getLogger("telemetry.ws")

router = APIRouter()

PROTOCOL = "telemetry.v1"
BEARER_PREFIX = "bearer."
# Câte eșantioane primește un client nou, ca graficul să nu pornească gol.
SNAPSHOT_HISTORY = 600


def _negotiate(websocket: WebSocket) -> tuple[str | None, str | None]:
    """Extrage tokenul din subprotocoale. Tokenul nu circulă prin query string."""
    offered = websocket.scope.get("subprotocols") or []
    token: str | None = None

    for protocol in offered:
        if protocol.startswith(BEARER_PREFIX):
            token = protocol[len(BEARER_PREFIX) :] or None

    selected = PROTOCOL if PROTOCOL in offered else None
    return selected, token


def _build_frame() -> TelemetryFrame:
    now = utcnow()
    return TelemetryFrame(
        vehicle_id=runtime.bus.vehicle_id,
        session_id=runtime.bus.session_id,
        latest=runtime.bus.latest,
        quality=runtime.bus.quality(now),
        alarms=runtime.engine.active,
        stats=runtime.bus.current_stats(now),
        server_time=now,
        recording_session_id=runtime.recorder.session_id,
    )


@router.websocket("/ws/telemetry")
async def telemetry_socket(websocket: WebSocket) -> None:
    selected, token = _negotiate(websocket)
    role = role_for_token(token)

    if role is None:
        await websocket.close(code=4401, reason="Token lipsă sau invalid.")
        return

    await websocket.accept(subprotocol=selected)

    reader = asyncio.create_task(_read_client(websocket), name="ws-reader")

    try:
        base = _build_frame()
        snapshot = SnapshotFrame(
            **base.model_dump(exclude={"type"}),
            history=runtime.bus.history(limit=SNAPSHOT_HISTORY),
        )
        await websocket.send_text(snapshot.model_dump_json())

        while True:
            await asyncio.sleep(settings.ws_interval_s)
            await websocket.send_text(_build_frame().model_dump_json())

    except WebSocketDisconnect:
        pass
    except (RuntimeError, ConnectionError) as error:
        logger.debug("Conexiune WebSocket închisă: %s", error)
    finally:
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader


async def _read_client(websocket: WebSocket) -> None:
    """Consumă mesajele clientului (confirmări de alarmă, ping aplicativ)."""
    while True:
        try:
            message = await websocket.receive_json()
        except (WebSocketDisconnect, RuntimeError, ValueError):
            return

        if not isinstance(message, dict):
            continue

        if message.get("type") == "ack" and isinstance(message.get("alarm_id"), str):
            runtime.engine.acknowledge(message["alarm_id"])
