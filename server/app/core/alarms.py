"""Motorul de alarme.

Punctul 5 din documentul de arhitectură: alarmele se calculează pe server, nu
doar în browser, și fiecare tranziție se înregistrează în istoricul sesiunii.

Fiecare regulă are histerezis: pragul de activare diferă de cel de dezactivare,
astfel încât o valoare care oscilează exact în jurul limitei nu produce zeci de
alarme pe secundă.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ..schemas import Alarm, Severity
from ..signals import CATALOG, Signal
from .bus import TelemetryBus, utcnow

# Cât timp fără mesaje înseamnă legătură pierdută.
LINK_TIMEOUT_S = 2.0
# Perioadă de grație după pornirea serverului, cât timp lipsa datelor e normală.
STARTUP_GRACE_S = 5.0
# Praguri pentru regulile compuse.
CELL_IMBALANCE_V = 0.25
CELL_IMBALANCE_CLEAR_V = 0.22
ENERGY_DEFICIT_RATIO = 3.0
ENERGY_DEFICIT_CLEAR_RATIO = 2.5
ENERGY_DEFICIT_MIN_W = 1500.0


@dataclass(slots=True)
class _Rule:
    key: str
    label: str
    severity: Severity
    message: str
    signal_key: str | None
    threshold: float | None
    direction: str  # "below" | "above" | "composite"
    hysteresis: float = 0.0


def _threshold_rules() -> list[_Rule]:
    """Regulile derivate din pragurile declarate în catalogul de semnale."""
    rules: list[_Rule] = []

    for signal in CATALOG:
        rules.extend(_rules_for_signal(signal))

    return rules


def _rules_for_signal(signal: Signal) -> list[_Rule]:
    specs = (
        ("crit_low", signal.crit_below, "below", "critical", "sub pragul critic"),
        ("warn_low", signal.warn_below, "below", "warning", "sub pragul de avertizare"),
        ("crit_high", signal.crit_above, "above", "critical", "peste pragul critic"),
        ("warn_high", signal.warn_above, "above", "warning", "peste pragul de avertizare"),
    )

    rules: list[_Rule] = []
    for suffix, threshold, direction, severity, phrase in specs:
        if threshold is None:
            continue
        unit = f" {signal.unit}".rstrip()
        rules.append(
            _Rule(
                key=f"{signal.key}:{suffix}",
                label=signal.label,
                severity=severity,  # type: ignore[arg-type]
                message=f"{signal.label} {phrase} ({threshold:g}{unit}).",
                signal_key=signal.key,
                threshold=threshold,
                direction=direction,
                hysteresis=signal.hysteresis,
            )
        )

    return rules


def _superseding_key(rule_key: str) -> str:
    """Cheia alarmei critice care ar face redundantă avertizarea dată."""
    if rule_key.endswith(":warn_low"):
        return rule_key.replace(":warn_low", ":crit_low")
    if rule_key.endswith(":warn_high"):
        return rule_key.replace(":warn_high", ":crit_high")
    return ""


class AlarmEngine:
    """Evaluează regulile la fiecare tick și menține lista alarmelor active."""

    def __init__(self, started_at: datetime | None = None) -> None:
        self._rules = _threshold_rules()
        self._active: dict[str, Alarm] = {}
        self._acknowledged: set[str] = set()
        self._started_at = started_at or utcnow()

    @property
    def active(self) -> list[Alarm]:
        """Alarmele active, cele mai grave primele.

        Avertizarea unui semnal este ascunsă cât timp criticul aceluiași semnal
        și aceleiași direcții este activ: „temperatură peste 90" și
        „temperatură peste 110" simultan nu adaugă informație, doar zgomot pe
        ecran exact când operatorul are nevoie de claritate. În istoricul
        sesiunii rămân ambele.
        """
        order = {"critical": 0, "warning": 1, "info": 2}
        visible = [
            alarm
            for key, alarm in self._active.items()
            if _superseding_key(key) not in self._active
        ]
        return sorted(visible, key=lambda alarm: (order[alarm.severity], alarm.raised_at))

    def acknowledge(self, alarm_id: str) -> bool:
        for alarm in self._active.values():
            if alarm.id == alarm_id:
                self._acknowledged.add(alarm_id)
                return True
        return False

    def is_acknowledged(self, alarm_id: str) -> bool:
        return alarm_id in self._acknowledged

    def evaluate(self, bus: TelemetryBus, now: datetime | None = None) -> list[Alarm]:
        """Rulează toate regulile. Întoarce tranzițiile produse la acest tick."""
        moment = now or utcnow()
        transitions: list[Alarm] = []
        quality = bus.quality(moment)

        for rule in self._rules:
            assert rule.signal_key is not None
            signal_quality = quality.get(rule.signal_key)
            if signal_quality is None or signal_quality.state != "valid":
                # Fără date proaspete nu putem afirma nimic despre prag.
                # Lipsa datelor e semnalată separat, de regula link_lost.
                continue

            value = signal_quality.value
            assert value is not None
            transitions.extend(self._apply(rule, self._crosses(rule, value), value, moment))

        transitions.extend(self._evaluate_link(bus, moment))
        transitions.extend(self._evaluate_composites(bus, quality, moment))
        return transitions

    # --- reguli compuse ---------------------------------------------------

    def _evaluate_link(self, bus: TelemetryBus, moment: datetime) -> list[Alarm]:
        rule = _Rule(
            key="link_lost",
            label="Legătură pierdută",
            severity="critical",
            message="Nu s-au mai primit mesaje de la mașină.",
            signal_key=None,
            threshold=LINK_TIMEOUT_S,
            direction="composite",
        )

        age = bus.age_s(moment)
        if age is None:
            uptime = (moment - self._started_at).total_seconds()
            triggered = uptime > STARTUP_GRACE_S
        else:
            triggered = age > LINK_TIMEOUT_S

        return self._apply(rule, triggered, age, moment)

    def _evaluate_composites(
        self, bus: TelemetryBus, quality: dict, moment: datetime
    ) -> list[Alarm]:
        transitions: list[Alarm] = []

        cell_min = self._valid_value(quality, "cell_voltage_min_v")
        cell_max = self._valid_value(quality, "cell_voltage_max_v")
        if cell_min is not None and cell_max is not None:
            spread = cell_max - cell_min
            active = "cell_imbalance" in self._active
            threshold = CELL_IMBALANCE_CLEAR_V if active else CELL_IMBALANCE_V
            rule = _Rule(
                key="cell_imbalance",
                label="Dezechilibru celule",
                severity="warning",
                message=f"Diferența dintre celule este {spread:.3f} V.",
                signal_key="cell_voltage_max_v",
                threshold=CELL_IMBALANCE_V,
                direction="composite",
            )
            transitions.extend(self._apply(rule, spread > threshold, spread, moment))

        battery_power = self._valid_value(quality, "battery_power_w")
        solar_power = self._valid_value(quality, "solar_power_w")
        if battery_power is not None and solar_power is not None:
            active = "energy_deficit" in self._active
            ratio_limit = ENERGY_DEFICIT_CLEAR_RATIO if active else ENERGY_DEFICIT_RATIO
            triggered = (
                battery_power > ENERGY_DEFICIT_MIN_W
                and battery_power > ratio_limit * max(solar_power, 1.0)
            )
            rule = _Rule(
                key="energy_deficit",
                label="Deficit de energie",
                severity="info",
                message=(
                    f"Consumul ({battery_power:.0f} W) depășește semnificativ "
                    f"aportul solar ({solar_power:.0f} W)."
                ),
                signal_key="battery_power_w",
                threshold=ENERGY_DEFICIT_RATIO,
                direction="composite",
            )
            transitions.extend(self._apply(rule, triggered, battery_power, moment))

        return transitions

    @staticmethod
    def _valid_value(quality: dict, key: str) -> float | None:
        entry = quality.get(key)
        if entry is None or entry.state != "valid":
            return None
        return entry.value

    # --- mecanica activării -----------------------------------------------

    def _crosses(self, rule: _Rule, value: float) -> bool:
        """Ține cont de histerezis: pragul de stingere e mai permisiv."""
        assert rule.threshold is not None
        active = rule.key in self._active

        if rule.direction == "below":
            limit = rule.threshold + rule.hysteresis if active else rule.threshold
            return value < limit

        limit = rule.threshold - rule.hysteresis if active else rule.threshold
        return value > limit

    def _apply(
        self, rule: _Rule, triggered: bool, value: float | None, moment: datetime
    ) -> list[Alarm]:
        existing = self._active.get(rule.key)

        if triggered and existing is None:
            alarm = Alarm(
                id=f"{rule.key}@{int(moment.timestamp() * 1000)}",
                key=rule.key,
                label=rule.label,
                severity=rule.severity,
                message=rule.message,
                signal_key=rule.signal_key,
                value=value,
                threshold=rule.threshold,
                raised_at=moment,
                active=True,
            )
            self._active[rule.key] = alarm
            return [alarm]

        if triggered and existing is not None:
            # Alarma rămâne activă; actualizăm valoarea și mesajul curent.
            existing.value = value
            existing.message = rule.message
            return []

        if not triggered and existing is not None:
            existing.active = False
            existing.cleared_at = moment
            del self._active[rule.key]
            self._acknowledged.discard(existing.id)
            return [existing]

        return []
