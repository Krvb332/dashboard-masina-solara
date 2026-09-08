import clsx from 'clsx'
import { getSignalDefinition, type SignalKey } from '../config/signals'
import { useFreshness } from '../hooks/use-telemetry'
import { signalSeverity } from '../lib/alarms'
import { selectSignal, useTelemetryStore } from '../stores/telemetry-store'

type Subsystem = {
  label: string
  /** Semnalele care descriu sănătatea subsistemului. */
  signals: SignalKey[]
  /** Text afișat când totul este în regulă. */
  healthy: string
}

const SUBSYSTEMS: Subsystem[] = [
  {
    label: 'BMS',
    signals: ['cell_voltage_min_v', 'cell_voltage_max_v', 'cell_temp_delta_c'],
    healthy: 'Celule echilibrate',
  },
  {
    label: 'MPPT',
    signals: ['mppt_efficiency_pct', 'solar_power_w'],
    healthy: 'Controlere în funcțiune',
  },
  {
    label: 'Motor și invertor',
    signals: ['motor_temp_c', 'inverter_temp_c', 'motor_power_w'],
    healthy: 'Funcționare normală',
  },
  {
    label: 'GPS',
    signals: ['gps_accuracy_m'],
    healthy: 'Poziție stabilă',
  },
]

type Health = 'ok' | 'warning' | 'critical' | 'unknown'

const dotStyles: Record<Health, string> = {
  ok: 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.55)]',
  warning: 'bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.55)]',
  critical: 'bg-red-400 shadow-[0_0_12px_rgba(239,68,68,0.6)]',
  unknown: 'bg-zinc-600',
}

const healthLabels: Record<Health, string> = {
  ok: 'Operațional',
  warning: 'Avertizare',
  critical: 'Critic',
  unknown: 'Fără date',
}

/**
 * Starea subsistemelor, dedusă din semnalele care le descriu.
 *
 * Un subsistem este „fără date" dacă niciunul dintre semnalele lui nu are
 * valoare — starea nu este presupusă bună în absența informației.
 */
export function SubsystemStatus() {
  const signals = useTelemetryStore((state) => state.signals)
  const { isStale, isEmpty } = useFreshness()

  return (
    <ul className="space-y-3">
      {SUBSYSTEMS.map((subsystem) => {
        let health: Health = 'unknown'
        let detail = subsystem.healthy
        let available = 0

        for (const key of subsystem.signals) {
          const definition = getSignalDefinition(key)
          const signal = selectSignal(signals, key)
          if (!definition || signal.value === null) continue
          available += 1

          if (signal.quality === 'error') {
            health = 'critical'
            detail = `Eroare senzor · ${definition.label}`
            break
          }

          const severity = signalSeverity(definition, signal.value)
          if (severity === 'critical') {
            health = 'critical'
            detail = `${definition.label} peste limita critică`
            break
          }
          // Cazul critic iese din buclă, deci aici nu putem suprascrie unul.
          if (severity === 'warning') {
            health = 'warning'
            detail = `${definition.label} în afara intervalului normal`
          }
        }

        if (available === 0) {
          health = 'unknown'
          detail = isEmpty ? 'Se așteaptă date' : 'Semnale indisponibile'
        } else if (health === 'unknown') {
          health = 'ok'
        }

        if (isStale && health === 'ok') {
          health = 'unknown'
          detail = 'Date învechite'
        }

        return (
          <li
            key={subsystem.label}
            className="flex min-h-11 items-center justify-between gap-4 rounded-xl bg-black/15 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-200">
                {subsystem.label}
              </p>
              <p className="truncate text-xs text-zinc-500">{detail}</p>
            </div>
            <span
              className={clsx('size-2.5 shrink-0 rounded-full', dotStyles[health])}
            >
              <span className="sr-only">{healthLabels[health]}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
