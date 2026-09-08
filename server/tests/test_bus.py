"""Integritatea fluxului: mesaje lipsă, duplicate, ordine incorectă, calitate."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core.bus import TelemetryBus
from app.schemas import TelemetryMessage


def message(sequence: int, **signals: float) -> TelemetryMessage:
    return TelemetryMessage(
        schema_version=1,
        vehicle_id="solar-car-01",
        session_id="test",
        timestamp=datetime.now(UTC),
        sequence=sequence,
        signals=signals or {"vehicle_speed_kph": 42.0},
    )


def test_secventa_continua_nu_raporteaza_pierderi() -> None:
    bus = TelemetryBus()
    for sequence in range(1, 6):
        bus.ingest(message(sequence))

    assert bus.stats.received == 5
    assert bus.stats.dropped == 0
    assert bus.stats.duplicates == 0
    assert bus.stats.out_of_order == 0


def test_gap_in_secventa_este_numarat() -> None:
    bus = TelemetryBus()
    bus.ingest(message(1))
    bus.ingest(message(5))

    assert bus.stats.dropped == 3


def test_duplicatul_este_detectat() -> None:
    bus = TelemetryBus()
    bus.ingest(message(1))
    bus.ingest(message(2))
    bus.ingest(message(2))

    assert bus.stats.duplicates == 1
    assert bus.stats.dropped == 0


def test_mesaj_in_ordine_incorecta() -> None:
    bus = TelemetryBus()
    bus.ingest(message(10))
    bus.ingest(message(8))

    assert bus.stats.out_of_order == 1


def test_resetarea_numaratorului_nu_este_eroare() -> None:
    bus = TelemetryBus()
    bus.ingest(message(5000))
    bus.ingest(message(1))

    assert bus.stats.out_of_order == 0
    assert bus.stats.dropped == 0


def test_sesiune_noua_reseteaza_statisticile() -> None:
    bus = TelemetryBus()
    bus.ingest(message(1))
    bus.ingest(message(9))
    assert bus.stats.dropped == 7

    other = TelemetryMessage(
        schema_version=1,
        vehicle_id="solar-car-01",
        session_id="alta-sesiune",
        timestamp=datetime.now(UTC),
        sequence=1,
        signals={"vehicle_speed_kph": 10.0},
    )
    bus.ingest(other)

    assert bus.stats.dropped == 0
    assert bus.session_id == "alta-sesiune"


def test_calitatea_distinge_lipsa_de_zero() -> None:
    """Cerința 3: valoarea 0 nu trebuie confundată cu absența datelor."""
    bus = TelemetryBus()
    bus.ingest(message(1, vehicle_speed_kph=0.0))

    quality = bus.quality()
    assert quality["vehicle_speed_kph"].state == "valid"
    assert quality["vehicle_speed_kph"].value == 0.0
    # Un semnal netrimis niciodată nu are valoare, nu are valoarea zero.
    assert quality["motor_temp_c"].state == "unavailable"
    assert quality["motor_temp_c"].value is None


def test_semnalul_devine_stale() -> None:
    bus = TelemetryBus()
    bus.ingest(message(1, vehicle_speed_kph=30.0))

    later = datetime.now(UTC) + timedelta(seconds=5)
    quality = bus.quality(later)

    assert quality["vehicle_speed_kph"].state == "stale"
    assert quality["vehicle_speed_kph"].value == 30.0


def test_valoare_imposibila_este_eroare_de_senzor() -> None:
    bus = TelemetryBus()
    bus.ingest(message(1, battery_soc_pct=480.0))

    assert bus.quality()["battery_soc_pct"].state == "sensor_error"


def test_frecventa_efectiva_scade_la_zero_cand_fluxul_se_opreste() -> None:
    """Nu poți raporta 10 Hz lângă „ultimul mesaj acum 12 s"."""
    bus = TelemetryBus()
    for sequence in range(1, 6):
        bus.ingest(message(sequence))

    assert bus.current_stats().effective_hz > 0

    later = datetime.now(UTC) + timedelta(seconds=10)
    assert bus.current_stats(later).effective_hz == 0.0
    # Statisticile de bază rămân neatinse.
    assert bus.current_stats(later).received == 5


def test_history_filtreaza_dupa_timp() -> None:
    bus = TelemetryBus()
    bus.ingest(message(1))
    cutoff = bus.latest.server_received_at
    bus.ingest(message(2))

    recent = bus.history(since=cutoff)
    assert [sample.sequence for sample in recent] == [2]
