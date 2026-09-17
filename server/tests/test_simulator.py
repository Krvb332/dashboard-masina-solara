"""Simulatorul trebuie să producă date coerente fizic și în catalogul de semnale."""

from __future__ import annotations

import math
import random

from app.signals import BY_KEY
from simulator.simulate import CarState, arc_speed, step
from simulator.track_zolder import (
    OFFICIAL_LENGTH_M,
    TRACK_LENGTH_M,
    curvature_radius_at,
    point_at,
    sector_at,
)


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
    start = point_at(0.0)
    end = point_at(TRACK_LENGTH_M)

    assert abs(start[0] - end[0]) < 1e-9
    assert abs(start[1] - end[1]) < 1e-9


def test_lungimea_masurata_corespunde_circuitului_real() -> None:
    """Geometria chiar este Zolder, nu o buclă de aceeași formă la altă scară.

    O linie mediană desenată aproximativ ar trece de testul de buclă închisă și
    ar arăta corect pe hartă; ce nu ar mai corespunde este *lungimea*, iar din
    ea se calculează distanța pe tur și consumul pe kilometru.
    """
    abatere = abs(TRACK_LENGTH_M - OFFICIAL_LENGTH_M) / OFFICIAL_LENGTH_M
    assert abatere < 0.01, (
        f"linia mediană are {TRACK_LENGTH_M:.1f} m, "
        f"circuitul oficial {OFFICIAL_LENGTH_M:.0f} m"
    )


def _pozitii_din_sectorul(nume: str) -> list[float]:
    """Distanțele pe traseu care cad în sectorul cu numele dat.

    Sectorul se caută după nume, nu se scrie ca număr de metri: o corecție
    adusă geometriei ar muta metrii, iar testul ar începe să măsoare altă
    bucată de circuit fără ca nimic să pice.
    """
    pozitii = [
        s
        for s in range(0, int(TRACK_LENGTH_M))
        if sector_at(float(s))[0] == nume
    ]
    assert pozitii, f"sectorul „{nume}” nu există în geometrie"
    return [float(s) for s in pozitii]


def test_viteza_este_limitata_in_viraje() -> None:
    """Șicana cere viteză mai mică decât linia dreaptă principală."""
    viteza_in_sicana = min(arc_speed(s) for s in _pozitii_din_sectorul("Kleine Chicane"))
    viteza_pe_linie_dreapta = max(
        arc_speed(s) for s in _pozitii_din_sectorul("Linia dreaptă principală")
    )

    assert viteza_in_sicana < viteza_pe_linie_dreapta


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


def test_curbura_chiar_variaza_de_a_lungul_circuitului() -> None:
    """Controlul care explică de ce testul de mai sus are rost.

    Dacă traseul ar avea curbură aproape constantă, limita de viteză ar fi
    aceeași peste tot, iar comparația dintre șicană și linia dreaptă n-ar
    demonstra nimic despre geometrie.
    """
    raze = [curvature_radius_at(s) for s in range(0, int(TRACK_LENGTH_M), 25)]

    assert min(raze) < 100.0, f"cea mai strânsă curbă are raza {min(raze):.0f} m"
    assert max(raze) > 1000.0, f"cea mai lină porțiune are raza {max(raze):.0f} m"
