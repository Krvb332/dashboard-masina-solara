"""Geometria circuitului Zolder pentru simulator.

Datele brute stau în ``track_zolder_data.py``; aici sunt funcțiile care le fac
utilizabile: unde se află mașina la distanța ``s`` de linia de start, ce
altitudine are terenul acolo, cât de strâns este virajul.

**De ce parametrizarea pe lungime de arc.** Versiunea anterioară a
simulatorului mergea pe o elipsă parametrizată unghiular, iar avansul cerea o
corecție - un radian de parametru înseamnă altă distanță în capătul elipsei
decât pe laturi. Pe o linie frântă reală problema dispare: ``s`` *este*
distanța parcursă, deci avansul este ``s += viteză * dt`` și nimic altceva. Ce
se câștiga prin formulă acolo se citește direct din geometrie aici.

Cadrul de lucru este același cu al dashboardului: metri față de centrul
circuitului, aproximație echirectangulară, cu factorii de scară calculați
pentru latitudinea circuitului (``degree_scales``). Măsurată așa, bucla iese
4008,7 m față de cei 4011 m publicați.
"""

from __future__ import annotations

import math

from .track_zolder_data import (
    NODES,
    OFFICIAL_LENGTH_M,
    SECTORS,
    TRACK_LOCATION,
    TRACK_NAME,
)


def degree_scales(latitude_deg: float) -> tuple[float, float]:
    """Metri pe grad de latitudine și de longitudine, pe elipsoidul WGS84.

    Aceleași serii ca în ``src/lib/track-reference.ts``. Constanta rotundă de
    111 320 m, folosită în altă parte pentru bara de scară a hărții, ar
    supraevalua latitudinea cu 0,065 % și ar subevalua longitudinea cu 0,2 % -
    pe un tur de patru kilometri, câțiva metri de fiecare dată în aceeași
    direcție. Simulatorul trebuie să emită exact circuitul pe care dashboardul
    îl proiectează, deci amândouă folosesc aceeași formulă.
    """
    phi = math.radians(latitude_deg)
    meters_per_deg_lat = (
        111_132.92
        - 559.82 * math.cos(2 * phi)
        + 1.175 * math.cos(4 * phi)
        - 0.0023 * math.cos(6 * phi)
    )
    meters_per_deg_lon = (
        111_412.84 * math.cos(phi)
        - 93.5 * math.cos(3 * phi)
        + 0.118 * math.cos(5 * phi)
    )
    return meters_per_deg_lat, meters_per_deg_lon


__all__ = [
    "OFFICIAL_LENGTH_M",
    "TRACK_LENGTH_M",
    "TRACK_LOCATION",
    "TRACK_NAME",
    "curvature_radius_at",
    "degree_scales",
    "elevation_at",
    "grade_at",
    "heading_at",
    "point_at",
    "sector_at",
]


def _build() -> tuple[
    tuple[float, float],
    float,
    float,
    list[tuple[float, float]],
    list[float],
    float,
]:
    """Cadrul local, coordonatele nodurilor în metri și distanțele cumulate."""
    latitudes = [node[0] for node in NODES]
    longitudes = [node[1] for node in NODES]

    origin = (
        (min(latitudes) + max(latitudes)) / 2.0,
        (min(longitudes) + max(longitudes)) / 2.0,
    )
    meters_per_deg_lat, meters_per_deg_lon = degree_scales(origin[0])

    local = [
        (
            (node[1] - origin[1]) * meters_per_deg_lon,
            (node[0] - origin[0]) * meters_per_deg_lat,
        )
        for node in NODES
    ]

    # Distanța cumulată până la fiecare nod. Ultimul element este lungimea
    # întregii bucle, deci lista are un element în plus față de noduri.
    cumulative = [0.0]
    for index in range(len(local)):
        current = local[index]
        following = local[(index + 1) % len(local)]
        step = math.hypot(following[0] - current[0], following[1] - current[1])
        cumulative.append(cumulative[-1] + step)

    return (
        origin,
        meters_per_deg_lat,
        meters_per_deg_lon,
        local,
        cumulative,
        cumulative[-1],
    )


(
    _ORIGIN,
    _METERS_PER_DEG_LAT,
    _METERS_PER_DEG_LON,
    _LOCAL,
    _CUMULATIVE,
    TRACK_LENGTH_M,
) = _build()


def _wrap(s: float) -> float:
    """Aduce distanța în intervalul [0, lungimea circuitului)."""
    return s % TRACK_LENGTH_M


def _locate(s: float) -> tuple[int, float]:
    """Indicele segmentului care conține ``s`` și poziția relativă pe el."""
    target = _wrap(s)

    # Căutare binară în distanțele cumulate: la 10 Hz funcția este apelată de
    # câteva ori pe eșantion, iar o parcurgere liniară a celor 215 segmente ar
    # fi singura buclă costisitoare din simulator.
    low, high = 0, len(_LOCAL) - 1
    while low < high:
        middle = (low + high + 1) // 2
        if _CUMULATIVE[middle] <= target:
            low = middle
        else:
            high = middle - 1

    length = _CUMULATIVE[low + 1] - _CUMULATIVE[low]
    ratio = (target - _CUMULATIVE[low]) / length if length > 0 else 0.0
    return low, ratio


def _local_at(s: float) -> tuple[float, float]:
    """Poziția pe traseu, în cadrul metric local."""
    index, ratio = _locate(s)
    current = _LOCAL[index]
    following = _LOCAL[(index + 1) % len(_LOCAL)]
    return (
        current[0] + (following[0] - current[0]) * ratio,
        current[1] + (following[1] - current[1]) * ratio,
    )


def point_at(s: float) -> tuple[float, float]:
    """Coordonatele GPS la distanța ``s`` de linia de start."""
    x, y = _local_at(s)
    return (
        _ORIGIN[0] + y / _METERS_PER_DEG_LAT,
        _ORIGIN[1] + x / _METERS_PER_DEG_LON,
    )


def elevation_at(s: float) -> float:
    """Altitudinea terenului la distanța ``s``, interpolată între noduri."""
    index, ratio = _locate(s)
    current = NODES[index][2]
    following = NODES[(index + 1) % len(NODES)][2]
    return current + (following - current) * ratio


#: Pe ce distanță se citește panta, în metri.
#:
#: Nodurile OSM sunt inegal distribuite - trei metri într-o șicană, două sute pe
#: linia dreaptă - iar modelul de teren are pasul de 25 m. Panta unui singur
#: segment scurt ar fi zgomotul modelului, nu relieful. Citită pe cincizeci de
#: metri, rămâne panta pe care o simte mașina.
GRADE_WINDOW_M = 50.0


def grade_at(s: float) -> float:
    """Panta locală ca fracțiune (0,03 = 3 %), pozitivă la urcare."""
    half = GRADE_WINDOW_M / 2.0
    rise = elevation_at(s + half) - elevation_at(s - half)
    return rise / GRADE_WINDOW_M


def heading_at(s: float) -> float:
    """Direcția de mers la distanța ``s``, în grade față de nord."""
    ahead = _local_at(s + 1.0)
    behind = _local_at(s - 1.0)
    return (
        math.degrees(math.atan2(ahead[0] - behind[0], ahead[1] - behind[1])) + 360.0
    ) % 360.0


#: Pe ce distanță se citește curbura, în metri.
#:
#: Trei puncte prea apropiate cad aproape pe aceeași dreaptă chiar și într-un
#: viraj strâns, iar raza calculată din ele explodează la valori absurde. Prea
#: depărtate, netezesc șicana până dispare. Douăzeci de metri este ordinul de
#: mărime al unui viraj de circuit.
CURVATURE_WINDOW_M = 20.0

#: Peste atât, traseul este drept în practică.
MAX_CURVATURE_RADIUS_M = 5_000.0


def curvature_radius_at(s: float) -> float:
    """Raza de curbură a traseului la distanța ``s``, în metri."""
    half = CURVATURE_WINDOW_M / 2.0
    ax, ay = _local_at(s - half)
    bx, by = _local_at(s)
    cx, cy = _local_at(s + half)

    # Raza cercului circumscris celor trei puncte: R = abc / (4 * aria).
    side_a = math.hypot(bx - ax, by - ay)
    side_b = math.hypot(cx - bx, cy - by)
    side_c = math.hypot(cx - ax, cy - ay)

    # Aria cu produsul vectorial. Pe porțiune dreaptă tinde la zero, iar raza
    # la infinit - de aceea limita superioară, nu ca protecție la împărțire.
    twice_area = abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
    if twice_area < 1e-9:
        return MAX_CURVATURE_RADIUS_M

    radius = (side_a * side_b * side_c) / (2.0 * twice_area)
    return min(radius, MAX_CURVATURE_RADIUS_M)


def sector_at(s: float) -> tuple[str, str | None]:
    """Numele și numărul de viraj ale sectorului care conține ``s``."""
    index, _ = _locate(s)

    low, high = 0, len(SECTORS) - 1
    while low < high:
        middle = (low + high + 1) // 2
        if SECTORS[middle][2] <= index:
            low = middle
        else:
            high = middle - 1

    name, ref, _ = SECTORS[low]
    return name, ref
