import { describe, expect, it } from 'vitest'
import {
  EARTH_RADIUS_M,
  bearingDeg,
  elevationProfile,
  gradeFraction,
  hasValidCoordinates,
  haversineMeters,
  inspectFixes,
  isUsableFix,
  rejectOutliers,
  speedFromFixes,
  trackLengthMeters,
  type GpsFix,
} from './gps'

/**
 * Distanțele așteptate se derivă din geometrie, nu din rularea codului:
 * pe meridian distanța este exact `R · Δφ`, iar pe un paralel forma închisă a
 * haversine-ului pentru latitudini egale este `2R · asin(cos φ · sin(Δλ/2))`.
 */

const DEG = Math.PI / 180
/** Un grad de latitudine, în metri, pentru sfera folosită de modul. */
const METERS_PER_DEG_LAT = EARTH_RADIUS_M * DEG

function fix(overrides: Partial<GpsFix> & { timeMs: number }): GpsFix {
  return {
    latitude: 46.7712,
    longitude: 23.6236,
    altitude: 340,
    hdop: 0.9,
    satellites: 11,
    fixQuality: 1,
    ...overrides,
  }
}

describe('validarea fixului', () => {
  it('acceptă o poziție normală', () => {
    expect(hasValidCoordinates({ latitude: 46.77, longitude: 23.62 })).toBe(
      true,
    )
    expect(isUsableFix(fix({ timeMs: 0 }))).toBe(true)
  })

  it('respinge (0, 0) — receptorul fără fix raportează exact asta', () => {
    expect(hasValidCoordinates({ latitude: 0, longitude: 0 })).toBe(false)
    expect(hasValidCoordinates({ latitude: 0.2, longitude: -0.4 })).toBe(false)
  })

  it('respinge coordonate în afara domeniului WGS84', () => {
    expect(hasValidCoordinates({ latitude: 91, longitude: 23 })).toBe(false)
    expect(hasValidCoordinates({ latitude: 46, longitude: 181 })).toBe(false)
    expect(hasValidCoordinates({ latitude: Number.NaN, longitude: 23 })).toBe(
      false,
    )
  })

  it('respinge fixurile cu precizie sau număr de sateliți insuficient', () => {
    expect(isUsableFix(fix({ timeMs: 0, hdop: 8 }))).toBe(false)
    expect(isUsableFix(fix({ timeMs: 0, satellites: 3 }))).toBe(false)
    expect(isUsableFix(fix({ timeMs: 0, fixQuality: 0 }))).toBe(false)
  })

  it('un receptor care nu raportează calitatea nu este respins pentru asta', () => {
    expect(
      isUsableFix({
        timeMs: 0,
        latitude: 46.77,
        longitude: 23.62,
      }),
    ).toBe(true)
  })
})

describe('distanțe', () => {
  it('un grad pe meridian este R · Δφ', () => {
    const distance = haversineMeters(
      { latitude: 45, longitude: 20 },
      { latitude: 46, longitude: 20 },
    )
    expect(distance).toBeCloseTo(METERS_PER_DEG_LAT, 3)
    // A doua derivare, pe alt drum: a 360-a parte din circumferință.
    expect(distance).toBeCloseTo((2 * Math.PI * EARTH_RADIUS_M) / 360, 3)
  })

  it('un grad pe paralela 60 respectă forma închisă a haversine-ului', () => {
    const expected =
      2 * EARTH_RADIUS_M * Math.asin(Math.cos(60 * DEG) * Math.sin(0.5 * DEG))
    const distance = haversineMeters(
      { latitude: 60, longitude: 20 },
      { latitude: 60, longitude: 21 },
    )
    expect(distance).toBeCloseTo(expected, 6)
  })

  it('distanța de la un punct la el însuși este zero', () => {
    expect(
      haversineMeters(
        { latitude: 46.77, longitude: 23.62 },
        { latitude: 46.77, longitude: 23.62 },
      ),
    ).toBe(0)
  })

  it('o coordonată invalidă nu produce o distanță', () => {
    expect(
      haversineMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 46.77, longitude: 23.62 },
      ),
    ).toBeNull()
  })

  it('direcția spre nord este 0°, cea spre est aproape 90°', () => {
    expect(
      bearingDeg(
        { latitude: 45, longitude: 20 },
        { latitude: 46, longitude: 20 },
      ),
    ).toBeCloseTo(0, 6)

    const east = bearingDeg(
      { latitude: 45, longitude: 20 },
      { latitude: 45, longitude: 21 },
    ) as number
    expect(east).toBeGreaterThan(89)
    expect(east).toBeLessThan(90)
  })

  it('viteza dedusă din două fixuri', () => {
    // 0,001° de latitudine în 10 s.
    const from = fix({ timeMs: 0, latitude: 46.77 })
    const to = fix({ timeMs: 10_000, latitude: 46.771 })
    expect(speedFromFixes(from, to)).toBeCloseTo(
      (METERS_PER_DEG_LAT * 0.001) / 10,
      6,
    )
  })

  it('fără timp scurs nu există viteză', () => {
    const same = fix({ timeMs: 1000 })
    expect(speedFromFixes(same, fix({ timeMs: 1000 }))).toBeNull()
  })
})

describe('pantă și elevație', () => {
  it('panta este creșterea raportată la distanța orizontală', () => {
    const from = fix({ timeMs: 0, latitude: 46.77, altitude: 300 })
    const to = fix({ timeMs: 20_000, latitude: 46.771, altitude: 310 })
    const run = METERS_PER_DEG_LAT * 0.001
    expect(gradeFraction(from, to)).toBeCloseTo(10 / run, 9)
  })

  it('fără altitudine nu se presupune teren plat', () => {
    const from = fix({ timeMs: 0, latitude: 46.77, altitude: null })
    const to = fix({ timeMs: 20_000, latitude: 46.771, altitude: 310 })
    expect(gradeFraction(from, to)).toBeNull()
  })

  it('un salt vertical imposibil între eșantioane este respins', () => {
    // 200 m în 1 s ar însemna 200 m/s pe verticală.
    const from = fix({ timeMs: 0, latitude: 46.77, altitude: 300 })
    const to = fix({ timeMs: 1000, latitude: 46.771, altitude: 500 })
    expect(gradeFraction(from, to)).toBeNull()
  })

  it('câștigul de elevație numără doar urcările peste pragul de zgomot', () => {
    const altitudes = [300, 300.2, 299.9, 305, 302, 302.1]
    const fixes = altitudes.map((altitude, index) =>
      fix({
        timeMs: index * 10_000,
        latitude: 46.77 + index * 0.0002,
        altitude,
      }),
    )

    const profile = elevationProfile(fixes)
    // Doar 299,9 → 305 (+5,1) și 305 → 302 (−3) depășesc 0,5 m.
    expect(profile.gainM).toBeCloseTo(5.1, 6)
    expect(profile.lossM).toBeCloseTo(3, 6)
    expect(profile.minM).toBe(299.9)
    expect(profile.maxM).toBe(305)
    expect(profile.points).toHaveLength(altitudes.length)
    expect(profile.points[0][0]).toBe(0)
  })

  it('fără niciun fix, profilul este gol, nu zero mascat', () => {
    const profile = elevationProfile([])
    expect(profile.gainM).toBe(0)
    expect(profile.lossM).toBe(0)
    expect(profile.minM).toBeNull()
    expect(profile.points).toEqual([])
  })

  it('distanța cumulată din profil crește monoton', () => {
    const fixes = Array.from({ length: 6 }, (_, index) =>
      fix({
        timeMs: index * 10_000,
        latitude: 46.77 + index * 0.0005,
        altitude: 300 + index,
      }),
    )
    const distances = elevationProfile(fixes).points.map(
      ([distance]) => distance,
    )
    for (let index = 1; index < distances.length; index += 1) {
      expect(distances[index]).toBeGreaterThan(distances[index - 1])
    }
  })
})

describe('curățarea urmei', () => {
  it('lungimea traseului însumează pașii valizi', () => {
    // 0,001° de latitudine la fiecare 10 s: ~40 km/h, o viteză plauzibilă.
    const fixes = Array.from({ length: 4 }, (_, index) =>
      fix({ timeMs: index * 10_000, latitude: 46.77 + index * 0.001 }),
    )
    expect(trackLengthMeters(fixes)).toBeCloseTo(
      3 * METERS_PER_DEG_LAT * 0.001,
      3,
    )
  })

  it('un salt de receptor nu intră în distanță', () => {
    const fixes = [
      fix({ timeMs: 0, latitude: 46.77 }),
      fix({ timeMs: 10_000, latitude: 46.771 }),
      // Un grad mai la nord în zece secunde: imposibil.
      fix({ timeMs: 20_000, latitude: 47.771 }),
    ]
    // Rămâne doar primul pas; saltul este sărit.
    expect(trackLengthMeters(fixes)).toBeCloseTo(METERS_PER_DEG_LAT * 0.001, 3)
  })

  it('fixurile care implică viteze imposibile sunt eliminate', () => {
    const fixes = [
      fix({ timeMs: 0, latitude: 46.77 }),
      fix({ timeMs: 10_000, latitude: 47.77 }),
      fix({ timeMs: 20_000, latitude: 46.771 }),
    ]
    const kept = rejectOutliers(fixes)
    expect(kept).toHaveLength(2)
    expect(kept[1].latitude).toBeCloseTo(46.771, 6)
  })

  it('raportul de calitate numără motivele respingerii', () => {
    const report = inspectFixes([
      fix({ timeMs: 0 }),
      fix({ timeMs: 1000, latitude: 0, longitude: 0 }),
      fix({ timeMs: 2000, hdop: 9 }),
      fix({ timeMs: 3000, satellites: 2 }),
      fix({ timeMs: 4000, fixQuality: 0 }),
      fix({ timeMs: 5000, altitude: null }),
    ])

    expect(report.total).toBe(6)
    expect(report.usable).toBe(2)
    expect(report.rejected).toBe(4)
    expect(report.withAltitude).toBe(1)
    expect(report.reasons['coordonate lipsă sau (0, 0)']).toBe(1)
    expect(report.reasons['receptor fără fix']).toBe(1)
    expect(report.reasons['fără altitudine']).toBe(1)
  })
})
