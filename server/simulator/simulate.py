"""Simulator de telemetrie pentru mașina solară - TUCN Racing Team.

Permite dezvoltarea și testarea întregului lanț fără mașina reală. Modelul nu
este o simulare de înaltă fidelitate, dar respectă legăturile fizice care contează
pentru dashboard: puterea urmează viteza, SOC-ul scade pe măsură ce consumi,
temperaturile urcă cu întârziere față de sarcină, iar traseul GPS este o buclă
închisă, deci harta și numărătorul de tururi au sens.

Exemple:

    python simulate.py --direct                    # trimite prin HTTP, fără broker
    python simulate.py --mqtt --broker localhost   # trimite prin MQTT, QoS 1
    python simulate.py --direct --overheat         # forțează alarmele termice
    python simulate.py --direct --drop-link 8      # taie legătura periodic
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime

# --- parametrii mașinii ----------------------------------------------------

MASS_KG = 280.0
ROLLING_RESISTANCE = 0.006
DRAG_AREA = 0.12  # Cd * A
AIR_DENSITY = 1.2
GRAVITY = 9.81
DRIVETRAIN_EFFICIENCY = 0.92
BATTERY_CAPACITY_WH = 5000.0
CELLS_IN_SERIES = 32
INTERNAL_RESISTANCE_OHM = 0.08
MAX_LATERAL_ACCEL = 4.0
MAX_SPEED_MS = 30.0
# Mașinile solare accelerează blând: puterea disponibilă e mică, iar accelerările
# agresive ar consuma bugetul de energie al cursei.
MAX_ACCEL_MS2 = 0.9
MAX_BRAKE_MS2 = 1.6
AMBIENT_C = 24.0

# --- traseul (buclă eliptică lângă Cluj-Napoca) ----------------------------

TRACK_CENTER_LAT = 46.7712
TRACK_CENTER_LON = 23.6236
TRACK_RADIUS_A_M = 250.0
TRACK_RADIUS_B_M = 140.0
METERS_PER_DEG_LAT = 111_320.0


@dataclass
class CarState:
    theta: float = 0.0  # poziția unghiulară pe buclă
    speed_ms: float = 8.0
    soc_pct: float = 92.0
    distance_m: float = 0.0
    lap: int = 0
    motor_temp_c: float = AMBIENT_C
    inverter_temp_c: float = AMBIENT_C
    battery_temp_c: float = AMBIENT_C
    cell_delta_v: float = 0.02
    energy_consumed_wh: float = 0.0
    energy_regen_wh: float = 0.0
    energy_solar_wh: float = 0.0
    sun_minutes: float = 11 * 60.0  # ora simulată, în minute de la miezul nopții
    faults: set[str] = field(default_factory=set)


def track_point(theta: float) -> tuple[float, float]:
    """Coordonate GPS pentru poziția unghiulară dată."""
    x_m = TRACK_RADIUS_A_M * math.cos(theta)
    y_m = TRACK_RADIUS_B_M * math.sin(theta)

    lat = TRACK_CENTER_LAT + y_m / METERS_PER_DEG_LAT
    meters_per_deg_lon = METERS_PER_DEG_LAT * math.cos(math.radians(TRACK_CENTER_LAT))
    lon = TRACK_CENTER_LON + x_m / meters_per_deg_lon
    return lat, lon


def curvature_radius(theta: float) -> float:
    """Raza de curbură a elipsei în punctul dat - dictează viteza maximă în viraj."""
    a, b = TRACK_RADIUS_A_M, TRACK_RADIUS_B_M
    numerator = (a**2 * math.sin(theta) ** 2 + b**2 * math.cos(theta) ** 2) ** 1.5
    return max(numerator / (a * b), 1.0)


def arc_speed(theta: float) -> float:
    """Viteza cerută de traseu în punctul curent, limitată de accelerația laterală."""
    return min(math.sqrt(MAX_LATERAL_ACCEL * curvature_radius(theta)), MAX_SPEED_MS)


def solar_power_w(state: CarState, rng: random.Random) -> float:
    """Putere solară în funcție de ora simulată, cu nori aleatori."""
    hour = (state.sun_minutes / 60.0) % 24.0
    elevation = math.sin(math.pi * (hour - 6.0) / 12.0)
    if elevation <= 0:
        return 0.0

    clouds = 1.0 - 0.25 * max(0.0, math.sin(state.sun_minutes / 7.0)) - rng.uniform(0, 0.05)
    return max(0.0, 1250.0 * elevation * clouds)


def step(state: CarState, dt: float, rng: random.Random) -> dict[str, float]:
    """Avansează modelul cu ``dt`` secunde și întoarce semnalele de telemetrie."""
    # --- dinamică longitudinală ---
    target = arc_speed(state.theta)
    if "soc_drain" in state.faults:
        target = min(target * 1.15, MAX_SPEED_MS)

    delta_v = target - state.speed_ms
    accel = max(-MAX_BRAKE_MS2, min(MAX_ACCEL_MS2, delta_v / max(dt, 0.05)))
    state.speed_ms = max(0.0, state.speed_ms + accel * dt)

    radius = curvature_radius(state.theta)
    state.theta = (state.theta + state.speed_ms * dt / radius) % (2 * math.pi)
    if state.theta < state.speed_ms * dt / radius:
        state.lap += 1

    state.distance_m += state.speed_ms * dt

    # --- putere ---
    rolling = ROLLING_RESISTANCE * MASS_KG * GRAVITY
    drag = 0.5 * AIR_DENSITY * DRAG_AREA * state.speed_ms**2
    inertia = MASS_KG * accel
    mechanical_w = (rolling + drag + inertia) * state.speed_ms

    if mechanical_w >= 0:
        motor_w = mechanical_w / DRIVETRAIN_EFFICIENCY
    else:
        motor_w = mechanical_w * 0.55  # regenerare parțială

    solar_w = solar_power_w(state, rng)
    battery_w = motor_w - solar_w

    # --- baterie ---
    delta_wh = battery_w * dt / 3600.0
    state.soc_pct = max(0.0, min(100.0, state.soc_pct - delta_wh / BATTERY_CAPACITY_WH * 100.0))

    if battery_w > 0:
        state.energy_consumed_wh += delta_wh
    else:
        state.energy_regen_wh += -delta_wh
    state.energy_solar_wh += solar_w * dt / 3600.0

    soc_fraction = state.soc_pct / 100.0
    cell_nominal = 3.20 + 0.95 * soc_fraction
    pack_open_v = cell_nominal * CELLS_IN_SERIES
    current_a = battery_w / max(pack_open_v, 1.0)
    pack_v = pack_open_v - current_a * INTERNAL_RESISTANCE_OHM

    spread = state.cell_delta_v + abs(current_a) * 0.0009
    if "cell_fault" in state.faults:
        spread += 0.22
    cell_min = pack_v / CELLS_IN_SERIES - spread / 2
    cell_max = pack_v / CELLS_IN_SERIES + spread / 2

    # --- temperaturi (întârziere de ordinul întâi față de sarcină) ---
    overheat = "overheat" in state.faults
    motor_target = AMBIENT_C + abs(motor_w) * 0.011 + (45 if overheat else 0)
    inverter_target = AMBIENT_C + abs(motor_w) * 0.007 + (35 if overheat else 0)
    battery_target = AMBIENT_C + current_a**2 * 0.010 + (28 if overheat else 0)

    state.motor_temp_c += (motor_target - state.motor_temp_c) * dt / 45.0
    state.inverter_temp_c += (inverter_target - state.inverter_temp_c) * dt / 25.0
    state.battery_temp_c += (battery_target - state.battery_temp_c) * dt / 90.0

    battery_delta = 2.5 + abs(current_a) * 0.06 + (7 if overheat else 0)

    # --- GPS ---
    lat, lon = track_point(state.theta)
    gps_glitch = "gps_glitch" in state.faults
    hdop = (4.8 if gps_glitch else 0.8) + rng.uniform(0, 0.4)
    satellites = float(rng.randint(4, 6) if gps_glitch else rng.randint(9, 14))

    state.sun_minutes += dt / 60.0 * 30.0  # timpul solar curge accelerat

    return {
        "vehicle_speed_kph": round(state.speed_ms * 3.6, 2),
        "lap_number": float(state.lap),
        "distance_km": round(state.distance_m / 1000.0, 3),
        "battery_soc_pct": round(state.soc_pct, 2),
        "battery_voltage_v": round(pack_v, 2),
        "battery_current_a": round(current_a, 2),
        "battery_power_w": round(battery_w, 1),
        "cell_voltage_min_v": round(cell_min, 4),
        "cell_voltage_max_v": round(cell_max, 4),
        "solar_power_w": round(solar_w, 1),
        "mppt1_power_w": round(solar_w * 0.26, 1),
        "mppt2_power_w": round(solar_w * 0.25, 1),
        "mppt3_power_w": round(solar_w * 0.25, 1),
        "mppt4_power_w": round(solar_w * 0.24, 1),
        "energy_consumed_wh": round(state.energy_consumed_wh, 1),
        "energy_regen_wh": round(state.energy_regen_wh, 1),
        "energy_solar_wh": round(state.energy_solar_wh, 1),
        "battery_temp_max_c": round(state.battery_temp_c, 2),
        "battery_temp_min_c": round(state.battery_temp_c - battery_delta, 2),
        "battery_temp_delta_c": round(battery_delta, 2),
        "motor_temp_c": round(state.motor_temp_c, 2),
        "inverter_temp_c": round(state.inverter_temp_c, 2),
        "motor_power_w": round(motor_w, 1),
        "motor_rpm": round(state.speed_ms * 3.6 * 11.5, 0),
        "throttle_pct": round(max(0.0, min(100.0, accel / MAX_ACCEL_MS2 * 100)), 1),
        "gps_latitude_deg": round(lat, 6),
        "gps_longitude_deg": round(lon, 6),
        "gps_hdop": round(hdop, 2),
        "gps_satellites": satellites,
    }


# --- transport -------------------------------------------------------------


class HttpSender:
    def __init__(self, url: str) -> None:
        self._url = url

    async def send(self, payload: dict) -> None:
        await asyncio.to_thread(self._post, payload)

    def _post(self, payload: dict) -> None:
        request = urllib.request.Request(
            self._url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                response.read()
        except (urllib.error.URLError, TimeoutError) as error:
            print(f"[simulator] Serverul nu răspunde: {error}", file=sys.stderr)

    async def close(self) -> None:
        return None


class MqttSender:
    def __init__(self, host: str, port: int, topic: str) -> None:
        import aiomqtt  # importat leneș, ca modul --direct să nu ceară dependența

        self._aiomqtt = aiomqtt
        self._client = aiomqtt.Client(
            hostname=host, port=port, identifier="tucn-simulator",
            protocol=aiomqtt.ProtocolVersion.V5,
        )
        self._topic = topic
        self._entered = False

    async def send(self, payload: dict) -> None:
        if not self._entered:
            await self._client.__aenter__()
            self._entered = True
        await self._client.publish(self._topic, json.dumps(payload).encode(), qos=1)

    async def close(self) -> None:
        if self._entered:
            await self._client.__aexit__(None, None, None)


# --- bucla principală ------------------------------------------------------


async def run(args: argparse.Namespace) -> None:
    rng = random.Random(args.seed)
    state = CarState()

    if args.overheat:
        state.faults.add("overheat")
    if args.soc_drain:
        state.faults.add("soc_drain")
        state.soc_pct = 22.0
    if args.cell_fault:
        state.faults.add("cell_fault")
    if args.gps_glitch:
        state.faults.add("gps_glitch")

    sender: HttpSender | MqttSender
    if args.mqtt:
        topic = args.topic.replace("+", args.vehicle)
        sender = MqttSender(args.broker, args.port, topic)
        print(f"[simulator] MQTT -> {args.broker}:{args.port} pe topicul {topic}")
    else:
        sender = HttpSender(args.url)
        print(f"[simulator] HTTP -> {args.url}")

    session_id = args.session or f"sim-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}"
    interval = 1.0 / args.hz
    sequence = 0
    elapsed = 0.0
    next_tick = asyncio.get_running_loop().time()

    print(
        f"[simulator] vehicul={args.vehicle} sesiune={session_id} "
        f"rată={args.hz} Hz. Ctrl+C pentru oprire."
    )

    try:
        while args.duration <= 0 or elapsed < args.duration:
            signals = step(state, interval, rng)
            sequence += 1
            elapsed += interval

            if _link_down(args, elapsed):
                # Legătura e „căzută": mașina continuă să ruleze, dar nu trimite.
                # Secvența avansează, deci serverul va raporta mesaje pierdute.
                next_tick += interval
                await asyncio.sleep(max(0.0, next_tick - asyncio.get_running_loop().time()))
                continue

            payload = {
                "schema_version": 1,
                "vehicle_id": args.vehicle,
                "session_id": session_id,
                "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "sequence": sequence,
                "signals": signals,
            }
            await sender.send(payload)

            next_tick += interval
            await asyncio.sleep(max(0.0, next_tick - asyncio.get_running_loop().time()))
    except KeyboardInterrupt:
        pass
    finally:
        await sender.close()
        print(f"\n[simulator] Oprit după {sequence} mesaje.")


def _link_down(args: argparse.Namespace, elapsed: float) -> bool:
    """Simulează căderi periodice de legătură, pentru testarea reconectării."""
    if args.drop_link <= 0:
        return False
    cycle = args.drop_every + args.drop_link
    return (elapsed % cycle) >= args.drop_every


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulator de telemetrie pentru mașina solară.")
    parser.add_argument("--hz", type=float, default=10.0, help="mesaje pe secundă")
    parser.add_argument("--vehicle", default="solar-car-01")
    parser.add_argument("--session", default="")
    parser.add_argument("--duration", type=float, default=0, help="secunde; 0 = la nesfârșit")
    parser.add_argument("--seed", type=int, default=7)

    transport = parser.add_mutually_exclusive_group()
    transport.add_argument("--direct", action="store_true", help="trimite prin HTTP (implicit)")
    transport.add_argument("--mqtt", action="store_true", help="trimite prin MQTT")

    parser.add_argument("--url", default="http://localhost:8000/api/v1/telemetry")
    parser.add_argument("--broker", default="localhost")
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--topic", default="solar/+/telemetry")

    parser.add_argument("--overheat", action="store_true", help="forțează alarmele termice")
    parser.add_argument("--soc-drain", action="store_true", help="pornește cu baterie scăzută")
    parser.add_argument("--cell-fault", action="store_true", help="dezechilibru între celule")
    parser.add_argument("--gps-glitch", action="store_true", help="degradează precizia GPS")
    parser.add_argument("--drop-link", type=float, default=0, help="secunde de tăcere")
    parser.add_argument("--drop-every", type=float, default=20, help="la câte secunde se taie")

    return parser.parse_args(argv)


def _force_utf8_output() -> None:
    """Pe Windows consola implicită este cp1252 și nu poate scrie diacritice."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def main() -> None:
    _force_utf8_output()
    args = parse_args()
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
