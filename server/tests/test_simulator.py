"""Simulatorul trebuie să producă date coerente fizic și în catalogul de semnale."""

from __future__ import annotations

import math
import random

from app.signals import BY_KEY
from simulator.simulate import CarState, arc_speed, step, track_point


def test_toate_semnalele_sunt_in_catalog() -> None:
    state = CarState()
    signals = step(state, 0.1, random.Random(1))

    necunoscute = set(signals) - set(BY_KEY)
    assert necunoscute == set(), f"Semnale absente din catalog: {necunoscute}"


def test_socul_scade_in_timp_ce_masina_consuma() -> None:
    state = CarState()
    rng = random.Random(1)
    state.sun_minutes = 0.0  # noapte: fără aport solar

    initial = state.soc_pct
    for _ in range(600):
        step(state, 0.1, rng)

    assert state.soc_pct < initial


def test_energia_solara_creste_in_timpul_zilei() -> None:
    state = CarState()
    state.sun_minutes = 12 * 60.0
    rng = random.Random(1)

    for _ in range(100):
        signals = step(state, 0.1, rng)

    assert signals["solar_power_w"] > 0
    assert state.energy_solar_wh > 0


def test_traseul_este_o_bucla_inchisa() -> None:
    start = track_point(0.0)
    end = track_point(2 * 3.141592653589793)

    assert abs(start[0] - end[0]) < 1e-9
    assert abs(start[1] - end[1]) < 1e-9


def test_viteza_este_limitata_in_viraje() -> None:
    """Capătul axei mari are curbură mai strânsă, deci viteză permisă mai mică."""
    viteza_in_viraj = arc_speed(0.0)
    viteza_pe_linie_dreapta = arc_speed(3.141592653589793 / 2)

    assert viteza_in_viraj < viteza_pe_linie_dreapta


def test_numarul_de_tururi_creste() -> None:
    state = CarState()
    rng = random.Random(1)

    for _ in range(4000):
        step(state, 0.1, rng)

    assert state.lap >= 1
    assert state.distance_m > 1000


def test_defectul_de_supraincalzire_ridica_temperaturile() -> None:
    normal = CarState()
    fierbinte = CarState()
    fierbinte.faults.add("overheat")
    rng = random.Random(1)

    for _ in range(1200):
        step(normal, 0.1, random.Random(1))
        step(fierbinte, 0.1, rng)

    assert fierbinte.motor_temp_c > normal.motor_temp_c + 20


def test_simulatorul_emite_tot_catalogul() -> None:
    """Un semnal din catalog pe care simulatorul nu-l trimite apare în dashboard
    ca „indisponibil", iar cine îl caută nu poate ști dacă lipsa e în frontend,
    în server sau în simulator. Verificarea taie întrebarea din start."""
    state = CarState()
    rng = random.Random(7)
    for _ in range(600):
        signals = step(state, 0.1, rng)

    lipsa = set(BY_KEY) - set(signals)
    assert lipsa == set(), f"Semnale din catalog pe care simulatorul nu le emite: {sorted(lipsa)}"


def test_valorile_emise_sunt_in_domeniul_declarat() -> None:
    state = CarState()
    rng = random.Random(7)
    for _ in range(600):
        signals = step(state, 0.1, rng)

    for key, value in signals.items():
        signal = BY_KEY[key]
        assert math.isfinite(value), f"{key} nu este finit: {value!r}"
        if signal.min is None or signal.max is None:
            continue
        toleranta = (signal.max - signal.min) * 0.2
        assert signal.min - toleranta <= value <= signal.max + toleranta, (
            f"{key} = {value} iese din [{signal.min}, {signal.max}]"
        )


def test_semnalele_redundante_sunt_coerente() -> None:
    """Aceleași perechi pe care le confruntă panoul de verificare din dashboard.

    Dacă simulatorul însuși produce valori incoerente, panoul ar raporta
    permanent nepotriviri și nimeni nu s-ar mai uita la el.
    """
    state = CarState()
    rng = random.Random(7)
    for _ in range(600):
        signals = step(state, 0.1, rng)

    def apropiat(nume: str, asteptat: float, raportat: float, pct: float, absolut: float) -> None:
        permis = max(absolut, abs(asteptat) * pct / 100.0)
        assert abs(asteptat - raportat) <= permis, (
            f"{nume}: așteptat {asteptat:.4f}, raportat {raportat:.4f}"
        )

    apropiat(
        "putere pachet",
        signals["battery_voltage_v"] * signals["battery_current_a"],
        signals["battery_power_w"],
        8,
        60,
    )
    apropiat(
        "putere solară",
        sum(signals[f"mppt{index}_power_w"] for index in range(1, 5)),
        signals["solar_power_w"],
        6,
        25,
    )

    celule = [signals[f"cell_{index:02d}_v"] for index in range(1, 33)]
    apropiat("celulă minimă", min(celule), signals["cell_voltage_min_v"], 1, 0.002)
    apropiat("celulă maximă", max(celule), signals["cell_voltage_max_v"], 1, 0.002)
    apropiat(
        "dezechilibru",
        max(celule) - min(celule),
        signals["cell_voltage_delta_v"],
        10,
        0.01,
    )
    apropiat("tensiune pachet", sum(celule), signals["battery_voltage_v"], 4, 2)
    apropiat("viteză GNSS", signals["gps_speed_kph"], signals["vehicle_speed_kph"], 15, 3)

    assert celule.index(min(celule)) + 1 == int(signals["cell_min_index"])
    assert celule.index(max(celule)) + 1 == int(signals["cell_max_index"])


def test_altitudinea_variaza_pe_traseu() -> None:
    """Fără variație de altitudine, profilul de elevație și calculul de pantă din
    dashboard nu pot fi verificate deloc."""
    state = CarState()
    rng = random.Random(3)
    altitudini = [step(state, 0.1, rng)["gps_altitude_m"] for _ in range(4000)]

    assert max(altitudini) - min(altitudini) > 5.0


def test_traseul_gps_inainteaza_cu_viteza_raportata() -> None:
    """Poziția GPS trebuie să se deplaseze exact cât spune viteza.

    Pe o elipsă, raza de curbură și lungimea de arc pe radian diferă cu până la
    80 %. Folosirea razei de curbură pentru avansul unghiular face traseul să
    înainteze cu altă viteză decât cea raportată — o nepotrivire care nu se vede
    pe hartă, fiindcă forma rămâne o buclă plauzibilă, dar care strică orice
    analiză de tur.

    Verificarea folosește pozițiile, nu ``gps_speed_kph``: acela din urmă vine
    din aceeași variabilă ca ``vehicle_speed_kph``, deci nu ar dovedi nimic.
    """
    state = CarState()
    rng = random.Random(3)
    anterior = None
    abateri: list[float] = []

    for _ in range(3000):
        esantion = step(state, 0.1, rng)
        if anterior is not None and esantion["vehicle_speed_kph"] > 5:
            lat_m = (esantion["gps_latitude_deg"] - anterior["gps_latitude_deg"]) * 111_320.0
            lon_m = (
                (esantion["gps_longitude_deg"] - anterior["gps_longitude_deg"])
                * 111_320.0
                * math.cos(math.radians(esantion["gps_latitude_deg"]))
            )
            gps_kph = math.hypot(lat_m, lon_m) * 36.0
            abateri.append(
                abs(gps_kph - esantion["vehicle_speed_kph"])
                / esantion["vehicle_speed_kph"]
                * 100.0
            )
        anterior = esantion

    assert abateri, "nu s-au strâns eșantioane comparabile"
    medie = sum(abateri) / len(abateri)
    assert medie < 5.0, f"abatere medie de {medie:.1f} % între poziție și viteza raportată"
    assert max(abateri) < 25.0, f"abatere maximă de {max(abateri):.1f} %"


def test_arcul_pe_radian_difera_de_raza_de_curbura() -> None:
    """Controlul care explică de ce testul de mai sus are rost.

    Dacă cele două ar fi egale, confuzia dintre ele n-ar avea consecințe și
    verificarea n-ar demonstra nimic.
    """
    from simulator.simulate import arc_per_theta, curvature_radius

    theta = math.pi / 2
    assert abs(arc_per_theta(theta) - curvature_radius(theta)) > 100.0
