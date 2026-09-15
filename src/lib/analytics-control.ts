import type { AnalyticsTotals } from './analytics'
import { EMPTY_TOTALS } from './analytics'

/**
 * Punctul prin care restul interfeței ajunge la acumulatorul de statistici.
 *
 * Acumulatorul este condus dintr-un efect (`useAnalyticsEngine`), la fel ca
 * WebSocketul. Butonul de reset din pagina „Sistem" trebuie să-l aducă la zero
 * fără să știe nimic despre el, exact ca în `telemetry-control.ts` — aceeași
 * soluție pentru aceeași problemă, ca să nu existe două tipare de citit.
 */

export type AnalyticsControl = {
  totals: () => AnalyticsTotals
  reset: () => void
}

let control: AnalyticsControl | null = null

export function registerAnalyticsControl(next: AnalyticsControl): () => void {
  control = next
  return () => {
    // La remontarea din StrictMode, efectul nou se înregistrează înaintea
    // curățării celui vechi; fără verificarea asta am rămâne fără control.
    if (control === next) control = null
  }
}

/** Contoarele acumulatorului acum, sau zerouri dacă motorul nu rulează. */
export function analyticsTotals(): AnalyticsTotals {
  return control?.totals() ?? { ...EMPTY_TOTALS }
}

export function resetAnalytics(): void {
  control?.reset()
}

export function isAnalyticsControlReady(): boolean {
  return control !== null
}
