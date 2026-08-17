"""Înregistrarea sesiunilor.

Când înregistrarea este pornită, fiecare eșantion primit pe magistrală este
scris în stocare, în loturi, ca să nu facem un commit pe fiecare mesaj. La 10 Hz
un lot de 100 de eșantioane înseamnă o scriere la ~10 secunde.
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import datetime

from ..schemas import Alarm, Sample, SessionInfo
from ..storage.base import TelemetryStorage
from .bus import TelemetryBus, utcnow

FLUSH_INTERVAL_S = 1.0
FLUSH_BATCH = 100


class SessionRecorder:
    def __init__(self, bus: TelemetryBus, storage: TelemetryStorage) -> None:
        self._bus = bus
        self._storage = storage
        self._session: SessionInfo | None = None
        self._queue: asyncio.Queue[Sample] | None = None
        self._task: asyncio.Task[None] | None = None
        self._pending: list[Sample] = []

    @property
    def active_session(self) -> SessionInfo | None:
        return self._session

    @property
    def session_id(self) -> str | None:
        return self._session.id if self._session else None

    async def start(self, note: str = "", session_id: str | None = None) -> SessionInfo:
        if self._session is not None:
            return self._session

        started_at = utcnow()
        vehicle_id = self._bus.vehicle_id or "unknown"
        generated = session_id or f"{vehicle_id}-{started_at.strftime('%Y%m%d-%H%M%S')}"

        self._session = await self._storage.create_session(
            generated, vehicle_id, started_at, note
        )
        self._queue = self._bus.subscribe()
        self._task = asyncio.create_task(self._drain(), name="session-recorder")
        return self._session

    async def stop(self) -> SessionInfo | None:
        if self._session is None:
            return None

        session_id = self._session.id

        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

        if self._queue is not None:
            self._bus.unsubscribe(self._queue)
            self._drain_queue_sync()
            self._queue = None

        await self._flush()
        finished = await self._storage.end_session(session_id, utcnow())
        self._session = None
        return finished

    async def record_alarms(self, transitions: list[Alarm]) -> None:
        """Persistă tranzițiile de alarmă în sesiunea curentă."""
        if self._session is None or not transitions:
            return

        for alarm in transitions:
            await self._storage.write_alarm(self._session.id, alarm)

    async def _drain(self) -> None:
        assert self._queue is not None
        last_flush = asyncio.get_running_loop().time()

        while True:
            try:
                sample = await asyncio.wait_for(self._queue.get(), timeout=FLUSH_INTERVAL_S)
                self._pending.append(sample)
            except TimeoutError:
                pass

            now = asyncio.get_running_loop().time()
            if len(self._pending) >= FLUSH_BATCH or (
                self._pending and now - last_flush >= FLUSH_INTERVAL_S
            ):
                await self._flush()
                last_flush = now

    def _drain_queue_sync(self) -> None:
        assert self._queue is not None
        while True:
            try:
                self._pending.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                return

    async def _flush(self) -> None:
        if not self._pending or self._session is None:
            return

        batch, self._pending = self._pending, []
        await self._storage.write_samples(self._session.id, batch)

    async def sample_window(self) -> tuple[datetime | None, datetime | None]:
        """Intervalul acoperit de sesiunea activă, util pentru UI."""
        if self._session is None:
            return None, None
        return self._session.started_at, self._session.ended_at
