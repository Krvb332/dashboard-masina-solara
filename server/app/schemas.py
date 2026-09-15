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


# --- vreme ----------------------------------------------------------------
#
# Contractul secțiunii meteo. Oglindește ``src/schemas/weather.ts``.
#
# Fiecare mărime este opțională prin construcție: furnizorul nu raportează toate
# câmpurile în toate zonele și la toate orele (UV-ul lipsește noaptea, rafala
# lipsește pe vânt calm). Un câmp absent rămâne ``None`` și se afișează „—".
# Nu există valoare implicită numerică nicăieri în modelele de mai jos, tocmai
# ca o lipsă să nu poată fi confundată cu o măsurătoare.

WeatherStatus = Literal["ok", "stale", "unavailable"]


class WeatherCondition(BaseModel):
    """Starea vremii în formă descriptivă, așa cum o numește furnizorul."""

    type: str | None = None
    description: str | None = None
    icon_uri: str | None = None


class WeatherMeasurements(BaseModel):
    """Mărimile numerice, toate în sistem metric după normalizare."""

    temperature_c: float | None = None
    feels_like_c: float | None = None
    dew_point_c: float | None = None
    heat_index_c: float | None = None
    wet_bulb_c: float | None = None
    relative_humidity_pct: float | None = None
    # Presiune la nivelul mării; corecția la altitudinea circuitului se face în
    # frontend, unde este cunoscută elevația GPS.
    pressure_hpa: float | None = None
    cloud_cover_pct: float | None = None
    uv_index: float | None = None
    visibility_km: float | None = None
    wind_speed_kph: float | None = None
    wind_gust_kph: float | None = None
    # Direcția DIN CARE bate vântul, în grade față de nord - convenția
    # meteorologică. Componenta pe direcția de mers se calculează din ea.
    wind_from_deg: float | None = None
    wind_cardinal: str | None = None
    precipitation_probability_pct: float | None = None
    precipitation_type: str | None = None
    precipitation_mm: float | None = None
    snow_mm: float | None = None
    thunderstorm_probability_pct: float | None = None
    is_daytime: bool | None = None


class WeatherHistory(BaseModel):
    """Ultimele 24 de ore, pentru context. Furnizate de ``currentConditions``."""

    max_temperature_c: float | None = None
    min_temperature_c: float | None = None
    temperature_change_c: float | None = None
    precipitation_mm: float | None = None


class WeatherObservation(BaseModel):
    observed_at: datetime | None = None
    time_zone: str | None = None
    condition: WeatherCondition = Field(default_factory=WeatherCondition)
    values: WeatherMeasurements = Field(default_factory=WeatherMeasurements)
    history: WeatherHistory = Field(default_factory=WeatherHistory)


class WeatherForecastHour(BaseModel):
    start_time: datetime
    end_time: datetime | None = None
    condition: WeatherCondition = Field(default_factory=WeatherCondition)
    values: WeatherMeasurements = Field(default_factory=WeatherMeasurements)


class WeatherLocation(BaseModel):
    latitude: float
    longitude: float
    # „gps" sau „configurat" - echipa trebuie să știe dacă vremea afișată este
    # a mașinii sau a unui punct fix presupus.
    source: str


class WeatherReport(BaseModel):
    """Ce primește dashboardul de la ``GET /api/v1/weather``."""

    status: WeatherStatus
    provider: str
    location: WeatherLocation | None = None
    fetched_at: datetime | None = None
    # Vechimea observației servite, în secunde. Esențială pe ``stale``.
    age_s: float | None = None
    # De ce nu este „ok". Text pentru om, afișat ca atare în interfață.
    reason: str | None = None
    current: WeatherObservation | None = None
    forecast: list[WeatherForecastHour] = Field(default_factory=list)
