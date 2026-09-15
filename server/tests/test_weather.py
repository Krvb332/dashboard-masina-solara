"""Verificări pentru secțiunea de vreme: normalizare, degradare, memorie cache.

Niciun test nu atinge rețeaua. Furnizorul este înlocuit cu un dublu care
întoarce exact ce vrem, inclusiv eșecuri — altfel suita ar depinde de vremea de
afară și de cota API, iar un test care pică joia pentru că e înnorat nu spune
nimic despre cod.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.core.weather import (
    GoogleWeatherProvider,
    WeatherService,
    WeatherUnavailable,
    cache_key,
    parse_current,
    parse_forecast,
)
from app.main import app
from app.schemas import WeatherMeasurements

# Răspuns real al Google Weather API, capturat pe 15.09.2026 pentru Cluj-Napoca.
# Păstrat integral, ca normalizarea să fie verificată pe forma adevărată a
# datelor, nu pe o versiune simplificată de noi.
REAL_CURRENT = {
    "timeZone": {"id": "Europe/Bucharest", "version": ""},
    "weatherCondition": {
        "iconBaseUri": "https://maps.gstatic.com/weather/v1/mostly_sunny",
        "description": {"text": "În mare parte însorit", "languageCode": "ro"},
        "type": "MOSTLY_CLEAR",
    },
    "temperature": {"unit": "CELSIUS", "degrees": 23.9},
    "feelsLikeTemperature": {"unit": "CELSIUS", "degrees": 24.6},
    "dewPoint": {"unit": "CELSIUS", "degrees": 8.2},
    "heatIndex": {"unit": "CELSIUS", "degrees": 24.6},
    "windChill": {"unit": "CELSIUS", "degrees": 23.9},
    "precipitation": {
        "probability": {"type": "RAIN", "percent": 0},
        "snowQpf": {"unit": "MILLIMETERS", "quantity": 0},
        "qpf": {"unit": "MILLIMETERS", "quantity": 0},
    },
    "airPressure": {"meanSeaLevelMillibars": 1020},
    "wind": {
        "direction": {"cardinal": "NORTH", "degrees": 357},
        "speed": {"unit": "KILOMETERS_PER_HOUR", "value": 5},
        "gust": {"unit": "KILOMETERS_PER_HOUR", "value": 12},
    },
    "visibility": {"unit": "KILOMETERS", "distance": 16},
    "currentConditionsHistory": {
        "temperatureChange": {"unit": "CELSIUS", "degrees": 1.1},
        "maxTemperature": {"unit": "CELSIUS", "degrees": 24.3},
        "minTemperature": {"unit": "CELSIUS", "degrees": 9.2},
        "snowQpf": {"unit": "MILLIMETERS", "quantity": 0},
        "qpf": {"unit": "MILLIMETERS", "quantity": 0},
    },
    "currentTime": "2026-09-15T14:22:38.435975864Z",
    "isDaytime": True,
    "relativeHumidity": 36,
    "uvIndex": 0,
    "thunderstormProbability": 0,
    "cloudCover": 28,
}

REAL_FORECAST = {
    "forecastHours": [
        {
            "interval": {
                "startTime": "2026-09-15T14:00:00Z",
                "endTime": "2026-09-15T15:00:00Z",
            },
            "weatherCondition": {
                "iconBaseUri": "https://maps.gstatic.com/weather/v1/mostly_sunny",
                "description": {"text": "În mare parte însorit", "languageCode": "ro"},
                "type": "MOSTLY_CLEAR",
            },
            "temperature": {"unit": "CELSIUS", "degrees": 24.2},
            "wetBulbTemperature": {"unit": "CELSIUS", "degrees": 14.6},
            "precipitation": {
                "probability": {"type": "RAIN", "percent": 0},
                "qpf": {"unit": "MILLIMETERS", "quantity": 0},
            },
            "wind": {
                "direction": {"cardinal": "NORTH", "degrees": 357},
                "speed": {"unit": "KILOMETERS_PER_HOUR", "value": 5},
                "gust": {"unit": "KILOMETERS_PER_HOUR", "value": 13},
            },
            "isDaytime": True,
            "relativeHumidity": 35,
            "uvIndex": 1,
            "cloudCover": 29,
        },
        # O oră fără interval: nu se poate așeza pe axa de timp, deci se aruncă.
        {"temperature": {"unit": "CELSIUS", "degrees": 20.0}},
    ]
}


class FakeProvider:
    """Un furnizor controlat de test: răspunde, cade, și își numără apelurile."""

    def __init__(self, current=REAL_CURRENT, forecast=REAL_FORECAST, fail=False):
        self._current = current
        self._forecast = forecast
        self.fail = fail
        # Prognoza și observația curentă sunt două endpointuri diferite, cu cote
        # diferite: unul poate cădea singur.
        self.fail_forecast = False
        self.calls = 0

    async def current(self, latitude: float, longitude: float):
        self.calls += 1
        if self.fail:
            raise WeatherUnavailable("furnizor căzut în test")
        return parse_current(self._current)

    async def forecast(self, latitude: float, longitude: float, hours: int):
        if self.fail or self.fail_forecast:
            raise WeatherUnavailable("prognoză căzută în test")
        return parse_forecast(self._forecast)

    async def aclose(self) -> None:
        return None


@pytest.fixture
def isolated_storage(tmp_path):
    """Baza de date a serviciului, mutată în `tmp_path`.

    `TestClient(app)` pornește ciclul de viață complet al aplicației, inclusiv
    conectarea la stocare. Fără fixtura asta, testele meteo ar scrie în baza de
    date reală din `server/data/` — un efect secundar pe care nimeni nu îl
    așteaptă de la un test despre vreme.
    """
    from app import runtime as runtime_module
    from app.core.bus import TelemetryBus
    from app.core.sessions import SessionRecorder
    from app.storage.sqlite import SqliteStorage

    current = runtime_module.runtime
    current.bus = TelemetryBus()
    current.storage = SqliteStorage(str(tmp_path / "weather.db"))
    current.recorder = SessionRecorder(current.bus, current.storage)
    return current


@pytest.fixture
def circuit(monkeypatch):
    """Coordonate implicite configurate, ca testele să nu depindă de GPS."""
    monkeypatch.setattr(settings, "weather_default_lat", 46.7712)
    monkeypatch.setattr(settings, "weather_default_lon", 23.6236)
    monkeypatch.setattr(settings, "weather_ttl_s", 600.0)
    monkeypatch.setattr(settings, "weather_forecast_hours", 12)


# --- normalizare ----------------------------------------------------------


def test_normalize_maps_every_field_of_a_real_response():
    observation = parse_current(REAL_CURRENT)
    values = observation.values

    assert observation.observed_at == datetime.fromisoformat(
        "2026-09-15T14:22:38.435975+00:00"
    )
    assert observation.time_zone == "Europe/Bucharest"
    assert observation.condition.type == "MOSTLY_CLEAR"
    assert observation.condition.description == "În mare parte însorit"
    assert observation.condition.icon_uri == (
        "https://maps.gstatic.com/weather/v1/mostly_sunny_dark.png"
    )

    assert values.temperature_c == pytest.approx(23.9)
    assert values.feels_like_c == pytest.approx(24.6)
    assert values.dew_point_c == pytest.approx(8.2)
    assert values.heat_index_c == pytest.approx(24.6)
    assert values.relative_humidity_pct == pytest.approx(36.0)
    assert values.pressure_hpa == pytest.approx(1020.0)
    assert values.cloud_cover_pct == pytest.approx(28.0)
    assert values.uv_index == pytest.approx(0.0)
    assert values.visibility_km == pytest.approx(16.0)
    assert values.wind_speed_kph == pytest.approx(5.0)
    assert values.wind_gust_kph == pytest.approx(12.0)
    assert values.wind_from_deg == pytest.approx(357.0)
    assert values.wind_cardinal == "NORTH"
    assert values.precipitation_probability_pct == pytest.approx(0.0)
    assert values.precipitation_type == "RAIN"
    assert values.precipitation_mm == pytest.approx(0.0)
    assert values.snow_mm == pytest.approx(0.0)
    assert values.thunderstorm_probability_pct == pytest.approx(0.0)
    assert values.is_daytime is True

    assert observation.history.max_temperature_c == pytest.approx(24.3)
    assert observation.history.min_temperature_c == pytest.approx(9.2)
    assert observation.history.temperature_change_c == pytest.approx(1.1)
    assert observation.history.precipitation_mm == pytest.approx(0.0)


def test_normalize_converts_imperial_units_to_metric():
    """Dacă furnizorul răspunde vreodată în unități imperiale, convertim.

    Fără conversie, 75 °F ar intra în formula densității aerului ca 75 °C, iar
    toate cifrele derivate din ea ar fi greșite fără niciun semn vizibil.
    """
    observation = parse_current(
        {
            "temperature": {"unit": "FAHRENHEIT", "degrees": 75.2},
            "wind": {
                "speed": {"unit": "MILES_PER_HOUR", "value": 10.0},
                "gust": {"unit": "KNOTS", "value": 10.0},
            },
            "visibility": {"unit": "MILES", "distance": 10.0},
            "precipitation": {"qpf": {"unit": "INCHES", "quantity": 1.0}},
        }
    )

    assert observation.values.temperature_c == pytest.approx(24.0)
    assert observation.values.wind_speed_kph == pytest.approx(16.09344)
    assert observation.values.wind_gust_kph == pytest.approx(18.52)
    assert observation.values.visibility_km == pytest.approx(16.09344)
    assert observation.values.precipitation_mm == pytest.approx(25.4)


def test_normalize_drops_values_with_an_unknown_unit():
    """O unitate pe care nu o cunoaștem nu se ghicește; valoarea dispare."""
    observation = parse_current(
        {"temperature": {"unit": "RANKINE", "degrees": 540.0}}
    )
    assert observation.values.temperature_c is None


def test_normalize_keeps_missing_values_as_none_never_zero():
    """Controlul care ține în frâu toată secțiunea: absent nu devine `0`."""
    observation = parse_current({})

    empty = WeatherMeasurements()
    assert observation.values == empty
    # Exhaustiv, ca un câmp adăugat mai târziu cu implicit `0` să pice aici.
    for name in WeatherMeasurements.model_fields:
        assert getattr(observation.values, name) is None, name


def test_normalize_rejects_impossible_percentages_and_nan():
    observation = parse_current(
        {"relativeHumidity": 460, "cloudCover": -12, "uvIndex": math.nan}
    )
    assert observation.values.relative_humidity_pct == pytest.approx(100.0)
    assert observation.values.cloud_cover_pct == pytest.approx(0.0)
    assert observation.values.uv_index is None


def test_normalize_forecast_hours_and_skips_entries_without_an_interval():
    hours = parse_forecast(REAL_FORECAST)

    assert len(hours) == 1
    hour = hours[0]
    assert hour.start_time == datetime(2026, 9, 15, 14, 0, tzinfo=UTC)
    assert hour.end_time == datetime(2026, 9, 15, 15, 0, tzinfo=UTC)
    assert hour.values.temperature_c == pytest.approx(24.2)
    assert hour.values.wet_bulb_c == pytest.approx(14.6)
    assert hour.values.cloud_cover_pct == pytest.approx(29.0)
    assert hour.condition.description == "În mare parte însorit"


def test_normalize_survives_a_completely_unexpected_payload():
    assert parse_forecast({"forecastHours": "nu este o listă"}) == []
    assert parse_current(["nici asta"]).values == WeatherMeasurements()


# --- degradare ------------------------------------------------------------


async def test_degrade_without_an_api_key_reports_unavailable(monkeypatch, circuit):
    monkeypatch.setattr(settings, "weather_api_key", "")
    service = WeatherService(GoogleWeatherProvider(api_key=""))

    report = await service.report(None, None)

    assert report.status == "unavailable"
    assert report.current is None
    assert report.forecast == []
    assert report.age_s is None
    assert "cheie" in (report.reason or "").lower()


async def test_degrade_when_the_provider_fails_and_nothing_is_cached(circuit):
    service = WeatherService(FakeProvider(fail=True))

    report = await service.report(46.7712, 23.6236)

    assert report.status == "unavailable"
    assert report.current is None
    assert report.location is not None and report.location.source == "gps"


async def test_degrade_keeps_the_current_observation_when_only_the_forecast_fails(
    circuit,
):
    """O prognoză căzută nu are voie să arunce o observație curentă bună.

    Sunt două apeluri, la două endpointuri, cu cote separate. Observația curentă
    este informația care contează acum; aruncarea ei din cauza orelor viitoare ar
    transforma o degradare parțială într-una totală.
    """
    provider = FakeProvider()
    provider.fail_forecast = True
    service = WeatherService(provider)

    report = await service.report(46.7712, 23.6236)

    assert report.status == "ok"
    assert report.current is not None
    assert report.current.values.temperature_c == pytest.approx(23.9)
    assert report.forecast == []


async def test_degrade_without_any_position_says_so(monkeypatch):
    monkeypatch.setattr(settings, "weather_default_lat", None)
    monkeypatch.setattr(settings, "weather_default_lon", None)
    provider = FakeProvider()
    service = WeatherService(provider)

    report = await service.report(None, None)

    assert report.status == "unavailable"
    assert report.location is None
    assert provider.calls == 0, "fără poziție nu se cheltuie un apel la furnizor"


async def test_degrade_treats_null_island_as_no_fix(circuit):
    """``0, 0`` este ce raportează un receptor fără fix, nu golful Guineei."""
    service = WeatherService(FakeProvider())

    report = await service.report(0.0, 0.0)

    assert report.location is not None
    assert report.location.source == "configurat"
    assert report.location.latitude == pytest.approx(46.7712)


def test_degrade_endpoint_answers_200_even_without_a_key(
    monkeypatch, circuit, isolated_storage
):
    """Interfața trebuie să poată afișa „indisponibil", deci nu ridicăm eroare."""
    from app.api import weather as weather_api

    monkeypatch.setattr(settings, "weather_api_key", "")
    monkeypatch.setattr(
        weather_api, "weather_service", WeatherService(GoogleWeatherProvider(api_key=""))
    )

    with TestClient(app) as client:
        response = client.get("/api/v1/weather")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["current"] is None
    assert body["provider"] == "google-weather"


def test_degrade_endpoint_serves_normalized_data_when_the_provider_answers(
    monkeypatch, circuit, isolated_storage
):
    from app.api import weather as weather_api

    monkeypatch.setattr(weather_api, "weather_service", WeatherService(FakeProvider()))

    with TestClient(app) as client:
        response = client.get("/api/v1/weather?lat=46.7712&lon=23.6236")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["current"]["values"]["temperature_c"] == pytest.approx(23.9)
    assert body["current"]["values"]["wind_from_deg"] == pytest.approx(357.0)
    assert len(body["forecast"]) == 1


# --- memorie cache --------------------------------------------------------


async def test_cache_serves_the_second_call_without_touching_the_provider(circuit):
    provider = FakeProvider()
    service = WeatherService(provider)

    first = await service.report(46.7712, 23.6236, monotonic=1000.0)
    second = await service.report(46.7713, 23.6237, monotonic=1300.0)

    assert provider.calls == 1, "al doilea apel trebuie servit din memorie"
    assert first.status == "ok" and second.status == "ok"
    assert second.age_s == pytest.approx(300.0)


async def test_cache_refetches_after_the_ttl_expires(circuit):
    provider = FakeProvider()
    service = WeatherService(provider)

    await service.report(46.7712, 23.6236, monotonic=0.0)
    report = await service.report(46.7712, 23.6236, monotonic=601.0)

    assert provider.calls == 2
    assert report.age_s == pytest.approx(0.0)


async def test_cache_serves_the_last_good_observation_when_the_provider_dies(circuit):
    provider = FakeProvider()
    service = WeatherService(provider)

    await service.report(46.7712, 23.6236, monotonic=0.0)
    provider.fail = True
    report = await service.report(46.7712, 23.6236, monotonic=900.0)

    assert report.status == "stale"
    assert report.current is not None
    assert report.current.values.temperature_c == pytest.approx(23.9)
    # Vechimea este obligatorie pe „stale": altfel cifra pare actuală.
    assert report.age_s == pytest.approx(900.0)
    assert report.reason


async def test_cache_separates_locations_more_than_a_kilometre_apart(circuit):
    provider = FakeProvider()
    service = WeatherService(provider)

    await service.report(46.7712, 23.6236, monotonic=0.0)
    await service.report(46.9000, 23.6236, monotonic=1.0)

    assert provider.calls == 2


def test_cache_key_rounds_to_about_one_kilometre():
    """Aceeași cheie pentru capetele unui circuit, chei diferite pentru orașe."""
    assert cache_key(46.7712, 23.6236) == cache_key(46.7714, 23.6239)
    assert cache_key(46.7712, 23.6236) != cache_key(46.7812, 23.6236)
