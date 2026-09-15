import type { StatTone } from '../components/StatTile'

/**
 * Alegerea tonului vizual pentru o cifră derivată.
 *
 * Stă separat de componentă pentru că este logică pură, folosită din mai multe
 * panouri, iar un fișier care exportă și componente, și funcții rupe
 * fast-refresh-ul în dezvoltare.
 */

/** Praguri crescătoare: valorile mari sunt problema. */
export function toneAbove(
  value: number | null,
  warn: number,
  crit: number,
): StatTone {
  if (value === null || !Number.isFinite(value)) return 'neutral'
  if (value >= crit) return 'bad'
  if (value >= warn) return 'warn'
  return 'good'
}

/** Praguri descrescătoare: valorile mici sunt problema. */
export function toneBelow(
  value: number | null,
  warn: number,
  crit: number,
): StatTone {
  if (value === null || !Number.isFinite(value)) return 'neutral'
  if (value <= crit) return 'bad'
  if (value <= warn) return 'warn'
  return 'good'
}
