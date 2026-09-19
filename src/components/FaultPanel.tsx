import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useSignal } from '../hooks/useSignal'
import { activeFaults } from '../lib/mitsuba-faults'

/**
 * Erorile raportate de controllerul Mitsuba, citite din masca de biți.
 *
 * Tabelul de biți trăiește în `lib/mitsuba-faults.ts`; îl reexportăm de aici
 * pentru codul (și testele) care îl cereau din panou.
 *
 * Fiecare stare a panoului poartă `data-error-anchor="faults"`: jurnalul de
 * erori duce aici și când bitul s-a stins și nu mai are rând propriu.
 */

export { MITSUBA_FAULTS } from '../lib/mitsuba-faults'
export type { Fault } from '../lib/mitsuba-faults'

export function FaultPanel() {
  const { value, fresh } = useSignal('motor_fault_code')

  if (!fresh || value === null) {
    return (
      <p
        className="text-sm text-zinc-500"
        data-testid="fault-unavailable"
        data-error-anchor="faults"
      >
        Controllerul nu raportează starea de eroare.
      </p>
    )
  }

  const active = activeFaults(value)

  if (active.length === 0) {
    return (
      <p
        className="flex items-center gap-2 text-sm text-emerald-300"
        data-testid="fault-none"
        data-error-anchor="faults"
      >
        <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
        Fără erori raportate de controller.
      </p>
    )
  }

  return (
    <ul
      className="space-y-2"
      data-testid="fault-list"
      data-error-anchor="faults"
    >
      {active.map((fault) => (
        <li
          key={fault.bit}
          className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-500/5 px-3 py-2"
          data-fault-bit={fault.bit}
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-rose-300"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-rose-200">{fault.label}</p>
            <p className="text-xs text-zinc-400">{fault.hint}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
