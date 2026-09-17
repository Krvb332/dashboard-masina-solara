"""Configurarea serviciului, citită din variabile de mediu."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TELEMETRY_", env_file=".env")

    # Stocare
    db_path: str = "data/telemetry.db"

    # Broker MQTT (mașină -> server). Gol = ingest MQTT dezactivat.
    mqtt_host: str = ""
    mqtt_port: int = 1883
    mqtt_topic: str = "solar/+/telemetry"
    mqtt_client_id: str = "tucn-telemetry-server"

    # Ritmul de emisie către browser. Mașina poate trimite mult mai rapid;
    # interfața nu are nevoie de mai mult de 10-20 Hz.
    ws_rate_hz: float = 10.0

    # Câte eșantioane păstrăm în memorie pentru backfill rapid.
    # 6000 la 10 Hz = 10 minute.
    buffer_size: int = 6000

    # Autentificare. Tokenurile goale dezactivează verificarea (util în dev).
    operator_token: str = ""
    viewer_token: str = ""

    # --- Vreme și condiții meteo ---------------------------------------
    #
    # Cheia stă AICI, pe server, niciodată în bundle-ul frontendului: orice
    # variabilă `VITE_*` ajunge în textul livrat browserului. Gol = secțiunea
    # meteo raportează cinstit „indisponibil" în loc să afișeze zerouri.
    weather_api_key: str = ""
    weather_base_url: str = "https://weather.googleapis.com/v1"
    weather_language: str = "ro"
    # Coordonatele circuitului, folosite cât timp GPS-ul nu are fix.
    weather_default_lat: float | None = None
    weather_default_lon: float | None = None
    # Cât timp o observație rămâne bună. Vremea nu se schimbă în zece minute,
    # iar fiecare apel este facturat de furnizor.
    weather_ttl_s: float = 600.0
    weather_timeout_s: float = 8.0
    # Câte ore de prognoză cerem. Zero dezactivează prognoza, păstrând
    # observația curentă.
    weather_forecast_hours: int = 12

    # Originile permise pentru browser.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def auth_enabled(self) -> bool:
        return bool(self.operator_token or self.viewer_token)

    @property
    def ws_interval_s(self) -> float:
        return 1.0 / self.ws_rate_hz if self.ws_rate_hz > 0 else 0.1


settings = Settings()
