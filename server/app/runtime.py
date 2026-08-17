"""Starea partajată a serviciului și bucla de evaluare a alarmelor."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from .config import settings
from .core.alarms import AlarmEngine
from .core.bus import TelemetryBus, utcnow
from .core.sessions import SessionRecorder
from .storage.sqlite import SqliteStorage

logger = logging.getLogger("telemetry.runtime")

# Alarmele se evaluează independent de clienții conectați: dacă nimeni nu are
# dashboardul deschis, tranzițiile trebuie totuși înregistrate în sesiune.
ALARM_TICK_S = 0.2


class Runtime:
    def __init__(self) -> None:
        self.bus = TelemetryBus(buffer_size=settings.buffer_size)
        self.storage = SqliteStorage(settings.db_path)
        self.recorder = SessionRecorder(self.bus, self.storage)
        self.engine = AlarmEngine()
        self.started_at = time.monotonic()
        self.mqtt_connected = False
        self._alarm_task: asyncio.Task[None] | None = None

    @property
    def uptime_s(self) -> float:
        return time.monotonic() - self.started_at

    async def start(self) -> None:
        await self.storage.connect()
        self.engine = AlarmEngine(started_at=utcnow())
        self._alarm_task = asyncio.create_task(self._alarm_loop(), name="alarm-loop")

    async def stop(self) -> None:
        if self._alarm_task is not None:
            self._alarm_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._alarm_task
            self._alarm_task = None

        with contextlib.suppress(Exception):
            await self.recorder.stop()

        await self.storage.close()

    async def _alarm_loop(self) -> None:
        while True:
            await asyncio.sleep(ALARM_TICK_S)
            try:
                transitions = self.engine.evaluate(self.bus)
                if transitions:
                    await self.recorder.record_alarms(transitions)
                    for alarm in transitions:
                        verb = "activată" if alarm.active else "stinsă"
                        logger.info("Alarmă %s %s: %s", alarm.key, verb, alarm.message)
            except Exception:  # pragma: no cover - bucla nu trebuie să moară
                logger.exception("Eroare la evaluarea alarmelor")


runtime = Runtime()
