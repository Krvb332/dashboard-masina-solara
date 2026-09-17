"""Vremea de la fața locului: client, normalizare și memorie cache.

De ce trece vremea prin server și nu direct din browser:

1. **Cheia rămâne pe server.** O cheie Google pusă într-un bundle Vite este
   publică în clipa în care cineva deschide DevTools. Aici trăiește într-un
   ``.env`` care nu intră în git, iar browserul nu o vede niciodată.
2. **Cota este partajată.** În pitlane sunt deschise mai multe tablete pe același
   dashboard. Fiecare ar interoga furnizorul separat; prin server, toate citesc
   aceeași observație din memoria cache, iar numărul de apeluri facturate nu
   crește cu numărul de ecrane.
3. **Legătura spre internet cade prima.** Serverul de telemetrie stă lângă
   mașină și trebuie să funcționeze fără internet. Vremea este singura parte a
   sistemului care depinde de o rețea externă, deci este și singura care are
   voie să lipsească — dar trebuie să lipsească *vizibil*, nu să întoarcă zerouri.

Regula de aur a proiectului se aplică și aici: o valoare pe care nu am primit-o
rămâne ``None``. Nu există „0 °C" pentru că nu a răspuns furnizorul — zero este o
temperatură reală, iar confundarea celor două ar strica orice cifră derivată din
ea (densitatea aerului, iradianța estimată, sfaturile date pilotului).
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from ..config import settings
from ..schemas import (
    WeatherCondition,
    WeatherForecastHour,
    WeatherHistory,
    WeatherLocation,
    WeatherMeasurements,
    WeatherObservation,
    WeatherReport,
)

logger = logging.getLogger("telemetry.weather")

PROVIDER = "google-weather"

# --- conversii de unități ---------------------------------------------------
#
# Cerem explicit sistemul metric, dar fiecare mărime din răspuns își poartă
# unitatea. O citim și convertim: dacă furnizorul schimbă vreodată implicitul,
# vrem o valoare corectă, nu grade Fahrenheit intrate tăcut în formula
# densității aerului.

_TEMPERATURE_TO_C: dict[str, Any] = {
    "CELSIUS": lambda value: value,
    "FAHRENHEIT": lambda value: (value - 32.0) * 5.0 / 9.0,
}

_SPEED_TO_KPH: dict[str, Any] = {
    "KILOMETERS_PER_HOUR": lambda value: value,
    "MILES_PER_HOUR": lambda value: value * 1.609344,
    "METERS_PER_SECOND": lambda value: value * 3.6,
    "KNOTS": lambda value: value * 1.852,
}

_DISTANCE_TO_KM: dict[str, Any] = {
    "KILOMETERS": lambda value: value,
    "MILES": lambda value: value * 1.609344,
    "METERS": lambda value: value / 1000.0,
}

_DEPTH_TO_MM: dict[str, Any] = {
    "MILLIMETERS": lambda value: value,
    "CENTIMETERS": lambda value: value * 10.0,
    "INCHES": lambda value: value * 25.4,
}


def _number(value: Any) -> float | None:
    """Un număr finit, sau ``None``. Textele și `NaN` nu au ce căuta mai departe."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _convert(
    node: Any,
    field: str,
    unit_field: str,
    table: dict[str, Any],
) -> float | None:
    """Extrage o mărime cu unitate dintr-un nod ``{unit, <field>}``."""
    if not isinstance(node, dict):
        return None

    raw = _number(node.get(field))
    if raw is None:
        return None

    unit = node.get(unit_field)
    converter = table.get(unit) if isinstance(unit, str) else None
    if converter is None:
        # Unitate necunoscută: mai bine fără valoare decât cu una greșită.
        if unit is not None:
            logger.warning("Unitate meteo necunoscută: %r pentru %s", unit, field)
            return None
        converter = next(iter(table.values()))

    return float(converter(raw))


def _temperature_c(node: Any) -> float | None:
    return _convert(node, "degrees", "unit", _TEMPERATURE_TO_C)


def _speed_kph(node: Any) -> float | None:
    return _convert(node, "value", "unit", _SPEED_TO_KPH)


def _distance_km(node: Any) -> float | None:
    return _convert(node, "distance", "unit", _DISTANCE_TO_KM)


def _depth_mm(node: Any) -> float | None:
    return _convert(node, "quantity", "unit", _DEPTH_TO_MM)


def _dig(payload: Any, *path: str) -> Any:
    """Coboară printr-un lanț de chei fără să arunce dacă lipsește una."""
    node = payload
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def _percent(value: Any) -> float | None:
    """Un procent, limitat la 0-100. În afara intervalului este date corupte."""
    number = _number(value)
    if number is None:
        return None
    return min(100.0, max(0.0, number))


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        logger.warning("Moment meteo neinterpretabil: %r", value)
        return None


# --- normalizare ------------------------------------------------------------


def parse_condition(node: Any) -> WeatherCondition:
    description = _dig(node, "description", "text")
    icon = _dig(node, "iconBaseUri")
    kind = _dig(node, "type")

    return WeatherCondition(
        type=kind if isinstance(kind, str) else None,
        description=description if isinstance(description, str) else None,
        # Google întoarce URI-ul fără extensie; varianta pentru fundal închis
        # este aceeași resursă cu sufixul `_dark`, iar dashboardul este întunecat.
        icon_uri=f"{icon}_dark.png" if isinstance(icon, str) and icon else None,
    )


def parse_measurements(node: Any) -> WeatherMeasurements:
    """Câmpurile comune observației curente și orelor de prognoză."""
    if not isinstance(node, dict):
        node = {}

    daytime = node.get("isDaytime")
    precipitation = node.get("precipitation")
    precipitation_type = _dig(precipitation, "probability", "type")

    return WeatherMeasurements(
        temperature_c=_temperature_c(node.get("temperature")),
        feels_like_c=_temperature_c(node.get("feelsLikeTemperature")),
        dew_point_c=_temperature_c(node.get("dewPoint")),
        heat_index_c=_temperature_c(node.get("heatIndex")),
        wet_bulb_c=_temperature_c(node.get("wetBulbTemperature")),
        relative_humidity_pct=_percent(node.get("relativeHumidity")),
        pressure_hpa=_number(_dig(node, "airPressure", "meanSeaLevelMillibars")),
        cloud_cover_pct=_percent(node.get("cloudCover")),
        uv_index=_number(node.get("uvIndex")),
        visibility_km=_distance_km(node.get("visibility")),
        wind_speed_kph=_speed_kph(_dig(node, "wind", "speed")),
        wind_gust_kph=_speed_kph(_dig(node, "wind", "gust")),
        wind_from_deg=_number(_dig(node, "wind", "direction", "degrees")),
        wind_cardinal=(
            cardinal
            if isinstance(cardinal := _dig(node, "wind", "direction", "cardinal"), str)
            else None
        ),
        precipitation_probability_pct=_percent(_dig(precipitation, "probability", "percent")),
        precipitation_type=(
            precipitation_type if isinstance(precipitation_type, str) else None
        ),
        precipitation_mm=_depth_mm(_dig(precipitation, "qpf")),
        snow_mm=_depth_mm(_dig(precipitation, "snowQpf")),
        thunderstorm_probability_pct=_percent(node.get("thunderstormProbability")),
        is_daytime=daytime if isinstance(daytime, bool) else None,
    )


def parse_history(node: Any) -> WeatherHistory:
    if not isinstance(node, dict):
        node = {}

    return WeatherHistory(
        max_temperature_c=_temperature_c(node.get("maxTemperature")),
        min_temperature_c=_temperature_c(node.get("minTemperature")),
        temperature_change_c=_temperature_c(node.get("temperatureChange")),
        precipitation_mm=_depth_mm(node.get("qpf")),
    )


def parse_current(payload: Any) -> WeatherObservation:
    """Normalizează răspunsul ``currentConditions:lookup``."""
    if not isinstance(payload, dict):
        payload = {}

    zone = _dig(payload, "timeZone", "id")

    return WeatherObservation(
        observed_at=_timestamp(payload.get("currentTime")),
        time_zone=zone if isinstance(zone, str) and zone else None,
        condition=parse_condition(payload.get("weatherCondition")),
        values=parse_measurements(payload),
        history=parse_history(payload.get("currentConditionsHistory")),
    )


def parse_forecast(payload: Any) -> list[WeatherForecastHour]:
    """Normalizează răspunsul ``forecast/hours:lookup``."""
    hours = _dig(payload, "forecastHours")
    if not isinstance(hours, list):
        return []

    result: list[WeatherForecastHour] = []
    for entry in hours:
        if not isinstance(entry, dict):
            continue

        start = _timestamp(_dig(entry, "interval", "startTime"))
        if start is None:
            # Fără momentul de început, ora de prognoză nu se poate așeza pe
            # nicio axă de timp. O aruncăm, în loc să inventăm un moment.
            continue

        result.append(
            WeatherForecastHour(
                start_time=start,
                end_time=_timestamp(_dig(entry, "interval", "endTime")),
                condition=parse_condition(entry.get("weatherCondition")),
                values=parse_measurements(entry),
            )
        )

    return result


# --- furnizorul -------------------------------------------------------------


class WeatherUnavailable(RuntimeError):
    """Furnizorul nu a putut fi interogat. Mesajul ajunge în interfață."""


class GoogleWeatherProvider:
    """Clientul HTTP pentru Google Maps Platform Weather API."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str | None = None,
        language: str | None = None,
        timeout_s: float | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = (base_url or settings.weather_base_url).rstrip("/")
        self.language = language or settings.weather_language
        self.timeout_s = timeout_s if timeout_s is not None else settings.weather_timeout_s
        self._client = client
        self._owns_client = client is None

    async def _request(self, path: str, params: dict[str, Any]) -> dict:
        if not self.api_key:
            raise WeatherUnavailable("Nicio cheie meteo configurată pe server.")

        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self.timeout_s)
            self._client = client

        query = {
            "key": self.api_key,
            "unitsSystem": "METRIC",
            "languageCode": self.language,
            **params,
        }

        try:
            response = await client.get(f"{self.base_url}{path}", params=query)
        except httpx.HTTPError as error:
            raise WeatherUnavailable(f"Furnizorul meteo nu răspunde: {error}") from error

        if response.status_code != 200:
            # Mesajul furnizorului poate conține cheia din query string; îl
            # reducem la cod, ca să nu ajungă în logurile sau interfața echipei.
            raise WeatherUnavailable(
                f"Furnizorul meteo a răspuns cu codul {response.status_code}."
            )

        try:
            payload = response.json()
        except ValueError as error:
            raise WeatherUnavailable("Răspuns meteo neinterpretabil.") from error

        if not isinstance(payload, dict):
            raise WeatherUnavailable("Răspuns meteo într-un format neașteptat.")
        return payload

    async def current(self, latitude: float, longitude: float) -> WeatherObservation:
        payload = await self._request(
            "/currentConditions:lookup",
            {"location.latitude": latitude, "location.longitude": longitude},
        )
        return parse_current(payload)

    async def forecast(
        self, latitude: float, longitude: float, hours: int
    ) -> list[WeatherForecastHour]:
        if hours <= 0:
            return []

        payload = await self._request(
            "/forecast/hours:lookup",
            {
                "location.latitude": latitude,
                "location.longitude": longitude,
                "hours": hours,
                "pageSize": min(hours, 24),
            },
        )
        return parse_forecast(payload)

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
        self._client = None


# --- serviciul cu memorie cache --------------------------------------------


@dataclass(slots=True)
class _CacheEntry:
    current: WeatherObservation
    forecast: list[WeatherForecastHour]
    latitude: float
    longitude: float
    fetched_at: datetime
    monotonic_at: float


def cache_key(latitude: float, longitude: float) -> tuple[float, float]:
    """Cheia de cache, rotunjită la ~1 km.

    Vremea nu se schimbă între două capete ale unui circuit, dar coordonatele
    GPS se schimbă de zece ori pe secundă. Fără rotunjire, fiecare eșantion ar
    fi o cheie nouă și fiecare cerere un apel facturat.
    """
    return (round(latitude, 2), round(longitude, 2))


class WeatherService:
    """Punctul unic prin care dashboardul primește vremea.

    Trei stări posibile, toate afișabile:

    - ``ok`` — observație proaspătă, mai nouă decât TTL-ul.
    - ``stale`` — furnizorul nu răspunde, dar avem ultima observație bună;
      o servim împreună cu vechimea ei, ca nimeni să nu o creadă actuală.
    - ``unavailable`` — nu există nici cheie, nici observație anterioară.
      Toate câmpurile rămân ``None`` și interfața afișează „—".
    """

    def __init__(self, provider: GoogleWeatherProvider | None = None) -> None:
        self._provider = provider
        self._cache: dict[tuple[float, float], _CacheEntry] = {}
        self._lock = asyncio.Lock()
        self.calls = 0
        self.failures = 0

    @property
    def provider(self) -> GoogleWeatherProvider:
        if self._provider is None:
            self._provider = GoogleWeatherProvider(settings.weather_api_key)
        return self._provider

    def resolve_location(
        self, latitude: float | None, longitude: float | None
    ) -> tuple[float, float] | None:
        """Poziția pentru care cerem vremea.

        Prioritatea este poziția reală a mașinii. Când GPS-ul nu are fix, cădem
        pe coordonatele configurate ale circuitului — dacă există. Nu inventăm
        niciodată o poziție: fără nicio sursă, întoarcem ``None`` și secțiunea
        spune deschis că nu știe unde se află mașina.
        """
        if (
            latitude is not None
            and longitude is not None
            and -90.0 <= latitude <= 90.0
            and -180.0 <= longitude <= 180.0
            # (0, 0) este raportat de receptoarele fără fix, nu este o poziție.
            and not (abs(latitude) < 1.0 and abs(longitude) < 1.0)
        ):
            return (latitude, longitude)

        if settings.weather_default_lat is not None and settings.weather_default_lon is not None:
            return (settings.weather_default_lat, settings.weather_default_lon)

        return None

    async def report(
        self,
        latitude: float | None,
        longitude: float | None,
        *,
        now: datetime | None = None,
        monotonic: float | None = None,
    ) -> WeatherReport:
        resolved = self.resolve_location(latitude, longitude)
        if resolved is None:
            return WeatherReport(
                status="unavailable",
                provider=PROVIDER,
                location=None,
                reason=(
                    "Fără poziție: GPS-ul nu are fix și nu sunt configurate "
                    "coordonatele implicite ale circuitului."
                ),
            )

        lat, lon = resolved
        source = "gps" if (latitude, longitude) == (lat, lon) else "configurat"
        location = WeatherLocation(latitude=lat, longitude=lon, source=source)
        key = cache_key(lat, lon)
        clock = monotonic if monotonic is not None else time.monotonic()

        async with self._lock:
            cached = self._cache.get(key)
            if cached is not None and clock - cached.monotonic_at < settings.weather_ttl_s:
                return self._build(cached, "ok", location, clock)

            try:
                self.calls += 1
                current = await self.provider.current(lat, lon)
            except WeatherUnavailable as error:
                self.failures += 1
                if cached is not None:
                    logger.warning("Vreme indisponibilă, servesc ultima observație: %s", error)
                    return self._build(cached, "stale", location, clock, reason=str(error))

                logger.warning("Vreme indisponibilă: %s", error)
                return WeatherReport(
                    status="unavailable",
                    provider=PROVIDER,
                    location=location,
                    reason=str(error),
                )

            # Prognoza este un al doilea apel, la un alt endpoint, cu o cotă
            # separată. Dacă el cade, observația curentă rămâne bună: ea este
            # informația care contează acum, iar aruncarea ei din cauza orelor
            # viitoare ar transforma o degradare parțială în una totală.
            try:
                forecast = await self.provider.forecast(
                    lat, lon, settings.weather_forecast_hours
                )
            except WeatherUnavailable as error:
                logger.warning("Prognoză indisponibilă, păstrez observația: %s", error)
                forecast = []

            entry = _CacheEntry(
                current=current,
                forecast=forecast,
                latitude=lat,
                longitude=lon,
                fetched_at=now or datetime.now(tz=UTC),
                monotonic_at=clock,
            )
            self._cache[key] = entry
            return self._build(entry, "ok", location, clock)

    def _build(
        self,
        entry: _CacheEntry,
        status: str,
        location: WeatherLocation,
        clock: float,
        reason: str | None = None,
    ) -> WeatherReport:
        return WeatherReport(
            status=status,  # type: ignore[arg-type]
            provider=PROVIDER,
            location=location,
            fetched_at=entry.fetched_at,
            age_s=round(max(0.0, clock - entry.monotonic_at), 1),
            reason=reason,
            current=entry.current,
            forecast=entry.forecast,
        )

    def clear(self) -> None:
        self._cache.clear()

    async def aclose(self) -> None:
        if self._provider is not None:
            await self._provider.aclose()
            self._provider = None


weather_service = WeatherService()
