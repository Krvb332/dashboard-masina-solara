import clsx from 'clsx'
import { Check, CircleHelp, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { formatNumber, NO_VALUE } from '../lib/format'
import {
  runConsistencyChecks,
  summarizeConsistency,
  type ConsistencyResult,
} from '../lib/consistency'
import { summarizeSources } from '../lib/sensor-sources'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * „Sunt toate valorile mapate corect?" — răspunsul, într-un singur panou.
 *
 * Tabelul de calitate din pagina „Sistem" spune dacă un semnal *sosește*.
 * Panoul de față spune dacă valoarea lui *are sens*, confruntând semnalele
 * redundante între ele: puterea cu produsul tensiune-curent, totalul solar cu
 * suma controlerelor, dezechilibrul celulelor cu extremele lor.
 *
 * O verificare „necunoscută" nu este o trecere. Este marcată separat exact ca
 * să nu fie citită drept confirmare — cel mai frecvent mod în care un panou de
 * verificare devine inutil este să numere absența ca succes.
 */

const statusIcons = {
  ok: Check,
  mismatch: TriangleAlert,
  unknown: CircleHelp,
} as const

const statusClasses = {
  ok: 'text-emerald-300',
  mismatch: 'text-rose-300',
  unknown: 'text-zinc-500',
} as const

const statusLabels = {
  ok: 'coerent',
  mismatch: 'nepotrivire',
  unknown: 'fără date',
} as const

export function SignalMappingPanel() {
  const quality = useTelemetryStore((state) => state.quality)
  const catalog = useTelemetryStore((state) => state.catalog)

  const results = useMemo(() => {
    const lookup = (key: string) => {
      const entry = quality[key]
      if (entry === undefined || entry.state !== 'valid') return null
      if (entry.value === null || !Number.isFinite(entry.value)) return null
      return entry.value
    }
    return runConsistencyChecks(lookup)
  }, [quality])

  const summary = summarizeConsistency(results)

  const sources = useMemo(
    () =>
      summarizeSources(
        catalog.map((signal) => signal.key),
        quality,
      ),
    [catalog, quality],
  )

  const states = useMemo(() => {
    const counts = { valid: 0, stale: 0, unavailable: 0, sensor_error: 0 }
    for (const signal of catalog) {
      const state = quality[signal.key]?.state ?? 'unavailable'
      counts[state] += 1
    }
    return counts
  }, [catalog, quality])

  const errored = useMemo(
    () =>
      catalog.filter((signal) => quality[signal.key]?.state === 'sensor_error'),
    [catalog, quality],
  )

  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tally label="Proaspete" value={states.valid} tone="ok" />
        <Tally label="Învechite" value={states.stale} tone="warn" />
        <Tally label="Nerecepționate" value={states.unavailable} tone="muted" />
        <Tally label="Eroare senzor" value={states.sensor_error} tone="bad" />
      </dl>

      <div>
        <p className="text-xs tracking-wide text-zinc-500 uppercase">
          Coerență între semnale redundante
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {summary.ok} coerente · {summary.mismatch} nepotriviri ·{' '}
          {summary.unknown} fără date suficiente
        </p>

        <ul className="mt-3 grid gap-2">
          {results.map((result) => (
            <CheckRow key={result.key} result={result} />
          ))}
        </ul>
      </div>

      {errored.length > 0 && (
        <div>
          <p className="text-xs tracking-wide text-rose-300 uppercase">
            Valori în afara domeniului declarat
          </p>
          <ul className="mt-2 grid gap-1 text-sm text-zinc-300">
            {errored.map((signal) => (
              <li key={signal.key} className="flex justify-between gap-4">
                <span className="truncate">
                  {signal.label}
                  <span className="ml-2 font-mono text-xs text-zinc-600">
                    {signal.key}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {quality[signal.key]?.value === null
                    ? NO_VALUE
                    : formatNumber(
                        quality[signal.key]?.value as number,
                        signal.decimals,
                      )}{' '}
                  {signal.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs tracking-wide text-zinc-500 uppercase">
          Surse de date
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {sources.sources.map((source) => (
            <li
              key={source.key}
              className={clsx(
                'rounded-lg border px-2 py-1 text-xs',
                source.online
                  ? 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200'
                  : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200',
              )}
              data-source={source.key}
            >
              {source.label}{' '}
              <span className="text-current/60 tabular-nums">
                {source.fresh}/{source.total}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CheckRow({ result }: { result: ConsistencyResult }) {
  const Icon = statusIcons[result.status]

  return (
    <li
      className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
      data-check={result.key}
      data-status={result.status}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          size={15}
          className={clsx('mt-0.5 shrink-0', statusClasses[result.status])}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-zinc-200">{result.label}</span>
            <span className={clsx('text-xs', statusClasses[result.status])}>
              {statusLabels[result.status]}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">
            așteptat{' '}
            {result.expected === null
              ? NO_VALUE
              : `${formatNumber(result.expected, result.decimals)} ${result.unit}`}
            {' · '}
            raportat{' '}
            {result.actual === null
              ? NO_VALUE
              : `${formatNumber(result.actual, result.decimals)} ${result.unit}`}
          </p>
          {result.status === 'mismatch' && (
            <p className="mt-1 text-xs text-rose-200">{result.hint}</p>
          )}
        </div>
      </div>
    </li>
  )
}

const tallyTones = {
  ok: 'text-emerald-200',
  warn: 'text-amber-200',
  bad: 'text-rose-200',
  muted: 'text-zinc-400',
} as const

function Tally({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: keyof typeof tallyTones
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <dt className="text-xs tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd
        className={clsx(
          'mt-0.5 text-xl font-semibold tabular-nums',
          tallyTones[tone],
        )}
      >
        {value}
      </dd>
    </div>
  )
}
