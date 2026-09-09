import type { StreamStats } from '../schemas/telemetry'

/**
 * Contoarele de flux, raportate la ultima resetare.
 *
 * `stats` vine de pe server și numără de la pornirea serviciului, nu de când se
 * uită cineva la ecran. Fără scăderea de mai jos, butonul de reset ar părea că
 * nu face nimic: pui contoarele pe zero, iar peste 200 ms sosește următorul
 * cadru cu „357 mesaje primite" și le pune la loc.
 *
 * Linia de bază este locală și nu atinge serverul — două tablete pot avea
 * momente de reset diferite fără să se încurce între ele.
 */

/** Contoarele care cresc monoton și au sens raportate la un moment zero. */
const CUMULATIVE = [
  'received',
  'dropped',
  'duplicates',
  'out_of_order',
  'invalid',
] as const satisfies readonly (keyof StreamStats)[]

export function subtractStats(
  stats: StreamStats,
  baseline: StreamStats | null,
): StreamStats {
  // Serverul repornit își reia numărătoarea de la zero. Dacă am păstra linia
  // de bază veche, toate contoarele ar rămâne blocate pe 0 la nesfârșit.
  if (baseline === null || stats.received < baseline.received) return stats

  const adjusted = { ...stats }
  for (const key of CUMULATIVE) {
    adjusted[key] = Math.max(0, stats[key] - baseline[key])
  }
  return adjusted
}
