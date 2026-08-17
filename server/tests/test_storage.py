"""Stocarea sesiunilor: scriere, citire pentru replay și export CSV."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.schemas import Alarm, Sample
from app.storage.sqlite import SqliteStorage


@pytest.fixture
async def storage(tmp_path):
    store = SqliteStorage(str(tmp_path / "test.db"))
    await store.connect()
    yield store
    await store.close()


def make_samples(count: int, start: datetime) -> list[Sample]:
    return [
        Sample(
            timestamp=start + timedelta(seconds=index / 10),
            server_received_at=start + timedelta(seconds=index / 10),
            sequence=index,
            signals={"vehicle_speed_kph": 40.0 + index, "battery_soc_pct": 90.0 - index * 0.1},
        )
        for index in range(count)
    ]


async def test_ciclu_complet_de_sesiune(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("s1", "solar-car-01", start, note="test")
    await storage.write_samples("s1", make_samples(25, start))

    session = await storage.get_session("s1")
    assert session is not None
    assert session.sample_count == 25
    assert session.ended_at is None

    ended = await storage.end_session("s1", start + timedelta(minutes=1))
    assert ended is not None
    assert ended.ended_at is not None


async def test_citirea_esantioanelor_este_ordonata(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("s1", "solar-car-01", start)
    await storage.write_samples("s1", make_samples(10, start))

    samples = await storage.read_samples("s1")
    assert [sample.sequence for sample in samples] == list(range(10))
    assert samples[3].signals["vehicle_speed_kph"] == 43.0


async def test_citirea_pe_interval(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("s1", "solar-car-01", start)
    await storage.write_samples("s1", make_samples(20, start))

    window = await storage.read_samples(
        "s1", start=start + timedelta(seconds=0.5), end=start + timedelta(seconds=1.0)
    )
    assert [sample.sequence for sample in window] == [5, 6, 7, 8, 9, 10]


async def test_exportul_csv(storage: SqliteStorage) -> None:
    start = datetime.now(UTC)
    await storage.create_session("s1", "solar-car-01", start)
    await storage.write_samples("s1", make_samples(3, start))

    chunks = [chunk async for chunk in storage.iter_csv("s1")]
    text = "".join(chunks)
    lines = text.strip().splitlines()

    header = lines[0].split(",")
    assert header[:3] == ["timestamp", "server_received_at", "sequence"]
    assert "vehicle_speed_kph" in header
    assert len(lines) == 4  # antet + 3 eșantioane

    speed_index = header.index("vehicle_speed_kph")
    assert lines[1].split(",")[speed_index] == "40"
    # Semnalele netrimise rămân goale, nu devin zero.
    motor_index = header.index("motor_temp_c")
    assert lines[1].split(",")[motor_index] == ""


async def test_scrierea_alarmelor(storage: SqliteStorage) -> None:
    now = datetime.now(UTC)
    await storage.create_session("s1", "solar-car-01", now)

    alarm = Alarm(
        id="battery_soc_pct:warn_low@1",
        key="battery_soc_pct:warn_low",
        label="Stare baterie",
        severity="warning",
        message="SOC scăzut",
        signal_key="battery_soc_pct",
        value=22.0,
        threshold=25.0,
        raised_at=now,
    )
    await storage.write_alarm("s1", alarm)

    alarm.cleared_at = now + timedelta(seconds=30)
    alarm.active = False
    await storage.write_alarm("s1", alarm)

    stored = await storage.read_alarms("s1")
    assert len(stored) == 1
    assert stored[0].cleared_at is not None
    assert stored[0].active is False
