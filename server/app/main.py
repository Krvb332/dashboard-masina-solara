"""Punctul de intrare al serviciului de telemetrie - TUCN Racing Team."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import rest, weather, ws
from .config import settings
from .core.weather import weather_service
from .ingest import http as http_ingest
from .ingest.mqtt import mqtt_ingest_loop
from .runtime import runtime

# Mesajele de log conțin diacritice, iar consola implicită de Windows este
# cp1252: fără asta, un mesaj de alarmă ar arunca UnicodeEncodeError.
for _stream in (sys.stdout, sys.stderr):
    _reconfigure = getattr(_stream, "reconfigure", None)
    if _reconfigure is not None:
        _reconfigure(encoding="utf-8", errors="replace")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await runtime.start()
    mqtt_task = asyncio.create_task(mqtt_ingest_loop(), name="mqtt-ingest")

    try:
        yield
    finally:
        mqtt_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await mqtt_task
        await runtime.stop()
        await weather_service.aclose()


app = FastAPI(
    title="TUCN Racing Team - serviciu de telemetrie",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rest.router)
app.include_router(weather.router)
app.include_router(http_ingest.router)
app.include_router(ws.router)


@app.get("/", include_in_schema=False)
async def index() -> dict:
    return {
        "service": "tucn-telemetry",
        "docs": "/docs",
        "websocket": "/ws/telemetry",
    }
