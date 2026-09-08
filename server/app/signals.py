"""Catalogul de semnale - sursa unică de adevăr.

Fiecare semnal este definit o singură dată, aici. Catalogul este expus prin
``GET /api/v1/signals``, iar frontendul își construiește cardurile, graficele și
pragurile din el. Adăugarea unui senzor nou înseamnă o linie în acest fișier și
zero modificări în React.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

SignalGroup = Literal["status", "energy", "thermal", "motor", "gps"]


@dataclass(frozen=True, slots=True)
class Signal:
    """Definiția unui semnal de telemetrie.

    Pragurile sunt opționale. ``hysteresis`` este exprimat în unitatea
    semnalului și împiedică alarmele să pâlpâie când valoarea oscilează exact
    în jurul pragului: alarma se activează la prag, dar se stinge doar după ce
    valoarea revine cu ``hysteresis`` dincolo de el.
    """

    key: str
    label: str
    unit: str
    group: SignalGroup
    decimals: int = 1
    min: float | None = None
    max: float | None = None
    stale_after_s: float = 2.0
    warn_below: float | None = None
    crit_below: float | None = None
    warn_above: float | None = None
    crit_above: float | None = None
    hysteresis: float = 0.0
    # Semnalele „overview" apar pe pagina principală ca metric cards.
    overview: bool = False
    # Semnalele marcate pentru grafic sunt propuse implicit în selectorul de serii.
    chartable: bool = True
    # Culoare sugerată pentru serie (frontendul o poate ignora).
    color: str | None = None
    description: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


CATALOG: tuple[Signal, ...] = (
    # --- Stare generală -----------------------------------------------------
    Signal(
        key="vehicle_speed_kph",
        label="Viteză",
        unit="km/h",
        group="status",
        decimals=1,
        min=0,
        max=140,
        overview=True,
        color="#60a5fa",
        description="Viteza la sol raportată de computerul de bord.",
    ),
    Signal(
        key="lap_number",
        label="Tur",
        unit="",
        group="status",
        decimals=0,
        min=0,
        chartable=False,
        description="Numărul turului curent, calculat din trecerile prin start/finiș.",
    ),
    Signal(
        key="distance_km",
        label="Distanță",
        unit="km",
        group="status",
        decimals=2,
        min=0,
        description="Distanța totală parcursă în sesiune.",
    ),
    # --- Energie și baterie -------------------------------------------------
    Signal(
        key="battery_soc_pct",
        label="Stare baterie",
        unit="%",
        group="energy",
        decimals=1,
        min=0,
        max=100,
        warn_below=25,
        crit_below=15,
        hysteresis=2,
        overview=True,
        color="#34d399",
        description="Starea de încărcare estimată de BMS.",
    ),
    Signal(
        key="battery_voltage_v",
        label="Tensiune pachet",
        unit="V",
        group="energy",
        decimals=1,
        min=80,
        max=140,
        warn_below=94,
        crit_below=88,
        hysteresis=1,
        color="#a78bfa",
    ),
    Signal(
        key="battery_current_a",
        label="Curent pachet",
        unit="A",
        group="energy",
        decimals=1,
        min=-80,
        max=120,
        warn_above=75,
        crit_above=95,
        hysteresis=4,
        color="#f472b6",
        description="Pozitiv la descărcare, negativ la regenerare.",
    ),
    Signal(
        key="battery_power_w",
        label="Putere baterie",
        unit="W",
        group="energy",
        decimals=0,
        min=-8000,
        max=14000,
        color="#38bdf8",
    ),
    Signal(
        key="cell_voltage_min_v",
        label="Celulă minimă",
        unit="V",
        group="energy",
        decimals=3,
        min=2.5,
        max=4.3,
        warn_below=3.0,
        crit_below=2.8,
        hysteresis=0.05,
        color="#fb7185",
    ),
    Signal(
        key="cell_voltage_max_v",
        label="Celulă maximă",
        unit="V",
        group="energy",
        decimals=3,
        min=2.5,
        max=4.3,
        warn_above=4.15,
        crit_above=4.22,
        hysteresis=0.03,
        color="#fbbf24",
    ),
    Signal(
        key="solar_power_w",
        label="Putere solară",
        unit="W",
        group="energy",
        decimals=0,
        min=0,
        max=1600,
        overview=True,
        color="#fbbf24",
        description="Puterea totală livrată de panouri prin controlerele MPPT.",
    ),
    Signal(key="mppt1_power_w", label="MPPT 1", unit="W", group="energy", decimals=0, min=0, max=450),
    Signal(key="mppt2_power_w", label="MPPT 2", unit="W", group="energy", decimals=0, min=0, max=450),
    Signal(key="mppt3_power_w", label="MPPT 3", unit="W", group="energy", decimals=0, min=0, max=450),
    Signal(key="mppt4_power_w", label="MPPT 4", unit="W", group="energy", decimals=0, min=0, max=450),
    Signal(
        key="energy_consumed_wh",
        label="Energie consumată",
        unit="Wh",
        group="energy",
        decimals=0,
        min=0,
        description="Energie scoasă din pachet de la începutul sesiunii.",
    ),
    Signal(
        key="energy_regen_wh",
        label="Energie regenerată",
        unit="Wh",
        group="energy",
        decimals=0,
        min=0,
    ),
    Signal(
        key="energy_solar_wh",
        label="Energie solară",
        unit="Wh",
        group="energy",
        decimals=0,
        min=0,
    ),
    # --- Temperaturi --------------------------------------------------------
    Signal(
        key="battery_temp_max_c",
        label="Temp. baterie max.",
        unit="°C",
        group="thermal",
        decimals=1,
        min=-10,
        max=80,
        warn_above=50,
        crit_above=60,
        hysteresis=3,
        overview=True,
        color="#f97316",
    ),
    Signal(
        key="battery_temp_min_c",
        label="Temp. baterie min.",
        unit="°C",
        group="thermal",
        decimals=1,
        min=-10,
        max=80,
    ),
    Signal(
        key="battery_temp_delta_c",
        label="Delta temp. celule",
        unit="°C",
        group="thermal",
        decimals=1,
        min=0,
        max=25,
        warn_above=8,
        crit_above=12,
        hysteresis=1,
        color="#fb923c",
        description="Diferența dintre cea mai caldă și cea mai rece celulă.",
    ),
    Signal(
        key="motor_temp_c",
        label="Temp. motor",
        unit="°C",
        group="thermal",
        decimals=1,
        min=0,
        max=140,
        warn_above=90,
        crit_above=110,
        hysteresis=5,
        color="#ef4444",
    ),
    Signal(
        key="inverter_temp_c",
        label="Temp. invertor",
        unit="°C",
        group="thermal",
        decimals=1,
        min=0,
        max=110,
        warn_above=70,
        crit_above=85,
        hysteresis=4,
        color="#f59e0b",
    ),
    # --- Motor --------------------------------------------------------------
    Signal(
        key="motor_power_w",
        label="Putere motor",
        unit="W",
        group="motor",
        decimals=0,
        min=-5000,
        max=14000,
        color="#60a5fa",
    ),
    Signal(
        key="motor_rpm",
        label="Turație motor",
        unit="rpm",
        group="motor",
        decimals=0,
        min=0,
        max=1600,
    ),
    Signal(
        key="throttle_pct",
        label="Accelerație",
        unit="%",
        group="motor",
        decimals=0,
        min=0,
        max=100,
    ),
    # --- GPS ----------------------------------------------------------------
    Signal(
        key="gps_latitude_deg",
        label="Latitudine",
        unit="°",
        group="gps",
        decimals=6,
        stale_after_s=3.0,
        chartable=False,
    ),
    Signal(
        key="gps_longitude_deg",
        label="Longitudine",
        unit="°",
        group="gps",
        decimals=6,
        stale_after_s=3.0,
        chartable=False,
    ),
    Signal(
        key="gps_hdop",
        label="Precizie GPS (HDOP)",
        unit="",
        group="gps",
        decimals=2,
        min=0,
        max=20,
        warn_above=2.5,
        crit_above=5.0,
        hysteresis=0.4,
        stale_after_s=3.0,
        description="Valori mici înseamnă poziție mai precisă.",
    ),
    Signal(
        key="gps_satellites",
        label="Sateliți",
        unit="",
        group="gps",
        decimals=0,
        min=0,
        max=24,
        warn_below=6,
        crit_below=4,
        hysteresis=1,
        stale_after_s=3.0,
        chartable=False,
    ),
)

BY_KEY: dict[str, Signal] = {signal.key: signal for signal in CATALOG}

GROUP_LABELS: dict[str, str] = {
    "status": "Stare generală",
    "energy": "Energie și baterie",
    "thermal": "Temperaturi",
    "motor": "Motor",
    "gps": "Poziție",
}


def catalog_payload() -> dict:
    """Reprezentarea catalogului trimisă frontendului."""
    return {
        "signals": [signal.to_dict() for signal in CATALOG],
        "groups": [{"key": key, "label": label} for key, label in GROUP_LABELS.items()],
    }


@dataclass(frozen=True, slots=True)
class CompositeRule:
    """Regulă de alarmă care nu derivă dintr-un singur prag de semnal."""

    key: str
    label: str
    severity: Literal["critical", "warning", "info"]
    message: str
    signals: tuple[str, ...] = field(default=())


# Regulile compuse sunt evaluate în app/core/alarms.py.
COMPOSITE_RULES: tuple[CompositeRule, ...] = (
    CompositeRule(
        key="link_lost",
        label="Legătură pierdută",
        severity="critical",
        message="Nu s-au mai primit mesaje de la mașină.",
    ),
    CompositeRule(
        key="cell_imbalance",
        label="Dezechilibru celule",
        severity="warning",
        message="Diferența dintre celula minimă și cea maximă depășește 0,25 V.",
        signals=("cell_voltage_min_v", "cell_voltage_max_v"),
    ),
    CompositeRule(
        key="energy_deficit",
        label="Deficit de energie",
        severity="info",
        message="Consumul depășește de peste trei ori aportul solar.",
        signals=("battery_power_w", "solar_power_w"),
    ),
)
