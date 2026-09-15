import { describe, expect, it } from 'vitest'
import { anchorStationary, haversineMeters, STATIONARY, type GpsFix } from './gps'
import { METERS_PER_DEG_LAT, MIN_SPAN_M, projectTrack } from './track-projection'

/**
 * Ancorarea poziției: ce se întâmplă când mașina stă, și ce NU trebuie să se
 * întâmple când merge.
 *
 * Testul care contează cel mai mult nu este primul, ci cel de deplasare. Un
 * filtru de staționare care aplatizează totul trece triumfător testul „stă pe
 * loc" și distruge harta în cursă, iar greșeala nu se vede decât pe pistă.
 */

const BAZA = { lat: 46.795368, lon: 23.625407 }

/** Metri spre nord și spre est, ca deplasare în grade de la o latitudine. */
function offsetDeg(lat: number, northM: number, eastM: number) {
  return {
    lat: lat + northM / METERS_PER_DEG_LAT,
    lon:
      BAZA.lon +
      eastM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)),
  }
}

function fix(
  timeMs: number,
  northM: number,
  eastM: number,
  extra: Partial<GpsFix> = {},
): GpsFix {
  const punct = offsetDeg(BAZA.lat, northM, eastM)
  return {
    timeMs,
    latitude: punct.lat,
    longitude: punct.lon,
    altitude: 343,
    hdop: 3,
    satellites: 8,
    fixQuality: 1,
    ...extra,
  }
}

/**
 * Zgomot determinist, nu aleator: un test care pică o dată la zece rulări este
 * mai rău decât niciun test. Valorile sunt în metri și stau sub raza de zgomot
 * pentru HDOP 3 (max(4; 3 × 2,5) = 7,5 m).
 */
const ZGOMOT_M = [
  [0, 0],
  [1.8, -2.4],
  [-3.1, 1.2],
  [2.6, 3.3],
  [-1.4, -3.9],
  [4.2, 0.7],
  [-2.2, 2.8],
  [3.5, -1.1],
  [-4.0, -0.6],
  [0.9, 4.1],
] as const

describe('anchorStationary', () => {
  it('receptor stationar: toate pozitiile raman pe primul fix', () => {
    const fixuri = ZGOMOT_M.map(([n, e], index) =>
      fix(1000 * index, n, e),
    )

    // Control: intrarea chiar conține poziții diferite. Fără asta, testul ar
    // trece la fel de bine pe un filtru care nu face nimic, alimentat cu
    // eșantioane identice.
    const locuriBrute = new Set(
      fixuri.map((f) => `${f.latitude.toFixed(7)},${f.longitude.toFixed(7)}`),
    )
    expect(locuriBrute.size).toBe(fixuri.length)

    const ancorate = anchorStationary(fixuri)

    expect(ancorate).toHaveLength(fixuri.length)

    const locuri = new Set(
      ancorate.map((f) => `${f.latitude.toFixed(7)},${f.longitude.toFixed(7)}`),
    )
    expect(locuri.size).toBe(1)

    // Și locul acela este chiar prima citire, nu o medie inventată.
    expect(ancorate[0].latitude).toBe(fixuri[0].latitude)
    expect(ancorate[0].longitude).toBe(fixuri[0].longitude)

    // Restul valorilor rămân ale fixului lor: altfel panoul de calitate ar
    // îngheța odată cu harta și n-ai mai vedea HDOP-ul urcând.
    expect(ancorate[3].timeMs).toBe(fixuri[3].timeMs)
  })

  it('prima citire valida este punctul de pornire', () => {
    // Receptorul raportează întâi „fără fix" și (0, 0) — Null Island. Punctul
    // de pornire trebuie să fie prima citire pe care se poate conta, nu primul
    // eșantion sosit.
    const fixuri: GpsFix[] = [
      { timeMs: 0, latitude: 0, longitude: 0, hdop: 99, satellites: 0, fixQuality: 0 },
      { timeMs: 1000, latitude: 0, longitude: 0, hdop: 99, satellites: 0, fixQuality: 0 },
      fix(2000, 0, 0),
      fix(3000, 2.1, -1.7),
      fix(4000, -1.9, 2.2),
    ]

    const ancorate = anchorStationary(fixuri)

    expect(ancorate).toHaveLength(3)
    expect(ancorate[0].timeMs).toBe(2000)
    for (const f of ancorate) {
      expect(f.latitude).toBe(fixuri[2].latitude)
      expect(f.longitude).toBe(fixuri[2].longitude)
    }
  })

  it('deplasare reala: pozitiile nu sunt modificate', () => {
    // 3 m/s spre nord, 30 de secunde: 90 m. Trebuie să rămână 90 m.
    const fixuri = Array.from({ length: 31 }, (_, index) =>
      fix(1000 * index, index * 3, 0),
    )

    const ancorate = anchorStationary(fixuri)
    const parcurs = haversineMeters(ancorate[0], ancorate[ancorate.length - 1])

    expect(parcurs).not.toBeNull()
    expect(parcurs as number).toBeGreaterThan(85)

    // Ultimul punct este exact măsurătoarea, nu o ancoră rămasă în urmă.
    const ultim = ancorate[ancorate.length - 1]
    expect(ultim.latitude).toBe(fixuri[fixuri.length - 1].latitude)
    expect(ultim.longitude).toBe(fixuri[fixuri.length - 1].longitude)
  })

  it('mersul la pas nu este sters de filtru', () => {
    // 1 m/s: fiecare pas este sub raza de zgomot, deci un prag aplicat între
    // eșantioane consecutive ar raporta mașina oprită tot drumul. Față de
    // ancoră, aceiași pași se adună și ies din rază.
    const fixuri = Array.from({ length: 61 }, (_, index) =>
      fix(1000 * index, index * 1, 0),
    )

    const ancorate = anchorStationary(fixuri)
    const parcurs = haversineMeters(ancorate[0], ancorate[ancorate.length - 1])

    expect(parcurs as number).toBeGreaterThan(45)
  })

  it('raza creste cu HDOP-ul raportat', () => {
    // Același salt de 9 m: zgomot pentru un receptor care declară HDOP 5
    // (rază 12,5 m), deplasare pentru unul care declară HDOP 1 (rază 4 m).
    const slab = [fix(0, 0, 0, { hdop: 5 }), fix(1000, 9, 0, { hdop: 5 })]
    const bun = [fix(0, 0, 0, { hdop: 1 }), fix(1000, 9, 0, { hdop: 1 })]

    expect(anchorStationary(slab)[1].latitude).toBe(slab[0].latitude)
    expect(anchorStationary(bun)[1].latitude).toBe(bun[1].latitude)
  })

  it('praguri: raza nu coboara sub podeaua declarata', () => {
    // Control asupra constantelor: dacă cineva pune hdopFactorM pe 0, filtrul
    // devine inert și testele de mai sus ar trece degeaba.
    expect(STATIONARY.minRadiusM).toBeGreaterThan(0)
    expect(STATIONARY.hdopFactorM).toBeGreaterThan(0)
    expect(STATIONARY.settleSamples).toBeGreaterThan(1)
  })
})

describe('projectTrack: fereastra minima', () => {
  it('scara minima: doua fixuri la un metru nu umplu panza', () => {
    const aproape = [
      { lat: BAZA.lat, lon: BAZA.lon, speed: 0 },
      { ...offsetDeg(BAZA.lat, 1, 0), speed: 0 },
    ]

    const proiectat = projectTrack(aproape, 400, 300)

    expect(proiectat.every((p) => Number.isFinite(p.x))).toBe(true)
    expect(proiectat.every((p) => Number.isFinite(p.y))).toBe(true)

    const separare = Math.hypot(
      proiectat[1].x - proiectat[0].x,
      proiectat[1].y - proiectat[0].y,
    )

    // Un metru dintr-o fereastră de 20 m, pe o pânză de ~264 px utili, înseamnă
    // circa 13 px. Fără pragul de fereastră, cele două puncte ar fi ocupat
    // toată înălțimea disponibilă.
    expect(separare).toBeLessThan(40)
    expect(separare).toBeGreaterThan(1)
  })

  it('puncte suprapuse raman finite si centrate', () => {
    const punct = { lat: BAZA.lat, lon: BAZA.lon, speed: 0 }
    const proiectat = projectTrack([punct, punct, punct], 400, 300)

    for (const p of proiectat) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }

    // În mijloc, nu în colțul din stânga-jos unde cade minimul seriei.
    expect(proiectat[0].x).toBeCloseTo(200, 0)
    expect(proiectat[0].y).toBeCloseTo(150, 0)
  })

  it('fereastra minima este declarata in metri', () => {
    expect(MIN_SPAN_M).toBeGreaterThan(0)
  })
})
