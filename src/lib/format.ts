import type { SignalDefinition } from '../schemas/telemetry'

/**
 * Formatare în convenția românească (virgulă zecimală), consecventă cu restul
 * interfeței. `NO_VALUE` este singura reprezentare pentru „nu am date" - nu
 * folosim niciodată `0` în locul unei valori lipsă.
 */

export const NO_VALUE = '—'

const formatters = new Map<number, Intl.NumberFormat>()

function formatterFor(decimals: number): Intl.NumberFormat {
  let formatter = formatters.get(decimals)
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat('ro-RO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    formatters.set(decimals, formatter)
  }
  return formatter
}

export function formatNumber(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return NO_VALUE
  return formatterFor(decimals).format(value)
}

export function formatSignal(
  value: number | null | undefined,
  signal?: Pick<SignalDefinition, 'decimals' | 'unit'>,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NO_VALUE
  }

  const text = formatNumber(value, signal?.decimals ?? 1)
  const unit = signal?.unit?.trim()
  if (!unit) return text
  return unit === '%' || unit === '°' ? `${text}${unit}` : `${text} ${unit}`
}

export function formatSigned(value: number, decimals = 1): string {
  const text = formatNumber(Math.abs(value), decimals)
  if (value > 0) return `+${text}`
  if (value < 0) return `−${text}`
  return text
}

/** Vechimea unei valori, în formă scurtă: `340 ms`, `2,4 s`, `1 min 05 s`. */
export function formatAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return NO_VALUE
  if (ms < 1000) return `${Math.round(ms)} ms`

  const seconds = ms / 1000
  if (seconds < 60) return `${formatNumber(seconds, 1)} s`

  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes} min ${String(rest).padStart(2, '0')} s`
}

export function formatClock(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return NO_VALUE

  return new Intl.DateTimeFormat('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export function formatDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return NO_VALUE

  return new Intl.DateTimeFormat('ro-RO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return NO_VALUE

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${minutes}:${pad(rest)}`
}
