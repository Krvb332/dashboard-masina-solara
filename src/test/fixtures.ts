import { TelemetryAnalytics, type QualityEntry } from '../lib/analytics'
import type {
  QualityState,
  SignalDefinition,
  SignalQuality,
} from '../schemas/telemetry'
import { useAnalyticsStore } from '../stores/analytics-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/** Un semnal minim valid, peste care testele suprascriu doar ce le interesează. */
export function makeSignal(
  overrides: Partial<SignalDefinition> & { key: string },
): SignalDefinition {
  return {
    label: overrides.key,
    unit: '',
    group: 'status',
    decimals: 1,
    min: null,
    max: null,
    stale_after_s: 2,
    warn_below: null,
    crit_below: null,
    warn_above: null,
    crit_above: null,
    hysteresis: 0,
    overview: false,
    chartable: true,
    color: null,
    description: '',
    ...overrides,
  }
}

export function makeQuality(
  state: QualityState,
  value: number | null,
  ageMs = 0,
): SignalQuality {
  return { state, age_ms: ageMs, value }
}

/** Încarcă în store un catalog și o stare de calitate, ca într-o sesiune reală. */
export function seedTelemetry(
  signals: SignalDefinition[],
  quality: Record<string, SignalQuality> = {},
): void {
  useTelemetryStore.getState().setCatalog(signals)
  useTelemetryStore.setState({ quality })
}

export function resetTelemetryStore(): void {
  useTelemetryStore.getState().reset()
  useTelemetryStore.getState().setCatalog([])
  useTelemetryStore.setState({ connection: 'connecting', latest: null })
}

/**
 * Publică în `analytics-store` instantaneul unei sesiuni simulate reale: zece
 * secunde la 45 km/h, 1800 W din pachet, 900 W de la panouri, 300 W recuperați,
 * cu contoare crescătoare.
 *
 * Cifrele sunt alese ca să iasă un consum de 40 Wh/km peste un aport solar de
 * 20 Wh/km — adică dublu față de echilibru, deci recomandările au pe ce se
 * declanșa. Stă aici pentru ca pagina de statistici și panoul de recomandări să
 * pornească de la exact aceleași cifre.
 */
export function publishSimulatedRun(): void {
  const valid = (value: number): QualityEntry => ({ state: 'valid', value })
  const analytics = new TelemetryAnalytics()

  for (let step = 0; step <= 50; step += 1) {
    analytics.update({
      timeMs: step * 200,
      quality: {
        vehicle_speed_kph: valid(45),
        battery_power_w: valid(1800),
        solar_power_w: valid(900),
        regen_power_w: valid(300),
        motor_power_w: valid(1600),
        battery_soc_pct: valid(70),
        battery_voltage_v: valid(115),
        battery_current_a: valid(15.65),
        distance_km: valid(step * 0.0025),
        energy_consumed_wh: valid(step * 0.1),
        energy_solar_wh: valid(step * 0.05),
        energy_regen_wh: valid(step * 0.0167),
        gps_altitude_m: valid(340),
        throttle_pct: valid(38),
      },
    })
  }

  useAnalyticsStore.getState().publish(analytics.snapshot())
}
