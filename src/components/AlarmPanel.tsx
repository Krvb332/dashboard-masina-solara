import clsx from 'clsx'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { Alarm, AlarmSeverity } from '../schemas/telemetry'

const severityStyles: Record<
  AlarmSeverity,
  { container: string; icon: typeof AlertTriangle; iconClass: string; title: string; detail: string }
> = {
  critical: {
    container: 'border-red-400/30 bg-red-400/[0.08]',
    icon: AlertOctagon,
    iconClass: 'text-red-300',
    title: 'text-red-100',
    detail: 'text-red-200/70',
  },
  warning: {
    container: 'border-amber-400/20 bg-amber-400/[0.07]',
    icon: AlertTriangle,
    iconClass: 'text-amber-300',
    title: 'text-amber-100',
    detail: 'text-amber-200/70',
  },
  info: {
    container: 'border-blue-400/20 bg-blue-400/[0.07]',
    icon: Info,
    iconClass: 'text-blue-300',
    title: 'text-blue-100',
    detail: 'text-blue-200/70',
  },
}

export function AlarmPanel({
  alarms,
  emptyLabel = 'Nicio alarmă activă',
}: {
  alarms: Alarm[]
  emptyLabel?: string
}) {
  if (alarms.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-3">
        <CheckCircle2
          size={18}
          className="shrink-0 text-emerald-300"
          aria-hidden="true"
        />
        <p className="text-sm text-emerald-100">{emptyLabel}</p>
      </div>
    )
  }

  return (
    <ul className="space-y-2.5">
      {alarms.map((alarm) => {
        const style = severityStyles[alarm.severity]
        const Icon = style.icon

        return (
          <li
            key={alarm.id}
            className={clsx(
              'flex items-start gap-3 rounded-xl border p-3',
              style.container,
            )}
          >
            <Icon
              size={18}
              className={clsx('mt-0.5 shrink-0', style.iconClass)}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className={clsx('text-sm font-medium', style.title)}>
                {alarm.title}
              </p>
              {alarm.detail && (
                <p className={clsx('mt-1 text-xs leading-5', style.detail)}>
                  {alarm.detail}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
