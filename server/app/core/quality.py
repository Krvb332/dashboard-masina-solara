"""Clasificarea calității unui semnal.

Cerința 3 din documentul de arhitectură: interfața trebuie să diferențieze clar
valoarea ``0`` de starea „nu mai primesc date". Pentru asta fiecare semnal
primește o stare de calitate, calculată aici și transmisă browserului.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from ..signals import Signal

# Cât de mult peste intervalul declarat trebuie să iasă o valoare pentru a fi
# considerată defect de senzor, exprimat ca fracțiune din interval.
OUT_OF_RANGE_TOLERANCE = 0.2


@dataclass(slots=True)
class SignalState:
    """Ultima valoare cunoscută a unui semnal și momentul primirii ei."""

    value: float | None = None
    received_at: datetime | None = None
    sensor_error: bool = False


def is_sensor_error(signal: Signal, value: float) -> bool:
    """Valoare imposibilă fizic pentru semnalul dat."""
    if math.isnan(value) or math.isinf(value):
        return True

    if signal.min is None or signal.max is None:
        return False

    span = signal.max - signal.min
    if span <= 0:
        return False

    tolerance = span * OUT_OF_RANGE_TOLERANCE
    return value < signal.min - tolerance or value > signal.max + tolerance


def classify(signal: Signal, state: SignalState, now: datetime) -> tuple[str, int, float | None]:
    """Întoarce ``(stare, vechime_ms, valoare)`` pentru un semnal.

    - ``unavailable``: semnalul nu a fost primit niciodată în această sesiune;
    - ``sensor_error``: ultima valoare este imposibilă fizic;
    - ``stale``: valoarea există, dar e mai veche decât ``stale_after_s``;
    - ``valid``: valoare proaspătă.
    """
    if state.received_at is None or state.value is None:
        return "unavailable", 0, None

    age_ms = max(0, int((now - state.received_at).total_seconds() * 1000))

    if state.sensor_error:
        return "sensor_error", age_ms, state.value

    if age_ms > signal.stale_after_s * 1000:
        return "stale", age_ms, state.value

    return "valid", age_ms, state.value
