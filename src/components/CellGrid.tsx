import clsx from 'clsx'
import { useMemo } from 'react'
import { useSignal } from '../hooks/useSignal'
import { formatSignal, NO_VALUE } from '../lib/format'
import { isCellSignal } from '../lib/signal-groups'
import { toneFor, type MetricTone } from '../lib/tone'
import { useTelemetryStore } from '../stores/telemetry-store'
import { SignalValue } from './SignalValue'

/**
 * Grila celulelor pachetului.
 *
 * Treizeci și două de rânduri de text nu se citesc; o grilă se citește dintr-o
 * privire, iar întrebarea la care răspunde panoul este „care celulă cedează",
 * nu „ce tensiune are celula 17". De aceea celula minimă și cea maximă sunt
 * marcate explicit, iar înălțimea barei arată poziția în intervalul de lucru.
 *
 * Culorile vin din pragurile catalogului, prin `toneFor`, la fel ca peste tot
 * în interfață: o celulă nu poate fi roșie aici și verde în rezumat.
 *
 * O celulă fără date se desenează goală și estompată, niciodată ca 0 V — este
 * aceeași regulă pe care o aplică `SignalValue`.
 */

const toneBar: Record<MetricTone, string> = {
  default: 'bg-blue-400/70',
  success: 'bg-emerald-400/70',
  warning: 'bg-amber-400/80',
  danger: 'bg-rose-500/80',
}

const toneText: Record<MetricTone, string> = {
  default: 'text-blue-300',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-rose-300',
}

export function CellGrid() {
  const catalog = useTelemetryStore((state) => state.catalog)

  // Ordonarea alfabetică este și ordinea fizică, fiindcă indicii din chei sunt
  // scriși cu două cifre (`cell_09_v` înainte de `cell_10_v`).
  const cells = useMemo(
    () =>
      catalog
        .filter((signal) => isCellSignal(signal.key))
        .sort((a, b) => a.key.localeCompare(b.key)),
    [catalog],
  )

  const minIndex = useSignal('cell_min_index')
  const maxIndex = useSignal('cell_max_index')

  if (cells.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Catalogul nu conține celule individuale.
      </p>
    )
  }

  return (
    <div>
      <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <Aggregate label="Minimă" signalKey="cell_voltage_min_v" />
        <Aggregate label="Maximă" signalKey="cell_voltage_max_v" />
        <Aggregate label="Dezechilibru" signalKey="cell_voltage_delta_v" />
      </dl>

      <ul
        className="grid grid-cols-8 gap-1.5 sm:grid-cols-8 lg:grid-cols-16"
        aria-label="Tensiunea fiecărei celule"
      >
        {cells.map((signal, position) => (
          <CellBar
            key={signal.key}
            signalKey={signal.key}
            number={position + 1}
            isMin={minIndex.fresh && minIndex.value === position + 1}
            isMax={maxIndex.fresh && maxIndex.value === position + 1}
          />
        ))}
      </ul>

      <p className="mt-3 text-xs text-zinc-500">
        Bara albastră marchează celula minimă, cea portocalie celula maximă.
        Celulele fără date rămân goale.
      </p>
    </div>
  )
}

function Aggregate({ label, signalKey }: { label: string; signalKey: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5">
        <SignalValue signalKey={signalKey} size="sm" />
      </dd>
    </div>
  )
}

type CellBarProps = {
  signalKey: string
  number: number
  isMin: boolean
  isMax: boolean
}

function CellBar({ signalKey, number, isMin, isMax }: CellBarProps) {
  const { definition, value, fresh, state } = useSignal(signalKey)

  const tone = toneFor(definition, fresh ? value : null)
  const fill = fresh ? fillFraction(value, definition?.min, definition?.max) : 0

  const eticheta = fresh
    ? `Celula ${number}: ${formatSignal(value, definition)}`
    : `Celula ${number}: ${NO_VALUE}`

  return (
    <li
      className={clsx(
        'flex flex-col items-center gap-1 rounded-md border px-1 pt-1.5 pb-1',
        isMin && 'border-sky-400/60 bg-sky-400/5',
        isMax && 'border-amber-400/60 bg-amber-400/5',
        !isMin && !isMax && 'border-white/10',
      )}
      title={eticheta}
      data-cell={number}
      data-quality={state}
    >
      <div
        className="flex h-14 w-full items-end rounded-sm bg-white/5"
        role="img"
        aria-label={eticheta}
      >
        <div
          className={clsx(
            'w-full rounded-sm transition-[height] duration-200',
            fresh ? toneBar[tone] : 'bg-transparent',
          )}
          // Un minim vizibil: la capătul de jos al intervalului bara ar dispărea
          // complet și n-ai putea deosebi „foarte descărcată" de „fără date".
          style={{ height: fresh ? `${Math.max(fill * 100, 6)}%` : '0%' }}
        />
      </div>
      <span
        className={clsx(
          'text-[10px] leading-none tabular-nums',
          fresh ? toneText[tone] : 'text-zinc-600',
        )}
      >
        {fresh ? formatSignal(value, { decimals: 3, unit: '' }) : NO_VALUE}
      </span>
      <span className="text-[10px] leading-none text-zinc-600 tabular-nums">
        {number}
      </span>
    </li>
  )
}

/** Poziția valorii în intervalul de lucru al semnalului, între 0 și 1. */
function fillFraction(
  value: number | null,
  min: number | null | undefined,
  max: number | null | undefined,
): number {
  if (value === null || min === null || min === undefined) return 0
  if (max === null || max === undefined || max <= min) return 0
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}
