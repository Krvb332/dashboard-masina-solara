"""Motorul de alarme: praguri, histerezis, reguli compuse, legătură pierdută."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core.alarms import AlarmEngine
from app.core.bus import TelemetryBus
from app.schemas import TelemetryMessage


def feed(bus: TelemetryBus, sequence: int, **signals: float) -> None:
    bus.ingest(
        TelemetryMessage(
            schema_version=1,
            vehicle_id="solar-car-01",
            session_id="test",
            timestamp=datetime.now(UTC),
            sequence=sequence,
            signals=signals,
        )
    )


def active_keys(engine: AlarmEngine) -> set[str]:
    return {alarm.key for alarm in engine.active}


def test_prag_de_avertizare_si_prag_critic() -> None:
    bus = TelemetryBus()
    engine = AlarmEngine()

    feed(bus, 1, battery_soc_pct=22.0)
    engine.evaluate(bus)
    assert "battery_soc_pct:warn_low" in active_keys(engine)
    assert "battery_soc_pct:crit_low" not in active_keys(engine)

    feed(bus, 2, battery_soc_pct=12.0)
    engine.evaluate(bus)
    assert "battery_soc_pct:crit_low" in active_keys(engine)


def test_criticul_ascunde_avertizarea_aceluiasi_semnal() -> None:
    """Două alarme pentru aceeași cauză înseamnă zgomot, nu informație."""
    bus = TelemetryBus()
    engine = AlarmEngine()

    feed(bus, 1, motor_temp_c=120.0)
    engine.evaluate(bus)

    assert "motor_temp_c:crit_high" in active_keys(engine)
    assert "motor_temp_c:warn_high" not in active_keys(engine)

    # Când criticul se stinge, avertizarea redevine vizibilă.
    feed(bus, 2, motor_temp_c=100.0)
    engine.evaluate(bus)
    assert "motor_temp_c:crit_high" not in active_keys(engine)
    assert "motor_temp_c:warn_high" in active_keys(engine)


def test_histerezisul_impiedica_palpairea() -> None:
    """SOC-ul oscilează exact în jurul pragului de 25%; alarma nu trebuie să clipească."""
    bus = TelemetryBus()
    engine = AlarmEngine()

    feed(bus, 1, battery_soc_pct=24.9)
    engine.evaluate(bus)
    assert "battery_soc_pct:warn_low" in active_keys(engine)

    # Peste prag, dar în banda de histerezis (25 + 2): alarma rămâne activă.
    feed(bus, 2, battery_soc_pct=26.0)
    transitions = engine.evaluate(bus)
    assert transitions == []
    assert "battery_soc_pct:warn_low" in active_keys(engine)

    # Dincolo de banda de histerezis: alarma se stinge.
    feed(bus, 3, battery_soc_pct=27.5)
    transitions = engine.evaluate(bus)
    assert [alarm.active for alarm in transitions] == [False]
    assert "battery_soc_pct:warn_low" not in active_keys(engine)


def test_alarma_de_temperatura_peste_prag() -> None:
    bus = TelemetryBus()
    engine = AlarmEngine()

    feed(bus, 1, motor_temp_c=95.0)
    engine.evaluate(bus)
    assert "motor_temp_c:warn_high" in active_keys(engine)

    feed(bus, 2, motor_temp_c=115.0)
    engine.evaluate(bus)
    assert "motor_temp_c:crit_high" in active_keys(engine)


def test_legatura_pierduta_dupa_timeout() -> None:
    bus = TelemetryBus()
    now = datetime.now(UTC)
    engine = AlarmEngine(started_at=now)

    feed(bus, 1, vehicle_speed_kph=40.0)
    engine.evaluate(bus, now)
    assert "link_lost" not in active_keys(engine)

    engine.evaluate(bus, now + timedelta(seconds=4))
    assert "link_lost" in active_keys(engine)

    feed(bus, 2, vehicle_speed_kph=41.0)
    engine.evaluate(bus)
    assert "link_lost" not in active_keys(engine)


def test_lipsa_totala_de_date_are_perioada_de_gratie() -> None:
    now = datetime.now(UTC)
    bus = TelemetryBus()
    engine = AlarmEngine(started_at=now)

    engine.evaluate(bus, now + timedelta(seconds=1))
    assert "link_lost" not in active_keys(engine)

    engine.evaluate(bus, now + timedelta(seconds=10))
    assert "link_lost" in active_keys(engine)


def test_dezechilibru_intre_celule() -> None:
    bus = TelemetryBus()
    engine = AlarmEngine()

    feed(bus, 1, cell_voltage_min_v=3.60, cell_voltage_max_v=3.95)
    engine.evaluate(bus)
    assert "cell_imbalance" in active_keys(engine)

    feed(bus, 2, cell_voltage_min_v=3.80, cell_voltage_max_v=3.83)
    engine.evaluate(bus)
    assert "cell_imbalance" not in active_keys(engine)


def test_datele_invechite_nu_declanseaza_praguri() -> None:
    """Fără date proaspete nu putem afirma nimic despre praguri."""
    bus = TelemetryBus()
    engine = AlarmEngine()

    feed(bus, 1, motor_temp_c=20.0)
    later = datetime.now(UTC) + timedelta(seconds=30)
    engine.evaluate(bus, later)

    assert "motor_temp_c:warn_high" not in active_keys(engine)
    assert "link_lost" in active_keys(engine)


def test_confirmarea_alarmei() -> None:
    bus = TelemetryBus()
    engine = AlarmEngine()

    feed(bus, 1, battery_soc_pct=10.0)
    engine.evaluate(bus)
    alarm = engine.active[0]

    assert engine.acknowledge(alarm.id) is True
    assert engine.is_acknowledged(alarm.id) is True
    assert engine.acknowledge("inexistent") is False
