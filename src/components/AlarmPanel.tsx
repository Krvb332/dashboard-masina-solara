import clsx from 'clsx'
import {
  AlertTriangle,
  Check,
  Info,
  OctagonAlert,
  ShieldCheck,
} from 'lucide-react'
import { ackAlarm } from '../lib/api'
import { formatClock } from '../lib/format'
import type { Alarm, Severity } from '../schemas/telemetry'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Alarmele calculate pe server, prioritizate critic > avertizare > informație.
 *
 * Confirmarea („am văzut") estompează alarma, dar nu o ascunde: cât timp
 * condiția persistă, ea rămâne pe ecran.
 */

const severityOrder: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

const severityStyles: Record<Severity, string> = {
  critical: 'border-rose-400/25 bg-rose-400/[0.09] text-rose-100',
  warning: 'border-amber-400/20 bg-amber-400/[0.07] text-amber-100',
  info: 'border-sky-400/20 bg-sky-400/[0.07] text-sky-100',
}

const severityIcons: Record<Severity, typeof AlertTriangle> = {
  critical: OctagonAlert,
  warning: AlertTriangle,
  info: Info,
}

const severityLabels: Record<Severity, string> = {
  critical: 'Critic',
  warning: 'Avertizare',
  info: 'Informație',
}

export function AlarmPanel({ limit }: { limit?: number }) {
  const alarms = useTelemetryStore((state) => state.alarms)
  const acknowledged = useTelemetryStore((state) => state.acknowledged)
  const acknowledgeAlarm = useTelemetryStore((state) => state.acknowledgeAlarm)

  const sorted = [...alarms].sort(
    (first, second) =>
      severityOrder[first.severity] - severityOrder[second.severity] ||
      first.raised_at.localeCompare(second.raised_at),
  )
  const visible = limit ? sorted.slice(0, limit) : sorted

  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-3 text-sm text-emerald-100">
        <ShieldCheck size={18} className="shrink-0" aria-hidden="true" />
        Nicio alarmă activă.
      </div>
    )
  }

  const handleAck = (alarm: Alarm) => {
    acknowledgeAlarm(alarm.id)
    // Confirmarea se trimite și serverului, ca să apară în istoricul sesiunii.
    // Eșecul nu trebuie să blocheze interfața: alarma rămâne oricum vizibilă.
    void ackAlarm(alarm.id).catch(() => undefined)
  }

  return (
    <ul className="space-y-2" aria-label="Alarme active">
      {visible.map((alarm) => {
        const Icon = severityIcons[alarm.severity]
        const isAcknowledged = acknowledged.includes(alarm.id)

        return (
          <li
            key={alarm.id}
            className={clsx(
              'flex items-start gap-3 rounded-xl border p-3',
              severityStyles[alarm.severity],
              isAcknowledged && 'opacity-55',
            )}
            data-severity={alarm.severity}
          >
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {alarm.label}
                <span className="ml-2 rounded bg-black/25 px-1.5 py-0.5 text-[11px] font-normal tracking-wide uppercase">
                  {severityLabels[alarm.severity]}
                </span>
              </p>
              <p className="mt-1 text-xs leading-5 text-current/70">
                {alarm.message}
              </p>
              <p className="mt-1 text-[11px] text-current/50">
                de la {formatClock(alarm.raised_at)}
              </p>
            </div>

            {!isAcknowledged && (
              <button
                type="button"
                onClick={() => handleAck(alarm)}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-black/20 transition-colors hover:bg-black/35"
                aria-label={`Confirmă alarma ${alarm.label}`}
                title="Confirmă"
              >
                <Check size={15} aria-hidden="true" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
