"""Contractele de date. Oglindesc schemele Zod din ``src/schemas/telemetry.ts``."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1

QualityState = Literal["valid", "stale", "unavailable", "sensor_error"]
Severity = Literal["critical", "warning", "info"]


class TelemetryMessage(BaseModel):
    """Mesajul brut trimis de mașină, conform docs/recomandari-arhitectura."""

    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(ge=1)
    vehicle_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    timestamp: datetime
    sequence: int = Field(ge=0)
    signals: dict[str, float]


class SignalQuality(BaseModel):
    """Starea de calitate a unui semnal, calculată pe server."""

    state: QualityState
    # Vechimea ultimei valori valide, în milisecunde, raportată la ceasul serverului.
    age_ms: int
    value: float | None = None


class Alarm(BaseModel):
    id: str
    key: str
    label: str
    severity: Severity
    message: str
    signal_key: str | None = None
    value: float | None = None
    threshold: float | None = None
    raised_at: datetime
    cleared_at: datetime | None = None
    active: bool = True


class StreamStats(BaseModel):
    """Sănătatea fluxului - cerința 9 din documentul de arhitectură."""

    received: int = 0
    dropped: int = 0
    duplicates: int = 0
    out_of_order: int = 0
    invalid: int = 0
    effective_hz: float = 0.0
    last_sequence: int | None = None
    # Diferența dintre ceasul mașinii și ceasul serverului (ms).
    clock_offset_ms: int = 0


class Sample(BaseModel):
    """Un eșantion normalizat, așa cum îl consumă frontendul."""

    timestamp: datetime
    server_received_at: datetime
    sequence: int
    signals: dict[str, float]


class TelemetryFrame(BaseModel):
    """Cadrul emis periodic pe WebSocket."""

    type: Literal["frame"] = "frame"
    vehicle_id: str | None = None
    session_id: str | None = None
    latest: Sample | None = None
    quality: dict[str, SignalQuality] = Field(default_factory=dict)
    alarms: list[Alarm] = Field(default_factory=list)
    stats: StreamStats = Field(default_factory=StreamStats)
    server_time: datetime
    recording_session_id: str | None = None


class SnapshotFrame(TelemetryFrame):
    """Primul cadru trimis unui client nou: stare completă + istoric scurt."""

    type: Literal["snapshot"] = "snapshot"  # type: ignore[assignment]
    history: list[Sample] = Field(default_factory=list)


class SessionInfo(BaseModel):
    id: str
    vehicle_id: str
    started_at: datetime
    ended_at: datetime | None = None
    sample_count: int = 0
    alarm_count: int = 0
    note: str = ""


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    schema_version: int = SCHEMA_VERSION
    uptime_s: float
    ingest: dict[str, bool]
    last_message_at: datetime | None
    stats: StreamStats
    recording_session_id: str | None
