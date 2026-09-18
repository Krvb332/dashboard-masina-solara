import clsx from 'clsx'
import { useSignal } from '../hooks/useSignal'
import { NO_VALUE, formatAge, formatSignal } from '../lib/format'
import {
  compressPackPowerW,
  isCompressedPowerSignal,
  isPackPowerCompressed,
} from '../lib/power-scale'

/**
 * Afișarea unei valori de telemetrie.
 *
 * Puterea de pachet se afișează pe scala comprimată din `power-scale`: peste
 * 3,3 kW cifra se apropie asimptotic de 4 kW. Valoarea măsurată nu se pierde -
 * apare în tooltip ori de câte ori diferă de cea afișată.
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

  const compressed = isCompressedPowerSignal(signalKey)
  const shown = compressed ? compressPackPowerW(value) : value

  const text = fresh ? formatSignal(shown, definition) : NO_VALUE
  const tooltip = buildTooltip(
    state,
    value,
    quality?.age_ms,
    definition?.unit,
    // Doar când chiar se vede o cifră comprimată: pe o valoare învechită se
    // afișează „—", deci n-are ce să fie comprimat acolo.
    compressed && fresh && isPackPowerCompressed(value),
  )

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
  scaled: boolean,
): string {
  // Peste prag, cifra afișată nu mai este cea măsurată; tooltipul o dă pe cea
  // reală, altfel nimeni nu ar mai putea citi vârful de putere de pe card.
  const measured =
    scaled && value !== null
      ? `măsurat ${formatSignal(value, unit ? { decimals: 1, unit } : undefined)}, afișare comprimată peste 3,3 kW`
      : null

  if (state === 'valid') {
    return measured ? `${stateLabels.valid} · ${measured}` : stateLabels.valid
  }
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
