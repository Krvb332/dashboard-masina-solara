import type { LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { NO_DATA } from '../lib/format'

/** Culoarea de identitate a cardului. Nu comunică nimic despre alarme. */
export type MetricAccent = 'blue' | 'emerald' | 'amber' | 'zinc'

/** Depășire de prag. Doar aceasta schimbă chenarul. */
export type MetricSeverity = 'warning' | 'critical'

type MetricCardProps = {
  label: string
  value: string
  detail?: string
  icon: LucideIcon
  accent?: MetricAccent
  severity?: MetricSeverity | null
  /** Datele nu mai sunt proaspete: valoarea este afișată estompat. */
  stale?: boolean
}

const accentClasses: Record<MetricAccent, string> = {
  blue: 'bg-blue-500/10 text-blue-300 ring-blue-400/20',
  emerald: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  amber: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
  zinc: 'bg-zinc-500/10 text-zinc-400 ring-zinc-400/20',
}

const severityAccent: Record<MetricSeverity, string> = {
  warning: 'bg-amber-500/15 text-amber-300 ring-amber-400/40',
  critical: 'bg-red-500/15 text-red-300 ring-red-400/40',
}

const severityBorder: Record<MetricSeverity, string> = {
  warning: 'border-amber-400/35',
  critical: 'border-red-400/50',
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = 'blue',
  severity = null,
  stale = false,
}: MetricCardProps) {
  const hasValue = value !== NO_DATA

  return (
    <article
      className={clsx(
        'rounded-2xl border bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm transition-colors',
        severity ? severityBorder[severity] : 'border-white/10',
        stale && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-[0.16em] text-zinc-400 uppercase">
            {label}
          </p>
          <p
            className={clsx(
              'mt-3 text-3xl font-semibold tracking-tight tabular-nums',
              hasValue ? 'text-white' : 'text-zinc-600',
            )}
          >
            {value}
          </p>
        </div>
        <span
          className={clsx(
            'grid size-11 shrink-0 place-items-center rounded-xl ring-1',
            severity ? severityAccent[severity] : accentClasses[accent],
          )}
          aria-hidden="true"
        >
          <Icon size={20} strokeWidth={1.8} />
        </span>
      </div>
      <p className="mt-4 min-h-5 text-sm text-zinc-400">
        {stale ? 'Date învechite' : (detail ?? '')}
      </p>
    </article>
  )
}
