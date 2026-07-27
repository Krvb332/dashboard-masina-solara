import clsx from 'clsx'
import { SIGNAL_LIST, GROUP_LABELS, type SignalGroup } from '../config/signals'
import { useFreshness } from '../hooks/use-telemetry'
import { formatSignal, NO_DATA } from '../lib/format'
import type { SignalQuality } from '../schemas/telemetry'
import { selectSignal, useTelemetryStore } from '../stores/telemetry-store'

const qualityLabels: Record<SignalQuality, string> = {
  valid: 'valid',
  stale: 'învechit',
  unavailable: 'indisponibil',
  error: 'eroare',
}

const qualityStyles: Record<SignalQuality, string> = {
  valid: 'bg-emerald-400/10 text-emerald-300',
  stale: 'bg-amber-400/10 text-amber-300',
  unavailable: 'bg-zinc-500/10 text-zinc-400',
  error: 'bg-red-400/10 text-red-300',
}

/**
 * Tabelul complet de semnale, cu calitatea raportată pentru fiecare.
 * Este ecranul la care se uită un inginer când o valoare de pe dashboard
 * arată ciudat.
 */
export function SignalTable({ groups }: { groups?: SignalGroup[] }) {
  const signals = useTelemetryStore((state) => state.signals)
  const { isStale, isEmpty } = useFreshness()

  const visible = groups
    ? SIGNAL_LIST.filter((definition) => groups.includes(definition.group))
    : SIGNAL_LIST

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">
          Valorile curente ale semnalelor și calitatea fiecăruia
        </caption>
        <thead>
          <tr className="text-left text-xs tracking-wider text-zinc-500 uppercase">
            <th scope="col" className="pb-3 font-medium">
              Semnal
            </th>
            <th scope="col" className="pb-3 font-medium">
              Grupă
            </th>
            <th scope="col" className="pb-3 text-right font-medium">
              Valoare
            </th>
            <th scope="col" className="pb-3 text-right font-medium">
              Calitate
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((definition) => {
            const signal = selectSignal(signals, definition.key)
            const effectiveQuality: SignalQuality =
              isEmpty || signal.value === null
                ? 'unavailable'
                : isStale && signal.quality === 'valid'
                  ? 'stale'
                  : signal.quality

            return (
              <tr
                key={definition.key}
                className="border-t border-white/5 align-middle"
              >
                <th
                  scope="row"
                  className="py-2.5 pr-4 text-left font-medium text-zinc-200"
                >
                  {definition.label}
                  <span className="mt-0.5 block font-mono text-[11px] font-normal text-zinc-600">
                    {definition.key}
                  </span>
                </th>
                <td className="py-2.5 pr-4 text-zinc-500">
                  {GROUP_LABELS[definition.group]}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-100">
                  {signal.value === null
                    ? NO_DATA
                    : formatSignal(signal.value, definition)}
                </td>
                <td className="py-2.5 text-right">
                  <span
                    className={clsx(
                      'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                      qualityStyles[effectiveQuality],
                    )}
                  >
                    {qualityLabels[effectiveQuality]}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
