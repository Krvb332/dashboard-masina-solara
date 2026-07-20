import type { LucideIcon } from 'lucide-react'

type MetricCardProps = {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  tone?: 'default' | 'success' | 'warning'
}

const toneClasses = {
  default: 'bg-blue-500/10 text-blue-300 ring-blue-400/20',
  success: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  warning: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
}: MetricCardProps) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.16em] text-zinc-400 uppercase">
            {label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
            {value}
          </p>
        </div>
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-xl ring-1 ${toneClasses[tone]}`}
          aria-hidden="true"
        >
          <Icon size={20} strokeWidth={1.8} />
        </span>
      </div>
      <p className="mt-4 text-sm text-zinc-400">{detail}</p>
    </article>
  )
}
