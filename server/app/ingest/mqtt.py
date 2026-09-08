"""Ingestia prin MQTT: mașină -> broker din pitlane -> serviciu de telemetrie.

Conform documentului de arhitectură folosim MQTT 5 cu QoS 1. Dacă brokerul nu
este configurat sau cade, serviciul continuă să funcționeze: ingestia HTTP
rămâne disponibilă, iar reconectarea se încearcă periodic.
"""

from __future__ import annotations

import asyncio
import logging

import aiomqtt
from pydantic import ValidationError

from ..config import settings
from ..runtime import runtime
from ..schemas import TelemetryMessage

logger = logging.getLogger("telemetry.mqtt")

RECONNECT_DELAY_S = 3.0


async def mqtt_ingest_loop() -> None:
    """Rulează cât timp trăiește aplicația, reconectându-se la nevoie."""
    if not settings.mqtt_host:
        logger.info("MQTT dezactivat (TELEMETRY_MQTT_HOST nu este setat).")
        return

    while True:
        try:
            async with aiomqtt.Client(
                hostname=settings.mqtt_host,
                port=settings.mqtt_port,
                identifier=settings.mqtt_client_id,
                protocol=aiomqtt.ProtocolVersion.V5,
            ) as client:
                runtime.mqtt_connected = True
                logger.info(
                    "Conectat la brokerul MQTT %s:%s, abonat la %s",
                    settings.mqtt_host,
                    settings.mqtt_port,
                    settings.mqtt_topic,
                )
                await client.subscribe(settings.mqtt_topic, qos=1)

                async for message in client.messages:
                    _handle_payload(message.payload)

        except asyncio.CancelledError:
            runtime.mqtt_connected = False
            raise
        except Exception as error:  # broker indisponibil, rețea căzută etc.
            runtime.mqtt_connected = False
            logger.warning("Legătura MQTT a căzut (%s). Reîncerc în %ss.", error, RECONNECT_DELAY_S)
            await asyncio.sleep(RECONNECT_DELAY_S)


def _handle_payload(payload: bytes | bytearray | str | None) -> None:
    if payload is None:
        return

    raw = payload.decode() if isinstance(payload, (bytes, bytearray)) else payload

    try:
        message = TelemetryMessage.model_validate_json(raw)
    except ValidationError as error:
        runtime.bus.record_invalid()
        logger.debug("Mesaj MQTT invalid ignorat: %s", error)
        return

    runtime.bus.ingest(message)
