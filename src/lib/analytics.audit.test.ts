import { describe, expect, it } from 'vitest'
import { TelemetryAnalytics, type QualityEntry } from './analytics'
import { elevationProfile, type GpsFix } from './gps'
import {
  makeSample,
  qualityFor,
  trackPoint,
  trackLengthM,
} from '../test/synthetic'

/**
 * Audit D2/D3 și acuratețea integrării pe o cursă lungă.
 *
 * Acumulatorul este cod pur: aceleași eșantioane trebuie să dea aceleași
 * cifre. Aici îl hrănim cu serii construite astfel încât adevărul să fie
 * cunoscut analitic, și comparăm.
 */

const TICK_MS = 200

function valid(value: number): QualityEntry {
  return { state: 'valid', value }
}

function stale(value: number): QualityEntry {
  return { state: 'stale', value }
}

describe('urcare cumulată (D2)', () => {
  it.fails(
    'D2 (defect confirmat): o urcare lentă de 100 m în 10 minute se numără ca ~100 m',
    () => {
      const analytics = new TelemetryAnalytics()
      const samples = (10 * 60 * 1000) / TICK_MS
      for (let index = 0; index <= samples; index += 1) {
        analytics.update({
          timeMs: index * TICK_MS,
          quality: {
            vehicle_speed_kph: valid(40),
            gps_altitude_m: valid(300 + (100 * index) / samples),
          },
        })
      }
      expect(analytics.totals.elevationGainM).toBeGreaterThan(90)
      expect(analytics.totals.elevationGainM).toBeLessThan(110)
    },
  )

  it('control: o urcare în trepte de 1 m se numără corect', () => {
    const analytics = new TelemetryAnalytics()
    for (let index = 0; index <= 100; index += 1) {
      analytics.update({
        timeMs: index * TICK_MS,
        quality: { gps_altitude_m: valid(300 + index) },
      })
    }
    expect(analytics.totals.elevationGainM).toBeCloseTo(100, 6)
  })

  it.fails(
    'D2 (defect confirmat): profilul de elevație numără o urcare lentă la 10 Hz',
    () => {
      const fixes: GpsFix[] = []
      const count = 6000
      for (let index = 0; index < count; index += 1) {
        const point = trackPoint((index / count) * 2 * Math.PI)
        fixes.push({
          timeMs: index * 100,
          latitude: point.lat,
          longitude: point.lon,
          altitude: 300 + (100 * index) / count,
          hdop: 1,
          satellites: 10,
          fixQuality: 1,
        })
      }
      const profile = elevationProfile(fixes)
      expect(profile.gainM).toBeGreaterThan(90)
    },
  )

  it('măsurătoare: cât din urcarea lentă se pierde', () => {
    const analytics = new TelemetryAnalytics()
    const samples = 3000
    for (let index = 0; index <= samples; index += 1) {
      analytics.update({
        timeMs: index * TICK_MS,
        quality: { gps_altitude_m: valid(300 + (100 * index) / samples) },
      })
    }
    console.info(
      `[audit D2] urcare reală 100 m la 5 Hz → elevationGainM=${analytics.totals.elevationGainM.toFixed(2)} m`,
    )
    expect(Number.isFinite(analytics.totals.elevationGainM)).toBe(true)
  })
})

describe('contor intermitent (D3)', () => {
  /** 40 km/h constant; contorul lipsește (stale) între secundele 20 și 40. */
  function run(counterMissingBetween: [number, number]): TelemetryAnalytics {
    const analytics = new TelemetryAnalytics()
    const speedKph = 40
    const totalS = 60
    for (let index = 0; index <= (totalS * 1000) / TICK_MS; index += 1) {
      const t = (index * TICK_MS) / 1000
      const distanceKm = (speedKph / 3600) * t
      const energyWh = (1000 / 3600) * t
      const missing =
        t > counterMissingBetween[0] && t < counterMissingBetween[1]
      analytics.update({
        timeMs: index * TICK_MS,
        quality: {
          vehicle_speed_kph: valid(speedKph),
          battery_power_w: valid(1000),
          distance_km: missing ? stale(distanceKm) : valid(distanceKm),
          energy_consumed_wh: missing ? stale(energyWh) : valid(energyWh),
        },
      })
    }
    return analytics
  }

  it('control: cu contorul mereu prezent, distanța și energia sunt exacte', () => {
    const analytics = run([-1, -1])
    expect(analytics.totals.distanceKm).toBeCloseTo((40 / 3600) * 60, 3)
    expect(analytics.totals.energyConsumedWh).toBeCloseTo((1000 / 3600) * 60, 2)
  })

  it.fails(
    'D3 (defect confirmat): un contor care lipsește 20 s nu dublează distanța pe acel interval',
    () => {
      const analytics = run([20, 40])
      const truthKm = (40 / 3600) * 60
      // Toleranță de 3 %: sub ea, diferența ar fi doar integrare; peste, este
      // dublă contorizare.
      expect(
        Math.abs(analytics.totals.distanceKm - truthKm) / truthKm,
      ).toBeLessThan(0.03)
    },
  )

  it.fails(
    'D3 (defect confirmat): un contor de energie care lipsește 20 s nu dublează energia',
    () => {
      const analytics = run([20, 40])
      const truthWh = (1000 / 3600) * 60
      expect(
        Math.abs(analytics.totals.energyConsumedWh - truthWh) / truthWh,
      ).toBeLessThan(0.03)
    },
  )

  it('măsurătoare: cu cât cresc distanța și energia când contorul lipsește 20 s din 60', () => {
    const analytics = run([20, 40])
    const truthKm = (40 / 3600) * 60
    const truthWh = (1000 / 3600) * 60
    console.info(
      `[audit D3] distanță reală ${truthKm.toFixed(4)} km → ${analytics.totals.distanceKm.toFixed(4)} km (+${(((analytics.totals.distanceKm - truthKm) / truthKm) * 100).toFixed(1)} %); energie reală ${truthWh.toFixed(2)} Wh → ${analytics.totals.energyConsumedWh.toFixed(2)} Wh (+${(((analytics.totals.energyConsumedWh - truthWh) / truthWh) * 100).toFixed(1)} %)`,
    )
    expect(analytics.totals.distanceKm).toBeGreaterThan(0)
  })
})

describe('integrare pe o cursă de opt ore (precizie numerică)', () => {
  it('energia integrată din putere se apropie de integrala analitică și totalele rămân finite', () => {
    const analytics = new TelemetryAnalytics()
    const hours = 8
    const ticks = (hours * 3600 * 1000) / TICK_MS
    // Putere fără contor: P(t) = 900 + 300·sin(t/30). Integrala pe [0, T]:
    // 900·T + 300·30·(1 − cos(T/30)).
    let expectedJ = 0
    for (let index = 0; index <= ticks; index += 1) {
      const t = (index * TICK_MS) / 1000
      const power = 900 + 300 * Math.sin(t / 30)
      analytics.update({
        timeMs: index * TICK_MS,
        quality: {
          vehicle_speed_kph: valid(45),
          battery_power_w: valid(power),
        },
      })
      if (index === ticks) {
        expectedJ = 900 * t + 300 * 30 * (1 - Math.cos(t / 30))
      }
    }
    const expectedWh = expectedJ / 3600
    const relative =
      Math.abs(analytics.totals.energyConsumedWh - expectedWh) / expectedWh
    console.info(
      `[audit] 8 h la 5 Hz: energie integrată ${analytics.totals.energyConsumedWh.toFixed(2)} Wh față de analitic ${expectedWh.toFixed(2)} Wh (eroare relativă ${(relative * 100).toFixed(4)} %); distanță ${analytics.totals.distanceKm.toFixed(3)} km față de ${(45 * hours).toFixed(3)} km`,
    )
    expect(relative).toBeLessThan(1e-4)
    expect(analytics.totals.distanceKm).toBeCloseTo(45 * hours, 2)
    const snapshot = analytics.snapshot()
    for (const [key, value] of Object.entries(snapshot.totals)) {
      expect(Number.isFinite(value), key).toBe(true)
    }
  })

  it('fixturile sintetice rămân coerente: contorul de distanță urmează viteza pe un tur', () => {
    const perLap = Math.round(trackLengthM() / (45 / 3.6) / 0.1)
    const first = makeSample(0)
    const last = makeSample(perLap)
    expect(qualityFor(last).distance_km.value).toBeCloseTo(
      (first.signals.distance_km ?? 0) + trackLengthM() / 1000,
      2,
    )
    expect(last.signals.lap_number).toBe(2)
  })
})
