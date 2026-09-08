import clsx from 'clsx'
import { useSignal } from '../hooks/useSignal'
import { NO_VALUE, formatAge, formatSignal } from '../lib/format'

/**
 * Afișarea unei valori de telemetrie.
 *
 * Regula centrală a acestei componente: dacă semnalul nu este proaspăt, se
 * afișează „—", niciodată `0` și niciodată ultima valoare ca și cum ar fi
 * curentă. Valoarea veche rămâne disponibilă în tooltip, ca inginerul să aibă
 * context, dar nu poate fi confundată cu realitatea de acum.
 */

type SignalValueProps = {
  signalKey: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-3xl',
} as const

const stateLabels = {
  valid: 'Valoare actuală',
  stale: 'Valoare învechită',
  unavailable: 'Semnal nerecepționat',
  sensor_error: 'Eroare de senzor',
} as const

export function SignalValue({
  signalKey,
  size = 'md',
  className,
}: SignalValueProps) {
  const { definition, state, value, fresh, quality } = useSignal(signalKey)

  const text = fresh ? formatSignal(value, definition) : NO_VALUE
  const tooltip = buildTooltip(state, value, quality?.age_ms, definition?.unit)

  return (
    <span
      className={clsx(
        'font-semibold tracking-tight tabular-nums',
        sizeClasses[size],
        fresh ? 'text-white' : 'text-zinc-600',
        state === 'sensor_error' && 'text-rose-400',
        className,
      )}
      title={tooltip}
      data-signal={signalKey}
      data-quality={state}
    >
      {text}
      <span className="sr-only"> ({stateLabels[state]})</span>
    </span>
  )
}

function buildTooltip(
  state: string,
  value: number | null,
  ageMs: number | undefined,
  unit: string | undefined,
): string {
  if (state === 'valid') return stateLabels.valid
  if (state === 'unavailable') return stateLabels.unavailable

  const parts: string[] = [
    state === 'stale' ? stateLabels.stale : stateLabels.sensor_error,
  ]
  if (value !== null) {
    parts.push(`ultima valoare ${value}${unit ? ` ${unit}` : ''}`)
  }
  if (ageMs !== undefined) {
    parts.push(`acum ${formatAge(ageMs)}`)
  }
  return parts.join(' · ')
}
