"""Endpointul de vreme: proxy către furnizorul meteo, cu cheia ținută pe server.

Poziția pentru care se cere vremea, în ordinea încrederii:

1. coordonatele trimise explicit de client (``?lat=&lon=``) — util în replay,
   când interesează vremea de la locul și momentul înregistrării;
2. ultimul fix GPS al mașinii, citit direct din magistrala de telemetrie;
3. coordonatele circuitului din configurație.

Dacă niciuna nu există, răspunsul spune asta pe față. Un dashboard care ar
afișa vremea din Greenwich pentru că receptorul raportează ``0, 0`` ar fi mai
periculos decât unul care nu afișează nimic.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..auth import ViewerRole
from ..core.weather import weather_service
from ..runtime import runtime
from ..schemas import WeatherReport

router = APIRouter(prefix="/api/v1", tags=["weather"])


@router.get("/weather", response_model=WeatherReport)
async def get_weather(
    _: ViewerRole,
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
) -> WeatherReport:
    latitude = lat if lat is not None else runtime.bus.signal_value("gps_latitude_deg")
    longitude = lon if lon is not None else runtime.bus.signal_value("gps_longitude_deg")

    return await weather_service.report(latitude, longitude)
