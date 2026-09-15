import clsx from 'clsx'
import {
  CircleAlert,
  Info,
  ThumbsUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { primaryAdvice, type Advice, type AdviceLevel } from '../lib/coaching'
import { useAnalyticsStore } from '../stores/analytics-store'

/**
 * Ce trebuie transmis pilotului, acum.
 *
 * Panoul are o ierarhie strictă: un singur mesaj mare, cel mai grav, plus
 * restul ca listă. Într-o boxă nimeni nu citește șapte propoziții la stație;
 * se citește una și se transmite pe radio. Restul rămân la îndemână pentru
 * inginer.
 *
 * Cu fluxul căzut panoul spune explicit că nu are date, în loc să repete
 * ultimul sfat ca și cum ar fi încă valabil.
 */

const levelIcons: Record<AdviceLevel, LucideIcon> = {
  critical: CircleAlert,
  warning: TriangleAlert,
  info: Info,
  good: ThumbsUp,
}

const levelClasses: Record<AdviceLevel, string> = {
  critical: 'border-rose-400/30 bg-rose-500/[0.09] text-rose-100',
  warning: 'border-amber-400/30 bg-amber-500/[0.08] text-amber-100',
  info: 'border-sky-400/25 bg-sky-500/[0.07] text-sky-100',
  good: 'border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-100',
}

const levelAccent: Record<AdviceLevel, string> = {
  critical: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300',
  good: 'text-emerald-300',
}

export function CoachingPanel() {
  const advice = useAnalyticsStore((state) => state.advice)
  const live = useAnalyticsStore((state) => state.snapshot.live)

  if (!live || advice.length === 0) {
    return (
      <p
        className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-zinc-500"
        role="status"
      >
        Fără date de la mașină. Recomandările apar din momentul în care curge
        telemetria — nu se repetă ultimul sfat primit.
      </p>
    )
  }

  const main = primaryAdvice(advice) as Advice
  const rest = advice.filter((entry) => entry.id !== main.id)

  return (
    <div className="grid gap-3">
      <MainAdvice advice={main} />
      {rest.length > 0 && (
        <ul className="grid gap-2" aria-label="Alte observații">
          {rest.map((entry) => (
            <SecondaryAdvice key={entry.id} advice={entry} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MainAdvice({ advice }: { advice: Advice }) {
  const Icon = levelIcons[advice.level]

  return (
    <div
      className={clsx(
        'rounded-xl border p-4 sm:p-5',
        levelClasses[advice.level],
      )}
      role={advice.level === 'critical' ? 'alert' : 'status'}
      data-advice={advice.id}
      data-level={advice.level}
    >
      <div className="flex items-start gap-3">
        <Icon
          size={22}
          className={clsx('mt-0.5 shrink-0', levelAccent[advice.level])}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight">{advice.title}</p>
          <p className="mt-1 text-sm text-current/80">{advice.detail}</p>
          {/*
            Acțiunea este pusă vizual deasupra explicației ca importanță:
            explicația convinge inginerul, acțiunea ajunge la pilot.
          */}
          <p className="mt-3 border-l-2 border-current/30 pl-3 text-sm font-medium">
            {advice.action}
          </p>
        </div>
      </div>
    </div>
  )
}

function SecondaryAdvice({ advice }: { advice: Advice }) {
  const Icon = levelIcons[advice.level]

  return (
    <li
      className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5"
      data-advice={advice.id}
      data-level={advice.level}
    >
      <Icon
        size={15}
        className={clsx('mt-0.5 shrink-0', levelAccent[advice.level])}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-100">{advice.title}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{advice.detail}</p>
        <p className="mt-1 text-xs text-zinc-300">{advice.action}</p>
      </div>
    </li>
  )
}
