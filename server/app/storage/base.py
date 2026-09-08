"""Interfața de stocare.

Acesta este punctul de migrare spre TimescaleDB. Restul aplicației depinde doar
de acest protocol, deci trecerea de la SQLite la Postgres + Timescale înseamnă o
singură clasă nouă care implementează aceleași metode.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from datetime import datetime
from typing import Protocol

from ..schemas import Alarm, Sample, SessionInfo


class TelemetryStorage(Protocol):
    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def create_session(
        self, session_id: str, vehicle_id: str, started_at: datetime, note: str = ""
    ) -> SessionInfo: ...

    async def end_session(self, session_id: str, ended_at: datetime) -> SessionInfo | None: ...

    async def list_sessions(self, limit: int = 100) -> list[SessionInfo]: ...

    async def get_session(self, session_id: str) -> SessionInfo | None: ...

    async def write_samples(self, session_id: str, samples: Sequence[Sample]) -> None: ...

    async def write_alarm(self, session_id: str, alarm: Alarm) -> None: ...

    async def read_samples(
        self,
        session_id: str,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 5000,
        offset: int = 0,
    ) -> list[Sample]: ...

    async def read_alarms(self, session_id: str) -> list[Alarm]: ...

    def iter_csv(self, session_id: str) -> AsyncIterator[str]: ...
