"""Simulatorul trebuie să producă date coerente fizic și în catalogul de semnale."""

from __future__ import annotations

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
