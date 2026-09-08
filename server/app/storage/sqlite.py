"""Implementare SQLite a stocării de telemetrie.

La 10 Hz, o cursă de opt ore înseamnă ~290.000 de rânduri - dimensiune la care
SQLite se comportă foarte bine și nu cere niciun serviciu suplimentar în
pitlane. Când numărul de mașini sau frecvența cresc, se implementează același
protocol peste TimescaleDB, fără modificări în restul aplicației.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite

from ..schemas import Alarm, Sample, SessionInfo
from ..signals import CATALOG

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    vehicle_id   TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    note         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS samples (
    session_id   TEXT NOT NULL,
    ts           TEXT NOT NULL,
    server_ts    TEXT NOT NULL,
    sequence     INTEGER NOT NULL,
    signals      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_samples_session_ts ON samples (session_id, ts);

CREATE TABLE IF NOT EXISTS alarms (
    id           TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    key          TEXT NOT NULL,
    label        TEXT NOT NULL,
    severity     TEXT NOT NULL,
    message      TEXT NOT NULL,
    signal_key   TEXT,
    value        REAL,
    threshold    REAL,
    raised_at    TEXT NOT NULL,
    cleared_at   TEXT,
    PRIMARY KEY (id, raised_at)
);

CREATE INDEX IF NOT EXISTS idx_alarms_session ON alarms (session_id, raised_at);
"""


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


class SqliteStorage:
    def __init__(self, db_path: str) -> None:
        self._path = Path(db_path)
        self._db: aiosqlite.Connection | None = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("Stocarea nu este conectată.")
        return self._db

    async def connect(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self._path)
        self._db.row_factory = aiosqlite.Row
        # WAL ține scrierile din timpul cursei separate de citirile pentru replay.
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA synchronous=NORMAL")
        await self._db.executescript(SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    # --- sesiuni ----------------------------------------------------------

    async def create_session(
        self, session_id: str, vehicle_id: str, started_at: datetime, note: str = ""
    ) -> SessionInfo:
        await self.db.execute(
            "INSERT OR REPLACE INTO sessions (id, vehicle_id, started_at, ended_at, note)"
            " VALUES (?, ?, ?, NULL, ?)",
            (session_id, vehicle_id, _iso(started_at), note),
        )
        await self.db.commit()
        return SessionInfo(
            id=session_id, vehicle_id=vehicle_id, started_at=started_at, note=note
        )

    async def end_session(self, session_id: str, ended_at: datetime) -> SessionInfo | None:
        await self.db.execute(
            "UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL",
            (_iso(ended_at), session_id),
        )
        await self.db.commit()
        return await self.get_session(session_id)

    async def list_sessions(self, limit: int = 100) -> list[SessionInfo]:
        cursor = await self.db.execute(
            """
            SELECT s.*,
                   (SELECT COUNT(*) FROM samples WHERE samples.session_id = s.id) AS sample_count,
                   (SELECT COUNT(*) FROM alarms  WHERE alarms.session_id  = s.id) AS alarm_count
            FROM sessions s
            ORDER BY s.started_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = await cursor.fetchall()
        return [self._session_from_row(row) for row in rows]

    async def get_session(self, session_id: str) -> SessionInfo | None:
        cursor = await self.db.execute(
            """
            SELECT s.*,
                   (SELECT COUNT(*) FROM samples WHERE samples.session_id = s.id) AS sample_count,
                   (SELECT COUNT(*) FROM alarms  WHERE alarms.session_id  = s.id) AS alarm_count
            FROM sessions s WHERE s.id = ?
            """,
            (session_id,),
        )
        row = await cursor.fetchone()
        return self._session_from_row(row) if row else None

    @staticmethod
    def _session_from_row(row: aiosqlite.Row) -> SessionInfo:
        started = _parse(row["started_at"])
        assert started is not None
        return SessionInfo(
            id=row["id"],
            vehicle_id=row["vehicle_id"],
            started_at=started,
            ended_at=_parse(row["ended_at"]),
            sample_count=row["sample_count"] if "sample_count" in row.keys() else 0,
            alarm_count=row["alarm_count"] if "alarm_count" in row.keys() else 0,
            note=row["note"],
        )

    # --- eșantioane -------------------------------------------------------

    async def write_samples(self, session_id: str, samples: Sequence[Sample]) -> None:
        if not samples:
            return

        await self.db.executemany(
            "INSERT INTO samples (session_id, ts, server_ts, sequence, signals)"
            " VALUES (?, ?, ?, ?, ?)",
            [
                (
                    session_id,
                    _iso(sample.timestamp),
                    _iso(sample.server_received_at),
                    sample.sequence,
                    json.dumps(sample.signals, separators=(",", ":")),
                )
                for sample in samples
            ],
        )
        await self.db.commit()

    async def read_samples(
        self,
        session_id: str,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 5000,
        offset: int = 0,
    ) -> list[Sample]:
        query = "SELECT ts, server_ts, sequence, signals FROM samples WHERE session_id = ?"
        params: list[object] = [session_id]

        if start is not None:
            query += " AND ts >= ?"
            params.append(_iso(start))
        if end is not None:
            query += " AND ts <= ?"
            params.append(_iso(end))

        query += " ORDER BY ts LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await self.db.execute(query, params)
        rows = await cursor.fetchall()
        return [self._sample_from_row(row) for row in rows]

    @staticmethod
    def _sample_from_row(row: aiosqlite.Row) -> Sample:
        ts = _parse(row["ts"])
        server_ts = _parse(row["server_ts"])
        assert ts is not None and server_ts is not None
        return Sample(
            timestamp=ts,
            server_received_at=server_ts,
            sequence=row["sequence"],
            signals=json.loads(row["signals"]),
        )

    # --- alarme -----------------------------------------------------------

    async def write_alarm(self, session_id: str, alarm: Alarm) -> None:
        await self.db.execute(
            """
            INSERT INTO alarms
                (id, session_id, key, label, severity, message, signal_key,
                 value, threshold, raised_at, cleared_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id, raised_at) DO UPDATE SET
                cleared_at = excluded.cleared_at,
                message    = excluded.message,
                value      = excluded.value
            """,
            (
                alarm.id,
                session_id,
                alarm.key,
                alarm.label,
                alarm.severity,
                alarm.message,
                alarm.signal_key,
                alarm.value,
                alarm.threshold,
                _iso(alarm.raised_at),
                _iso(alarm.cleared_at) if alarm.cleared_at else None,
            ),
        )
        await self.db.commit()

    async def read_alarms(self, session_id: str) -> list[Alarm]:
        cursor = await self.db.execute(
            "SELECT * FROM alarms WHERE session_id = ? ORDER BY raised_at",
            (session_id,),
        )
        rows = await cursor.fetchall()
        alarms: list[Alarm] = []
        for row in rows:
            raised = _parse(row["raised_at"])
            assert raised is not None
            alarms.append(
                Alarm(
                    id=row["id"],
                    key=row["key"],
                    label=row["label"],
                    severity=row["severity"],
                    message=row["message"],
                    signal_key=row["signal_key"],
                    value=row["value"],
                    threshold=row["threshold"],
                    raised_at=raised,
                    cleared_at=_parse(row["cleared_at"]),
                    active=row["cleared_at"] is None,
                )
            )
        return alarms

    # --- export -----------------------------------------------------------

    async def iter_csv(self, session_id: str) -> AsyncIterator[str]:
        """Generează CSV-ul unei sesiuni în bucăți, fără să încarce tot în memorie."""
        columns = [signal.key for signal in CATALOG]
        yield ",".join(["timestamp", "server_received_at", "sequence", *columns]) + "\n"

        cursor = await self.db.execute(
            "SELECT ts, server_ts, sequence, signals FROM samples"
            " WHERE session_id = ? ORDER BY ts",
            (session_id,),
        )

        while True:
            rows = await cursor.fetchmany(500)
            if not rows:
                break

            chunk: list[str] = []
            for row in rows:
                signals = json.loads(row["signals"])
                values = [
                    "" if signals.get(key) is None else f"{signals[key]:g}" for key in columns
                ]
                chunk.append(
                    ",".join([row["ts"], row["server_ts"], str(row["sequence"]), *values]) + "\n"
                )
            yield "".join(chunk)
