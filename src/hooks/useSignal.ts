import { useMemo } from 'react'
import { speedKphFromRpm } from '../lib/telemetry-math'
import type {
  QualityState,
  SignalDefinition,
  SignalQuality,
} from '../schemas/telemetry'
import { useTelemetryStore } from '../stores/telemetry-store'

export type SignalView = {
  key: string
  definition: SignalDefinition | undefined
  quality: SignalQuality | undefined
  state: QualityState
  /** Valoarea afișabilă. `null` înseamnă „nu am date", nu zero. */
  value: number | null
  /** Adevărat doar când valoarea este proaspătă. */
  fresh: boolean
}

const MISSING: SignalQuality = { state: 'unavailable', age_ms: 0, value: null }

export function useSignal(key: string): SignalView {
  const definition = useTelemetryStore((state) => state.catalogByKey[key])
  const quality = useTelemetryStore((state) => state.quality[key])

  const resolved = quality ?? MISSING
  const fresh = resolved.state === 'valid'

  return {
    key,
    definition,
    quality,
    state: resolved.state,
    // O valoare învechită rămâne disponibilă pentru context („acum 12 s era
    // 41 °C"), dar componentele o afișează estompat, niciodată ca valoare curentă.
    value: resolved.value,
    fresh,
  }
}

/**
 * Semnalele unui grup din catalog. Selectorul întoarce `catalog` (referință
 * stabilă) și filtrarea se face în `useMemo`, altfel fiecare cadru primit ar
 * produce un array nou și o re-randare inutilă.
 */
export function useSignalsByGroup(group: string): SignalDefinition[] {
  const catalog = useTelemetryStore((state) => state.catalog)
  return useMemo(
    () => catalog.filter((signal) => signal.group === group),
    [catalog, group],
  )
}

export function useOverviewSignals(): SignalDefinition[] {
  const catalog = useTelemetryStore((state) => state.catalog)
  return useMemo(() => catalog.filter((signal) => signal.overview), [catalog])
}

export type GroundSpeedSource = 'raportată' | 'turație' | null

export type GroundSpeed = {
  /** Viteza la sol, km/h. `null` când nu există nici viteză, nici turație proaspătă. */
  kph: number | null
  source: GroundSpeedSource
}

/**
 * Viteza la sol pe care o afișează dashboardul, cu aceeași regulă ca în
 * acumulatorul de statistici: `vehicle_speed_kph` dacă placa o trimite, altfel
 * turația motorului trecută prin circumferința roții de 548 mm. Sursa este
 * expusă ca interfața să spună de unde vine cifra, nu doar cifra.
 */
export function useGroundSpeed(): GroundSpeed {
  const reported = useSignal('vehicle_speed_kph')
  const rpm = useSignal('motor_rpm')

  return useMemo(() => {
    if (reported.fresh && reported.value !== null) {
      return { kph: reported.value, source: 'raportată' as const }
    }
    const fromRpm = rpm.fresh ? speedKphFromRpm(rpm.value) : null
    if (fromRpm !== null) return { kph: fromRpm, source: 'turație' as const }
    return { kph: null, source: null }
  }, [reported.fresh, reported.value, rpm.fresh, rpm.value])
}
