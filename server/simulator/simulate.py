"""Simulator de telemetrie pentru mașina solară - TUCN Racing Team.

Permite dezvoltarea și testarea întregului lanț fără mașina reală. Modelul nu
este o simulare de înaltă fidelitate, dar respectă legăturile fizice care contează
pentru dashboard: puterea urmează viteza, SOC-ul scade pe măsură ce consumi,
temperaturile urcă cu întârziere față de sarcină, iar traseul GPS este chiar
linia mediană a circuitului Zolder, deci harta, sectoarele și numărătorul de
tururi corespund cu ce proiectează dashboardul.

Geometria vine din ``track_zolder``: aceleași noduri pe care dashboardul își
proiectează fixurile. Mașina înaintează pe lungime de arc, iar viteza în viraj
este limitată de raza de curbură reală a circuitului - deci șicanele sunt lente
și liniile drepte rapide, fără ca nimic să fie ajustat de mână.

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

from .track_zolder import (
    TRACK_LENGTH_M,
    TRACK_NAME,
    curvature_radius_at,
    elevation_at,
    grade_at,
    heading_at,
    point_at,
    sector_at,
)

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

# --- traseul (Circuit Zolder, geometrie reală) -----------------------------
#
# Denivelarea nu mai este inventată: vine din modelul de teren, odată cu
# nodurile. Zolder urcă și coboară vreo șaptesprezece metri pe tur, suficient
# cât profilul de elevație și corecția de pantă din dashboard să aibă ce arăta.

# --- pachetul de baterii ---------------------------------------------------

# Abaterea fiecărei celule față de media pachetului, în volți. Tiparul este fix,
# nu aleator: o celulă slabă trebuie să rămână aceeași celulă de la un eșantion
# la altul, altfel indicele celulei minime ar sări în fiecare cadru.
CELL_OFFSETS_V: tuple[float, ...] = tuple(
    round(0.012 * math.sin(index * 1.7) - (0.045 if index == 16 else 0.0), 4)
    for index in range(CELLS_IN_SERIES)
)

PACK_CAPACITY_AH = 45.0
PACK_DESIGN_CAPACITY_AH = 48.0


@dataclass
class CarState:
    s_m: float = 0.0  # distanța de la linia de start, pe linia mediană
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
    # Placa de achiziție: contoare proprii, independente de dinamica mașinii.
    uptime_s: float = 0.0
    can_errors: int = 0
    board_temp_c: float = AMBIENT_C + 8.0
    cycles: float = 12.0
    tire_temp_c: float = AMBIENT_C
    elevation_m: float = elevation_at(0.0)


#: Pe ce distanță în față se uită pilotul după viraje, în metri.
#:
#: La 30 m/s, șaptezeci de metri înseamnă puțin peste două secunde - cam cât
#: durează frânarea de la viteza maximă la cea de șicană, cu decelerarea unei
#: mașini solare.
LOOKAHEAD_M = 70.0

#: Pasul de eșantionare al ferestrei. Zece metri prinde orice viraj de circuit;
#: mai fin ar însemna mai multe evaluări de curbură la fiecare cadru, degeaba.
LOOKAHEAD_STEP_M = 10


def arc_speed(s_m: float) -> float:
    """Viteza pe care o permite traseul la distanța dată, în m/s.

    Limita este accelerația laterală: într-un viraj de rază ``R`` nu se poate
    merge mai repede de ``sqrt(a_lat * R)`` fără să plece mașina din traseu. Pe
    geometria reală a circuitului asta produce singură profilul de viteză -
    șicanele Kleine Chicane încetinesc mașina, linia dreaptă principală o lasă
    la viteza maximă - fără niciun profil scris de mână.

    Limita se ia pe cea mai strânsă curbă din fereastra imediat următoare, nu
    pe cea din punctul curent: un pilot frânează *intrând* în viraj, nu când
    este deja în el. Fără anticipare, mașina ar ajunge în șicană cu viteza
    liniei drepte și ar încetini brusc acolo, iar puterea raportată ar avea un
    vârf de frânare care nu există în realitate.
    """
    limit = MAX_SPEED_MS
    for step_m in range(0, int(LOOKAHEAD_M) + 1, LOOKAHEAD_STEP_M):
        radius = curvature_radius_at(s_m + step_m)
        limit = min(limit, math.sqrt(MAX_LATERAL_ACCEL * radius))
    return limit


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
    target = arc_speed(state.s_m)
    if "soc_drain" in state.faults:
        target = min(target * 1.15, MAX_SPEED_MS)

    delta_v = target - state.speed_ms
    accel = max(-MAX_BRAKE_MS2, min(MAX_ACCEL_MS2, delta_v / max(dt, 0.05)))
    state.speed_ms = max(0.0, state.speed_ms + accel * dt)

    # Pe linia mediană, avansul *este* distanța parcursă. Parametrizarea
    # unghiulară de dinainte cerea o corecție aici, ca poziția GPS să nu
    # înainteze cu altă viteză decât cea raportată; pe lungime de arc problema
    # nu mai are cum să apară.
    advance = state.speed_ms * dt
    state.s_m += advance
    if state.s_m >= TRACK_LENGTH_M:
        state.s_m -= TRACK_LENGTH_M
        state.lap += 1

    state.distance_m += advance

    # --- putere ---
    # Panta intră în bilanț: fără ea, altitudinea raportată ar contrazice
    # puterea raportată, iar verificarea de coerență din dashboard ar semnala pe
    # bună dreptate o nepotrivire.
    grade = grade_at(state.s_m)
    state.elevation_m = elevation_at(state.s_m)

    rolling = ROLLING_RESISTANCE * MASS_KG * GRAVITY
    drag = 0.5 * AIR_DENSITY * DRAG_AREA * state.speed_ms**2
    inertia = MASS_KG * accel
    climb = MASS_KG * GRAVITY * math.sin(math.atan(grade))
    mechanical_w = (rolling + drag + inertia + climb) * state.speed_ms

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
    lat, lon = point_at(state.s_m)
    gps_glitch = "gps_glitch" in state.faults
    hdop = (4.8 if gps_glitch else 0.8) + rng.uniform(0, 0.4)
    satellites = float(rng.randint(4, 6) if gps_glitch else rng.randint(9, 14))
    # Receptorul are dispersie mai mare pe verticală decât pe orizontală;
    # raportul de ~1,6 este tipic pentru o constelație GPS obișnuită.
    vdop = hdop * 1.6 + rng.uniform(0, 0.2)
    # Altitudinea raportată nu este cea a traseului: are zgomotul receptorului.
    altitude = state.elevation_m + rng.uniform(-0.6, 0.6) * (4.0 if gps_glitch else 1.0)
    # Direcția o dă tangenta la linia mediană în punctul curent; 0° = nord.
    heading = heading_at(state.s_m)
    gps_speed_kph = state.speed_ms * 3.6 * (1.0 + rng.uniform(-0.01, 0.01))
    fix_quality = 0.0 if (gps_glitch and satellites < 5) else 1.0

    state.sun_minutes += dt / 60.0 * 30.0  # timpul solar curge accelerat

    # --- celule individuale ---
    cell_average_v = pack_v / CELLS_IN_SERIES
    imbalance_scale = spread / max(state.cell_delta_v, 1e-6)
    cells = [
        cell_average_v + offset * imbalance_scale for offset in CELL_OFFSETS_V
    ]
    # Extremele raportate de BMS trebuie să fie chiar extremele celulelor, altfel
    # verificarea de coerență din dashboard ar semnala corect o nepotrivire.
    cell_min = min(cells)
    cell_max = max(cells)
    cell_min_index = float(cells.index(cell_min) + 1)
    cell_max_index = float(cells.index(cell_max) + 1)
    spread = cell_max - cell_min

    # --- placa de achiziție ---
    state.uptime_s += dt
    state.board_temp_c += (
        AMBIENT_C + 14.0 + abs(current_a) * 0.05 - state.board_temp_c
    ) * dt / 60.0
    if rng.random() < dt * 0.02:
        state.can_errors += 1

    # --- anvelope ---
    state.tire_temp_c += (
        AMBIENT_C + 6.0 + state.speed_ms * 0.8 - state.tire_temp_c
    ) * dt / 120.0
    tire_pressure = 3.2 + (state.tire_temp_c - AMBIENT_C) * 0.006

    # --- controller Mitsuba ---
    regen_active = 1.0 if motor_w < -1.0 else 0.0
    regen_power_w = max(0.0, -motor_w)
    overheat_level = float(
        3 if state.motor_temp_c > 110 else 2 if state.motor_temp_c > 95 else
        1 if state.motor_temp_c > 85 else 0
    )
    fault_bits = 0
    if "motor_fault" in state.faults:
        fault_bits |= (1 << 17) | (1 << 29)
    if abs(current_a) > 90:
        fault_bits |= 1 << 23  # limită de curent atinsă: protecția lucrează

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
        # --- GPS extins ---
        "gps_altitude_m": round(altitude, 2),
        "gps_speed_kph": round(gps_speed_kph, 2),
        "gps_course_deg": round(heading, 1),
        "gps_fix_quality": fix_quality,
        "gps_vdop": round(vdop, 2),
        # --- baterie: capacitate, sănătate, celule ---
        "battery_capacity_remain_ah": round(PACK_CAPACITY_AH * soc_fraction, 3),
        "battery_capacity_total_ah": PACK_CAPACITY_AH,
        "battery_cycles": round(state.cycles, 0),
        "battery_soh_pct": round(PACK_CAPACITY_AH / PACK_DESIGN_CAPACITY_AH * 100.0, 1),
        "cell_voltage_delta_v": round(spread, 4),
        "cell_min_index": cell_min_index,
        "cell_max_index": cell_max_index,
        "regen_power_w": round(regen_power_w, 1),
        **{
            f"cell_{index + 1:02d}_v": round(value, 4)
            for index, value in enumerate(cells)
        },
        # --- controller Mitsuba ---
        "motor_current_peak_a": round(abs(current_a) * 1.35, 1),
        "motor_pwm_duty_pct": round(
            max(0.0, min(100.0, abs(motor_w) / 5000.0 * 100.0)), 1
        ),
        "motor_lead_angle_deg": round(12.0 + abs(motor_w) / 5000.0 * 18.0, 1),
        "regen_vr_pct": round(regen_active * 45.0, 0),
        "motor_output_target": round(
            max(0.0, min(255.0, abs(motor_w) / 5000.0 * 255.0)), 0
        ),
        "drive_action": 2.0 if state.speed_ms > 0.2 else 0.0,
        "power_mode": 0.0,
        "motor_ctrl_mode": 1.0,
        "regen_active": regen_active,
        "motor_overheat_level": overheat_level,
        "digi_sw_position": 3.0,
        "motor_fault_code": float(fault_bits),
        # --- senzori de temperatură ---
        "temp_ambient_c": round(AMBIENT_C, 1),
        "temp_cockpit_c": round(AMBIENT_C + 9.0 + state.speed_ms * 0.1, 1),
        "temp_pack_front_c": round(state.battery_temp_c - battery_delta * 0.4, 2),
        "temp_pack_rear_c": round(state.battery_temp_c - battery_delta * 0.1, 2),
        "temp_mppt_c": round(AMBIENT_C + solar_w * 0.018, 1),
        # --- anvelope ---
        "tpms_fl_pressure_bar": round(tire_pressure, 3),
        "tpms_fr_pressure_bar": round(tire_pressure * 0.99, 3),
        "tpms_rl_pressure_bar": round(tire_pressure * 1.01, 3),
        "tpms_rr_pressure_bar": round(tire_pressure * 1.005, 3),
        "tpms_fl_temp_c": round(state.tire_temp_c, 2),
        "tpms_fr_temp_c": round(state.tire_temp_c * 0.99, 2),
        "tpms_rl_temp_c": round(state.tire_temp_c * 1.02, 2),
        "tpms_rr_temp_c": round(state.tire_temp_c * 1.01, 2),
        # --- placa de achiziție ---
        "teensy_temp_c": round(state.board_temp_c, 1),
        "teensy_loop_hz": round(480.0 + rng.uniform(-15, 15), 0),
        "teensy_can_errors": float(state.can_errors),
        "teensy_free_ram_kb": round(196.0 + rng.uniform(-6, 6), 0),
        "teensy_uptime_s": round(state.uptime_s, 0),
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
    if args.motor_fault:
        state.faults.add("motor_fault")

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
    parser.add_argument(
        "--motor-fault", action="store_true", help="ridică biți în codul de eroare Mitsuba"
    )
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
