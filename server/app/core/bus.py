"""Magistrala de telemetrie: buffer în memorie, integritatea fluxului, fanout.

Aici intră fiecare mesaj primit de la mașină, indiferent de transport (MQTT sau
HTTP). Tot aici se calculează statisticile cerute de punctul 9 din documentul de
arhitectură: mesaje lipsă, duplicate sau primite în ordine incorectă.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from datetime import UTC, datetime

from ..schemas import Sample, SignalQuality, StreamStats, TelemetryMessage
from ..signals import BY_KEY
from .quality import SignalState, classify, is_sensor_error

# Sub acest prag negativ considerăm că numărătorul a fost resetat (mașină
# repornită), nu că mesajul a sosit în ordine greșită.
SEQUENCE_RESET_THRESHOLD = -100

# Câte momente de recepție păstrăm pentru calculul frecvenței efective.
RATE_WINDOW = 50

# După atâtea secunde fără mesaje, frecvența raportată devine zero.
RATE_DECAY_AFTER_S = 2.0


def utcnow() -> datetime:
    return datetime.now(UTC)


class TelemetryBus:
    """Starea live a unei mașini + distribuția eșantioanelor către consumatori."""

    def __init__(self, buffer_size: int = 6000) -> None:
        self._buffer: deque[Sample] = deque(maxlen=buffer_size)
        self._states: dict[str, SignalState] = {}
        self._recent_sequences: deque[int] = deque(maxlen=256)
        self._recv_monotonic: deque[float] = deque(maxlen=RATE_WINDOW)
        self._subscribers: set[asyncio.Queue[Sample]] = set()

        self.vehicle_id: str | None = None
        self.session_id: str | None = None
        self.last_message_at: datetime | None = None
        self.stats = StreamStats()

    # --- ingest -----------------------------------------------------------

    def ingest(self, message: TelemetryMessage) -> Sample:
        """Înregistrează un mesaj și întoarce eșantionul normalizat."""
        now = utcnow()
        received_at = now

        if message.session_id != self.session_id or message.vehicle_id != self.vehicle_id:
            self._reset_stream(message)

        self._track_sequence(message.sequence)
        self._track_rate()

        for key, value in message.signals.items():
            signal = BY_KEY.get(key)
            state = self._states.setdefault(key, SignalState())
            state.value = value
            state.received_at = received_at
            state.sensor_error = is_sensor_error(signal, value) if signal else False

        timestamp = message.timestamp
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=UTC)

        self.stats.received += 1
        self.stats.last_sequence = message.sequence
        self.stats.clock_offset_ms = int((received_at - timestamp).total_seconds() * 1000)
        self.last_message_at = received_at

        sample = Sample(
            timestamp=timestamp,
            server_received_at=received_at,
            sequence=message.sequence,
            signals=dict(message.signals),
        )
        self._buffer.append(sample)
        self._publish(sample)
        return sample

    def record_invalid(self) -> None:
        """Un mesaj a fost respins de validare."""
        self.stats.invalid += 1

    def _reset_stream(self, message: TelemetryMessage) -> None:
        self.vehicle_id = message.vehicle_id
        self.session_id = message.session_id
        self._recent_sequences.clear()
        self._recv_monotonic.clear()
        self._states.clear()
        self._buffer.clear()
        self.stats = StreamStats()

    def _track_sequence(self, sequence: int) -> None:
        last = self.stats.last_sequence
        if last is None:
            self._recent_sequences.append(sequence)
            return

        if sequence in self._recent_sequences:
            self.stats.duplicates += 1
            return

        delta = sequence - last
        if delta > 1:
            self.stats.dropped += delta - 1
        elif delta <= 0:
            if delta > SEQUENCE_RESET_THRESHOLD:
                self.stats.out_of_order += 1
            else:
                # Numărător resetat: repornim urmărirea fără să raportăm eroare.
                self._recent_sequences.clear()

        self._recent_sequences.append(sequence)

    def _track_rate(self) -> None:
        self._recv_monotonic.append(time.monotonic())
        if len(self._recv_monotonic) >= 2:
            span = self._recv_monotonic[-1] - self._recv_monotonic[0]
            self.stats.effective_hz = (
                round((len(self._recv_monotonic) - 1) / span, 2) if span > 0 else 0.0
            )

    # --- fanout -----------------------------------------------------------

    def subscribe(self, maxsize: int = 512) -> asyncio.Queue[Sample]:
        queue: asyncio.Queue[Sample] = asyncio.Queue(maxsize=maxsize)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Sample]) -> None:
        self._subscribers.discard(queue)

    def _publish(self, sample: Sample) -> None:
        for queue in self._subscribers:
            try:
                queue.put_nowait(sample)
            except asyncio.QueueFull:
                # Consumatorul e în urmă. Aruncăm cel mai vechi eșantion, nu pe
                # cel nou: pentru un dashboard live, datele recente contează.
                try:
                    queue.get_nowait()
                    queue.put_nowait(sample)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    # --- citire -----------------------------------------------------------

    @property
    def latest(self) -> Sample | None:
        return self._buffer[-1] if self._buffer else None

    def history(self, since: datetime | None = None, limit: int = 1200) -> list[Sample]:
        """Ultimele eșantioane din buffer, opțional mai noi decât ``since``."""
        if since is None:
            return list(self._buffer)[-limit:]

        if since.tzinfo is None:
            since = since.replace(tzinfo=UTC)

        selected = [s for s in self._buffer if s.server_received_at > since]
        return selected[-limit:]

    def quality(self, now: datetime | None = None) -> dict[str, SignalQuality]:
        """Starea de calitate pentru fiecare semnal din catalog."""
        moment = now or utcnow()
        result: dict[str, SignalQuality] = {}

        for key, signal in BY_KEY.items():
            state = self._states.get(key, SignalState())
            kind, age_ms, value = classify(signal, state, moment)
            result[key] = SignalQuality(state=kind, age_ms=age_ms, value=value)

        return result

    def current_stats(self, now: datetime | None = None) -> StreamStats:
        """Statisticile de moment.

        Frecvența efectivă se calculează din momentele de recepție, deci ar
        rămâne înghețată la ultima valoare când mașina amuțește. Un dashboard
        care afișează „10 Hz" lângă „ultimul mesaj acum 12 s" se contrazice
        singur, așa că o coborâm la zero când fluxul s-a oprit.
        """
        stats = self.stats.model_copy()
        age = self.age_s(now)
        if age is None or age > RATE_DECAY_AFTER_S:
            stats.effective_hz = 0.0
        return stats

    def signal_value(self, key: str) -> float | None:
        state = self._states.get(key)
        return state.value if state else None

    def age_s(self, now: datetime | None = None) -> float | None:
        """Vechimea ultimului mesaj primit, în secunde."""
        if self.last_message_at is None:
            return None
        return ((now or utcnow()) - self.last_message_at).total_seconds()
