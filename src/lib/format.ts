import type { SignalDefinition } from '../config/signals'

/** Marcaj afișat când nu avem date. Nu trebuie confundat niciodată cu `0`. */
export const NO_DATA = '—'

const formatterCache = new Map<number, Intl.NumberFormat>()

function getFormatter(decimals: number): Intl.NumberFormat {
  let formatter = formatterCache.get(decimals)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ro-RO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    formatterCache.set(decimals, formatter)
  }
  return formatter
}

export function formatNumber(
  value: number | null | undefined,
  decimals = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NO_DATA
  }
  return getFormatter(decimals).format(value)
}

/** Unități care se lipesc de număr, fără spațiu. */
const ATTACHED_UNITS = new Set(['°'])

export function formatSignal(
  value: number | null | undefined,
  definition: Pick<SignalDefinition, 'decimals' | 'unit'>,
): string {
  const formatted = formatNumber(value, definition.decimals)
  if (formatted === NO_DATA || !definition.unit) return formatted
  if (ATTACHED_UNITS.has(definition.unit)) return `${formatted}${definition.unit}`
  return `${formatted} ${definition.unit}`
}

/** Transformă o vechime în milisecunde într-un text scurt, ex. „1,4 s". */
export function formatAge(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return NO_DATA
  if (ageMs < 1_000) return `${Math.round(ageMs)} ms`
  if (ageMs < 60_000) return `${formatNumber(ageMs / 1_000, 1)} s`
  const minutes = Math.floor(ageMs / 60_000)
  const seconds = Math.round((ageMs % 60_000) / 1_000)
  return `${minutes} min ${seconds} s`
}

export function formatClock(timestamp: number | null): string {
  if (timestamp === null) return NO_DATA
  return new Intl.DateTimeFormat('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
}

/** Energie în Wh, afișată în kWh când depășește 1 kWh. */
export function formatEnergy(wattHours: number | null): string {
  if (wattHours === null || !Number.isFinite(wattHours)) return NO_DATA
  if (Math.abs(wattHours) >= 1_000) {
    return `${formatNumber(wattHours / 1_000, 2)} kWh`
  }
  return `${formatNumber(wattHours, 0)} Wh`
}
