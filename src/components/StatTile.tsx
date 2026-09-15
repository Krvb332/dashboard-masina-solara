import clsx from 'clsx'
import type { ReactNode } from 'react'
import { NO_VALUE, formatNumber } from '../lib/format'

/**
 * O cifră derivată, cu formula din spatele ei.
 *
 * Diferența față de `MetricCard` este sursa: acolo valoarea vine de la un
 * senzor și are stare de calitate; aici valoarea este calculată în browser.
 * Formula afișată sub cifră nu este decor — cine vede „18,4 Wh/km" trebuie să
 * poată verifica din ce a ieșit, altfel cifra rămâne o părere.
 *
 * O valoare `null` se afișează „—", niciodată `0`: „nu se poate calcula" și
 * „chiar este zero" sunt lucruri diferite, iar confuzia dintre ele strică orice
 * statistică trasă la final.
 */

export type StatTone = 'neutral' | 'good' | 'warn' | 'bad'

const toneClasses: Record<StatTone, string> = {
  neutral: 'text-zinc-100',
  good: 'text-emerald-200',
  warn: 'text-amber-200',
  bad: 'text-rose-200',
}

type StatTileProps = {
  label: string
  value: number | null
  unit?: string
  decimals?: number
  /** Formula sau sursa cifrei, în text scurt. */
  formula?: string
  hint?: string
  tone?: StatTone
  icon?: ReactNode
  className?: string
}

export function StatTile({
  label,
  value,
  unit = '',
  decimals = 1,
  formula,
  hint,
  tone = 'neutral',
  icon,
  className,
}: StatTileProps) {
  const missing = value === null || !Number.isFinite(value)
  const text = missing ? NO_VALUE : formatNumber(value, decimals)

  return (
    <div
      className={clsx(
        'min-w-0 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5',
        className,
      )}
      data-stat={label}
      data-missing={missing ? 'true' : 'false'}
      title={hint}
    >
      <p className="flex min-w-0 items-center gap-2 text-xs tracking-wide text-zinc-500 uppercase">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p
        className={clsx(
          'mt-1 text-xl font-semibold tabular-nums',
          missing ? 'text-zinc-600' : toneClasses[tone],
        )}
      >
        {text}
        {!missing && unit ? (
          <span className="ml-1 text-sm font-normal text-zinc-500">{unit}</span>
        ) : null}
      </p>
      {formula ? (
        <p className="mt-1 truncate font-mono text-[11px] text-zinc-600">
          {formula}
        </p>
      ) : null}
    </div>
  )
}
