"""Endpoint-urile REST: catalog, sănătate, sesiuni, istoric, export."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from ..auth import OperatorRole, ViewerRole
from ..runtime import runtime
from ..schemas import Alarm, HealthResponse, Sample, SessionInfo
from ..signals import catalog_payload

router = APIRouter(prefix="/api/v1", tags=["telemetry"])


@router.get("/signals")
async def get_signals() -> dict:
    """Catalogul de semnale. Frontendul își construiește interfața din el."""
    return catalog_payload()


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    age = runtime.bus.age_s()
    healthy = age is not None and age < 2.0

    return HealthResponse(
        status="ok" if healthy else "degraded",
        uptime_s=round(runtime.uptime_s, 1),
        ingest={"mqtt": runtime.mqtt_connected, "http": True},
        last_message_at=runtime.bus.last_message_at,
        stats=runtime.bus.current_stats(),
        recording_session_id=runtime.recorder.session_id,
    )


@router.get("/alarms", response_model=list[Alarm])
async def get_alarms(_: ViewerRole) -> list[Alarm]:
    return runtime.engine.active


@router.post("/alarms/{alarm_id}/ack")
async def acknowledge_alarm(alarm_id: str, _: ViewerRole) -> dict:
    if not runtime.engine.acknowledge(alarm_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alarma nu este activă.")
    return {"acknowledged": alarm_id}


# --- sesiuni --------------------------------------------------------------


@router.get("/sessions", response_model=list[SessionInfo])
async def list_sessions(_: ViewerRole, limit: int = Query(default=50, ge=1, le=500)):
    return await runtime.storage.list_sessions(limit)


@router.get("/sessions/active", response_model=SessionInfo | None)
async def active_session(_: ViewerRole) -> SessionInfo | None:
    return runtime.recorder.active_session


@router.post("/sessions/start", response_model=SessionInfo)
async def start_session(_: OperatorRole, note: str = Query(default="")) -> SessionInfo:
    return await runtime.recorder.start(note=note)


@router.post("/sessions/stop", response_model=SessionInfo | None)
async def stop_session(_: OperatorRole) -> SessionInfo | None:
    session = await runtime.recorder.stop()
    if session is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nu există o înregistrare activă.")
    return session


@router.get("/sessions/{session_id}", response_model=SessionInfo)
async def get_session(session_id: str, _: ViewerRole) -> SessionInfo:
    session = await runtime.storage.get_session(session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sesiunea nu există.")
    return session


@router.get("/sessions/{session_id}/alarms", response_model=list[Alarm])
async def session_alarms(session_id: str, _: ViewerRole) -> list[Alarm]:
    return await runtime.storage.read_alarms(session_id)


@router.get("/sessions/{session_id}/export.csv")
async def export_session(session_id: str, _: ViewerRole) -> StreamingResponse:
    session = await runtime.storage.get_session(session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sesiunea nu există.")

    return StreamingResponse(
        runtime.storage.iter_csv(session_id),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{session_id}.csv"'},
    )


# --- istoric --------------------------------------------------------------


@router.get("/history", response_model=list[Sample])
async def get_history(
    _: ViewerRole,
    session_id: str | None = None,
    since: datetime | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(default=1200, ge=1, le=20000),
    offset: int = Query(default=0, ge=0),
) -> list[Sample]:
    """Istoric pentru backfill (din buffer) sau pentru replay (din stocare).

    Fără ``session_id`` răspunde din bufferul în memorie - calea rapidă folosită
    de dashboard după o reconectare, ca graficul să nu rămână cu gol.
    """
    if session_id is None:
        return runtime.bus.history(since=since, limit=limit)

    return await runtime.storage.read_samples(
        session_id, start=start, end=end, limit=limit, offset=offset
    )
