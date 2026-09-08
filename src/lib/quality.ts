import type {
  Sample,
  SignalDefinition,
  SignalQuality,
} from '../schemas/telemetry'

/**
 * Calculul calității pe partea de client.
 *
 * În mod live, calitatea vine de la server. În replay nu avem server care să o
 * calculeze, dar regula trebuie să rămână identică - altfel un semnal care
 * dispare din flux ar apărea în replay ca `0` în loc de „fără date", exact
 * confuzia pe care cerința 3 din arhitectură o interzice.
 */
export class QualityTracker {
  private readonly lastSeen = new Map<string, { time: number; value: number }>()

  reset(): void {
    this.lastSeen.clear()
  }

  observe(sample: Sample, timeMs: number): void {
    for (const [key, value] of Object.entries(sample.signals)) {
      this.lastSeen.set(key, { time: timeMs, value })
    }
  }

  compute(
    catalog: SignalDefinition[],
    nowMs: number,
  ): Record<string, SignalQuality> {
    const quality: Record<string, SignalQuality> = {}

    for (const signal of catalog) {
      const entry = this.lastSeen.get(signal.key)

      if (entry === undefined) {
        quality[signal.key] = { state: 'unavailable', age_ms: 0, value: null }
        continue
      }

      const age = Math.max(0, Math.round(nowMs - entry.time))
      quality[signal.key] = {
        state: age > signal.stale_after_s * 1000 ? 'stale' : 'valid',
        age_ms: age,
        value: entry.value,
      }
    }

    return quality
  }
}
