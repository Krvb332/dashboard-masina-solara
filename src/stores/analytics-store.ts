import { create } from 'zustand'
import { emptySnapshot, type AnalyticsSnapshot } from '../lib/analytics'
import { buildAdvice, type Advice } from '../lib/coaching'

/**
 * Rezultatul acumulatorului de statistici, publicat pentru interfață.
 *
 * Acumulatorul rulează la 5 Hz, dar nimeni nu citește cifre de cinci ori pe
 * secundă. Store-ul de față este banda lentă: hookul motor îi împinge un
 * snapshot de câteva ori pe secundă, iar paginile se re-randează doar atunci.
 * Aceeași separare ca între bufferul de serii și `telemetry-store`.
 */

export type StrategySettings = {
  /** Consumul-țintă al strategiei, în Wh/km. `null` = fără țintă impusă. */
  targetWhPerKm: number | null
  /** Distanța rămasă de parcurs, în km. `null` = necunoscută. */
  remainingDistanceKm: number | null
}

type AnalyticsStore = {
  snapshot: AnalyticsSnapshot
  advice: Advice[]
  updatedAt: number | null
  strategy: StrategySettings

  publish: (snapshot: AnalyticsSnapshot, now?: number) => void
  setStrategy: (settings: Partial<StrategySettings>) => void
  clear: () => void
}

const initialStrategy: StrategySettings = {
  targetWhPerKm: null,
  remainingDistanceKm: null,
}

export const useAnalyticsStore = create<AnalyticsStore>((set, get) => ({
  snapshot: emptySnapshot(),
  advice: [],
  updatedAt: null,
  strategy: initialStrategy,

  publish: (snapshot, now = Date.now()) =>
    set({
      snapshot,
      advice: buildAdvice(snapshot, get().strategy),
      updatedAt: now,
    }),

  // Schimbarea strategiei trebuie să se vadă imediat în recomandări, nu la
  // următorul eșantion: în boxă, cifra se introduce exact când se ia decizia.
  setStrategy: (settings) =>
    set((state) => {
      const strategy = { ...state.strategy, ...settings }
      return { strategy, advice: buildAdvice(state.snapshot, strategy) }
    }),

  clear: () => set({ snapshot: emptySnapshot(), advice: [], updatedAt: null }),
}))
