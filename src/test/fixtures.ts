import type {
  QualityState,
  SignalDefinition,
  SignalQuality,
} from '../schemas/telemetry'
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
