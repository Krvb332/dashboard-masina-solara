"""Ingestie prin HTTP.

Folosită de simulator în modul ``--direct`` (dezvoltare fără broker) și ca rută
de rezervă pentru mașină atunci când MQTT nu este disponibil.
"""

from __future__ import annotations

from fastapi import APIRouter, status

from ..runtime import runtime
from ..schemas import SCHEMA_VERSION, TelemetryMessage

router = APIRouter(prefix="/api/v1", tags=["ingest"])


@router.post("/telemetry", status_code=status.HTTP_202_ACCEPTED)
async def ingest_telemetry(messages: TelemetryMessage | list[TelemetryMessage]) -> dict:
    """Acceptă un mesaj sau un lot (retransmisie după reconectare)."""
    batch = messages if isinstance(messages, list) else [messages]

    accepted = 0
    for message in batch:
        if message.schema_version != SCHEMA_VERSION:
            runtime.bus.record_invalid()
            continue
        runtime.bus.ingest(message)
        accepted += 1

    return {"accepted": accepted, "rejected": len(batch) - accepted}
