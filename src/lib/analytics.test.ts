import { beforeEach, describe, expect, it } from 'vitest'
import {
  TelemetryAnalytics,
  type AnalyticsInput,
  type QualityEntry,
  type QualityState,
} from './analytics'

/**
 * Testele de aici apără cerința cea mai ușor de încălcat pe tăcute: cu nimic
 * conectat, contoarele trebuie să rămână exact zero, iar mărimile derivate să
 * rămână „fără valoare". O singură valoare învechită scursă într-un total ar
 * strica bilanțul cursei fără să se vadă nicăieri pe ecran.
 */

function entry(state: QualityState, value: number | null): QualityEntry {
  return { state, value }
}

const valid = (value: number) => entry('valid', value)
const stale = (value: number) => entry('stale', value)

function input(
  timeMs: number,
  signals: Record<string, QualityEntry>,
): AnalyticsInput {
  return { timeMs, quality: signals }
}

/** Alimentează acumulatorul cu eșantioane la interval fix. */
function feed(
  analytics: TelemetryAnalytics,
  stepMs: number,
  frames: Record<string, QualityEntry>[],
  startMs = 0,
): void {
  frames.forEach((frame, index) => {
    analytics.update(input(startMs + index * stepMs, frame))
  })
}

describe('viteza din turație', () => {
  it('600 rpm pe roata de 548 mm înseamnă 61,98 km/h', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 200, [{ motor_rpm: valid(600) }])
    // 10 rot/s · π · 0,548 m = 17,216 m/s; ori 3,6 = 61,98 km/h.
    expect(analytics.snapshot().wheelSpeedKph).toBeCloseTo(61.98, 1)
  })

  it('o turație învechită nu produce viteză', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 200, [
      { motor_rpm: stale(600), battery_soc_pct: valid(80) },
    ])
    expect(analytics.snapshot().wheelSpeedKph).toBeNull()
  })
})

describe('fără flux conectat', () => {
  let analytics: TelemetryAnalytics

  beforeEach(() => {
    analytics = new TelemetryAnalytics()
  })

  it('toate contoarele pornesc de la zero', () => {
    const totals = analytics.totals
    for (const [key, value] of Object.entries(totals)) {
      expect(value, `contorul ${key}`).toBe(0)
    }
  })

  it('nicio mărime derivată nu este inventată', () => {
    const snapshot = analytics.snapshot()

    expect(snapshot.live).toBe(false)
    expect(snapshot.wheelSpeedKph).toBeNull()
    expect(snapshot.whPerKm).toBeNull()
    expect(snapshot.recentWhPerKm).toBeNull()
    expect(snapshot.kmPerKwh).toBeNull()
    expect(snapshot.consumptionW).toBeNull()
    expect(snapshot.regenW).toBeNull()
    expect(snapshot.netPowerW).toBeNull()
    expect(snapshot.rangeKm).toBeNull()
    expect(snapshot.timeToEmptyS).toBeNull()
    expect(snapshot.socPct).toBeNull()
    expect(snapshot.remainingWh).toBeNull()
    expect(snapshot.drivetrainEfficiencyPct).toBeNull()
    expect(snapshot.packResistanceOhm).toBeNull()
    expect(snapshot.gradePct).toBeNull()
    expect(snapshot.smoothnessScore).toBeNull()
    expect(snapshot.energyBalanceWh).toBe(0)
  })

  it('semnalele învechite nu intră în niciun total', () => {
    feed(analytics, 1000, [
      { battery_power_w: stale(3600), vehicle_speed_kph: stale(50) },
      { battery_power_w: stale(3600), vehicle_speed_kph: stale(50) },
      { battery_power_w: stale(3600), vehicle_speed_kph: stale(50) },
    ])

    expect(analytics.totals.energyConsumedWh).toBe(0)
    expect(analytics.totals.distanceKm).toBe(0)
    expect(analytics.totals.samples).toBe(0)
    expect(analytics.snapshot().live).toBe(false)
  })

  it('valorile marcate ca eroare de senzor sunt respinse', () => {
    feed(analytics, 1000, [
      { battery_power_w: entry('sensor_error', 99999) },
      { battery_power_w: entry('sensor_error', 99999) },
    ])

    expect(analytics.totals.energyConsumedWh).toBe(0)
    expect(analytics.totals.samples).toBe(0)
  })

  it('un semnal indisponibil cu valoare null nu produce NaN', () => {
    feed(analytics, 1000, [
      { battery_power_w: entry('unavailable', null) },
      { battery_power_w: entry('unavailable', null) },
    ])

    expect(Number.isNaN(analytics.totals.energyConsumedWh)).toBe(false)
    expect(analytics.totals.energyConsumedWh).toBe(0)
  })
})

describe('bilanț energetic', () => {
  let analytics: TelemetryAnalytics

  beforeEach(() => {
    analytics = new TelemetryAnalytics()
  })

  it('3600 W timp de două secunde înseamnă 2 Wh', () => {
    feed(analytics, 1000, [
      { battery_power_w: valid(3600) },
      { battery_power_w: valid(3600) },
      { battery_power_w: valid(3600) },
    ])

    expect(analytics.totals.energyConsumedWh).toBeCloseTo(2, 9)
  })

  it('o rampă de putere se integrează trapezoidal, nu dreptunghiular', () => {
    // 0 → 7200 W într-o secundă: aria este 3600 W · 1 s = 1 Wh.
    feed(analytics, 1000, [
      { battery_power_w: valid(0) },
      { battery_power_w: valid(7200) },
    ])

    expect(analytics.totals.energyConsumedWh).toBeCloseTo(1, 9)
  })

  it('puterea negativă merge la regenerare, nu la consum', () => {
    feed(analytics, 1000, [
      { battery_power_w: valid(-3600) },
      { battery_power_w: valid(-3600) },
    ])

    expect(analytics.totals.energyConsumedWh).toBe(0)
    expect(analytics.totals.energyRegenWh).toBeCloseTo(1, 9)
  })

  it('contorul mașinii are prioritate față de integrare', () => {
    feed(analytics, 1000, [
      { energy_consumed_wh: valid(100), battery_power_w: valid(3600) },
      { energy_consumed_wh: valid(130), battery_power_w: valid(3600) },
    ])

    // Exact diferența contorului: 30 Wh. Nu 31, adică nu se adună și integrarea.
    expect(analytics.totals.energyConsumedWh).toBeCloseTo(30, 9)
  })

  it('un contor resetat nu scade din bilanț', () => {
    feed(analytics, 1000, [
      { energy_consumed_wh: valid(100) },
      { energy_consumed_wh: valid(130) },
      // Placa a repornit: contorul o ia de la capăt.
      { energy_consumed_wh: valid(5) },
      { energy_consumed_wh: valid(9) },
    ])

    expect(analytics.totals.energyConsumedWh).toBeCloseTo(34, 9)
  })

  it('nu se integrează peste o pauză de legătură', () => {
    analytics.update(input(0, { battery_power_w: valid(3600) }))
    // Zece secunde de tăcere; mașina putea fi oprită tot timpul.
    analytics.update(input(10_000, { battery_power_w: valid(3600) }))

    expect(analytics.totals.energyConsumedWh).toBe(0)
  })

  it('bilanțul energetic adună solarul și regenerarea, scade consumul', () => {
    feed(analytics, 1000, [
      {
        energy_consumed_wh: valid(0),
        energy_solar_wh: valid(0),
        energy_regen_wh: valid(0),
      },
      {
        energy_consumed_wh: valid(500),
        energy_solar_wh: valid(300),
        energy_regen_wh: valid(50),
      },
    ])

    expect(analytics.snapshot().energyBalanceWh).toBeCloseTo(300 + 50 - 500, 9)
  })
})

describe('distanță și consum specific', () => {
  let analytics: TelemetryAnalytics

  beforeEach(() => {
    analytics = new TelemetryAnalytics()
  })

  it('distanța vine din contorul mașinii când există', () => {
    feed(analytics, 1000, [
      { distance_km: valid(0), vehicle_speed_kph: valid(36) },
      { distance_km: valid(1.5), vehicle_speed_kph: valid(36) },
    ])

    expect(analytics.totals.distanceKm).toBeCloseTo(1.5, 9)
  })

  it('fără contor, distanța se integrează din viteză', () => {
    // 36 km/h = 10 m/s, timp de 10 s, înseamnă 100 m.
    feed(
      analytics,
      1000,
      Array.from({ length: 11 }, () => ({ vehicle_speed_kph: valid(36) })),
    )

    expect(analytics.totals.distanceKm).toBeCloseTo(0.1, 9)
  })

  it('consumul specific este energia raportată la distanță', () => {
    feed(analytics, 1000, [
      { energy_consumed_wh: valid(0), distance_km: valid(0) },
      { energy_consumed_wh: valid(40), distance_km: valid(2) },
    ])

    expect(analytics.snapshot().whPerKm).toBeCloseTo(20, 9)
    expect(analytics.snapshot().kmPerKwh).toBeCloseTo(50, 9)
  })
})

describe('recuperare regenerativă', () => {
  it('folosește semnalul dedicat când controllerul îl raportează', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 1000, [
      { regen_power_w: valid(800), battery_power_w: valid(-500) },
      { regen_power_w: valid(800), battery_power_w: valid(-500) },
    ])

    expect(analytics.snapshot().regenW).toBe(800)
  })

  it('altfel o deduce din puterea negativă a motorului', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 1000, [
      { motor_power_w: valid(-900) },
      { motor_power_w: valid(-900) },
    ])

    expect(analytics.snapshot().regenW).toBe(900)
  })

  it('în tracțiune recuperarea este zero, nu negativă', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 1000, [
      { motor_power_w: valid(1200) },
      { motor_power_w: valid(1200) },
    ])

    expect(analytics.snapshot().regenW).toBe(0)
  })
})

describe('randamentul lanțului electric', () => {
  it('se raportează la magistrală, deci nu depășește 100 % într-o zi însorită', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 1000, [
      {
        motor_power_w: valid(3700),
        battery_power_w: valid(2770),
        solar_power_w: valid(930),
      },
      {
        motor_power_w: valid(3700),
        battery_power_w: valid(2770),
        solar_power_w: valid(930),
      },
    ])

    const value = analytics.snapshot().drivetrainEfficiencyPct as number
    expect(value).toBeGreaterThan(90)
    expect(value).toBeLessThanOrEqual(100)
  })
})

describe('elevație și manevre', () => {
  it('câștigul de elevație ignoră zgomotul receptorului', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 1000, [
      { gps_altitude_m: valid(300) },
      { gps_altitude_m: valid(300.2) },
      { gps_altitude_m: valid(305) },
    ])

    expect(analytics.totals.elevationGainM).toBeCloseTo(4.8, 9)
    expect(analytics.totals.elevationLossM).toBe(0)
  })

  it('o frânare bruscă este numărată', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 1000, [
      { vehicle_speed_kph: valid(36) },
      { vehicle_speed_kph: valid(0) },
    ])

    expect(analytics.totals.harshBrakeCount).toBe(1)
    expect(analytics.totals.harshAccelCount).toBe(0)
  })

  it('extremele rețin cea mai mare valoare văzută', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 1000, [
      { vehicle_speed_kph: valid(40), motor_temp_c: valid(70) },
      { vehicle_speed_kph: valid(65), motor_temp_c: valid(88) },
      { vehicle_speed_kph: valid(50), motor_temp_c: valid(80) },
    ])

    expect(analytics.totals.maxSpeedKph).toBe(65)
    expect(analytics.totals.maxMotorTempC).toBe(88)
  })
})

describe('întreruperea fluxului', () => {
  it('după ce semnalele devin învechite, contoarele îngheață', () => {
    const analytics = new TelemetryAnalytics()

    feed(analytics, 1000, [
      { battery_power_w: valid(3600) },
      { battery_power_w: valid(3600) },
      { battery_power_w: valid(3600) },
    ])
    const frozen = analytics.totals.energyConsumedWh
    expect(frozen).toBeCloseTo(2, 9)

    feed(
      analytics,
      1000,
      Array.from({ length: 20 }, () => ({ battery_power_w: stale(3600) })),
      3000,
    )

    expect(analytics.totals.energyConsumedWh).toBeCloseTo(frozen, 9)
    expect(analytics.snapshot().live).toBe(false)
    expect(analytics.snapshot().consumptionW).toBeNull()
  })

  it('reset aduce totul înapoi la zero', () => {
    const analytics = new TelemetryAnalytics()
    feed(analytics, 1000, [
      { battery_power_w: valid(3600), distance_km: valid(0) },
      { battery_power_w: valid(3600), distance_km: valid(3) },
    ])
    expect(analytics.totals.distanceKm).toBeGreaterThan(0)

    analytics.reset()

    for (const [key, value] of Object.entries(analytics.totals)) {
      expect(value, `contorul ${key}`).toBe(0)
    }
    expect(analytics.snapshot().live).toBe(false)
    expect(analytics.snapshot().whPerKm).toBeNull()
  })
})
