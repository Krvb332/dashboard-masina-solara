import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { DriveStatePanel } from '../../components/DriveStatePanel'
import { FaultPanel } from '../../components/FaultPanel'
import { MetricRow } from '../../components/MetricCard'
import { Panel } from '../../components/Panel'
import { SignalMappingPanel } from '../../components/SignalMappingPanel'
import { SystemResetButton } from '../../components/SystemResetButton'
import { fetchHealth } from '../../lib/api'
import {
  formatAge,
  formatDateTime,
  formatDuration,
  formatNumber,
  NO_VALUE,
} from '../../lib/format'
import type { QualityState } from '../../schemas/telemetry'
import { useSignalsByGroup } from '../../hooks/useSignal'
import { useStreamStats } from '../../hooks/useStreamStats'
import { isFaultCodeSignal, isInDriveStatePanel } from '../../lib/signal-groups'
import { useTelemetryStore } from '../../stores/telemetry-store'

/**
 * Zona 3 (parțial) și diagnosticul lanțului de telemetrie.
 *
 * Aici se vede sănătatea fluxului, nu doar valorile: mesaje pierdute,
 * duplicate, ordine incorectă și decalajul de ceas dintre mașină și server -
 * exact ce cere punctul 9 din documentul de arhitectură.
 */
export function SystemPage() {
  const thermalSignals = useSignalsByGroup('thermal')
  // Starea de condus si codul de eroare au panouri proprii; ca randuri de text
  // ar fi numere fara inteles ("drive_action: 3,0").
  const motorSignals = useSignalsByGroup('motor').filter(
    (signal) =>
      !isInDriveStatePanel(signal.key) && !isFaultCodeSignal(signal.key),
  )
  const chassisSignals = useSignalsByGroup('chassis')
  const boardSignals = useSignalsByGroup('board')

  return (
    <>
      <section className="mt-7 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <StreamHealth />
        <ServiceHealth />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Temperaturi" subtitle="Praguri definite în catalog">
          <ul className="space-y-2">
            {thermalSignals.map((signal) => (
              <MetricRow key={signal.key} signalKey={signal.key} />
            ))}
          </ul>
        </Panel>

        <Panel title="Motor și invertor" subtitle="Stare mecanică">
          <ul className="space-y-2">
            {motorSignals.map((signal) => (
              <MetricRow key={signal.key} signalKey={signal.key} />
            ))}
          </ul>
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="Stare de condus"
          subtitle="Cadrele 0 și 1 ale controllerului Mitsuba"
        >
          <DriveStatePanel />
        </Panel>

        <Panel title="Erori controller" subtitle="Cadrul 2, descompus pe biți">
          <FaultPanel />
        </Panel>
      </section>

      {(chassisSignals.length > 0 || boardSignals.length > 0) && (
        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {chassisSignals.length > 0 && (
            <Panel
              title="Șasiu și anvelope"
              subtitle="Presiune și temperatură pe fiecare roată"
            >
              <ul className="grid gap-2 sm:grid-cols-2">
                {chassisSignals.map((signal) => (
                  <MetricRow key={signal.key} signalKey={signal.key} />
                ))}
              </ul>
            </Panel>
          )}

          {boardSignals.length > 0 && (
            <Panel
              title="Placa de achiziție"
              subtitle="Starea firmware-ului, nu a mașinii"
            >
              <ul className="grid gap-2 sm:grid-cols-2">
                {boardSignals.map((signal) => (
                  <MetricRow key={signal.key} signalKey={signal.key} />
                ))}
              </ul>
            </Panel>
          )}
        </section>
      )}

      <section className="mt-4">
        <Panel
          title="Verificarea mapării semnalelor"
          subtitle="Semnalele redundante trebuie să se confirme reciproc"
        >
          <SignalMappingPanel />
        </Panel>
      </section>

      <section className="mt-4">
        <QualityTable />
      </section>
    </>
  )
}

function StreamHealth() {
  const stats = useStreamStats()
  const invalidFrames = useTelemetryStore((state) => state.invalidFrames)
  const connection = useTelemetryStore((state) => state.connection)
  const clockOffset = useTelemetryStore((state) => state.clientClockOffsetMs)

  const rows: [string, string][] = [
    ['Stare conexiune', connection],
    ['Mesaje primite', formatNumber(stats.received, 0)],
    ['Mesaje pierdute', formatNumber(stats.dropped, 0)],
    ['Duplicate', formatNumber(stats.duplicates, 0)],
    ['Ordine incorectă', formatNumber(stats.out_of_order, 0)],
    ['Respinse la validare (server)', formatNumber(stats.invalid, 0)],
    ['Cadre invalide (browser)', formatNumber(invalidFrames, 0)],
    ['Frecvență efectivă', `${formatNumber(stats.effective_hz, 1)} Hz`],
    [
      'Ultima secvență',
      stats.last_sequence === null
        ? NO_VALUE
        : formatNumber(stats.last_sequence, 0),
    ],
    [
      'Decalaj ceas mașină → server',
      formatAge(Math.abs(stats.clock_offset_ms)),
    ],
    ['Decalaj ceas browser → server', formatAge(Math.abs(clockOffset))],
  ]

  return (
    <Panel
      title="Sănătatea fluxului"
      subtitle="Integritatea mesajelor primite"
      // Butonul stă lângă cifrele pe care le duce la zero, nu într-un colț al
      // paginii: aici se vede imediat ce anume s-a resetat.
      action={<SystemResetButton />}
    >
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 text-sm">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="font-medium text-zinc-200 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function ServiceHealth() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
  })

  return (
    <Panel title="Serviciu telemetrie" subtitle="Verificat la 5 secunde">
      {isError || !data ? (
        <p className="text-sm text-rose-300">
          Serviciul nu răspunde la /api/v1/health.
        </p>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Row
            label="Stare"
            value={data.status === 'ok' ? 'operațional' : 'degradat'}
          />
          <Row label="Versiune schemă" value={String(data.schema_version)} />
          <Row label="Uptime" value={formatDuration(data.uptime_s)} />
          <Row
            label="Ingest MQTT"
            value={data.ingest.mqtt ? 'conectat' : 'inactiv'}
          />
          <Row
            label="Ingest HTTP"
            value={data.ingest.http ? 'activ' : 'inactiv'}
          />
          <Row
            label="Ultimul mesaj"
            value={
              data.last_message_at
                ? formatDateTime(data.last_message_at)
                : NO_VALUE
            }
          />
          <Row
            label="Înregistrare"
            value={data.recording_session_id ?? 'oprită'}
          />
        </dl>
      )}
    </Panel>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate font-medium text-zinc-200">{value}</dd>
    </div>
  )
}

const qualityLabels: Record<QualityState, string> = {
  valid: 'valid',
  stale: 'învechit',
  unavailable: 'indisponibil',
  sensor_error: 'eroare senzor',
}

const qualityStyles: Record<QualityState, string> = {
  valid: 'bg-emerald-500/15 text-emerald-300',
  stale: 'bg-amber-500/15 text-amber-300',
  unavailable: 'bg-zinc-700/40 text-zinc-400',
  sensor_error: 'bg-rose-500/15 text-rose-300',
}

/** Starea fiecărui semnal din catalog - punctul 8 din documentul de arhitectură. */
function QualityTable() {
  const catalog = useTelemetryStore((state) => state.catalog)
  const quality = useTelemetryStore((state) => state.quality)

  return (
    <Panel
      title="Calitatea semnalelor"
      subtitle="Fiecare semnal are o stare, nu doar o valoare"
      bodyClassName="overflow-x-auto"
    >
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
            <th className="pb-2 font-medium">Semnal</th>
            <th className="pb-2 font-medium">Grup</th>
            <th className="pb-2 font-medium">Stare</th>
            <th className="pb-2 font-medium">Vechime</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {catalog.map((signal) => {
            const entry = quality[signal.key]
            const state = entry?.state ?? 'unavailable'

            return (
              <tr key={signal.key} className="border-t border-white/5">
                <td className="py-2">
                  <span className="font-medium text-zinc-200">
                    {signal.label}
                  </span>
                  <span className="ml-2 font-mono text-xs text-zinc-600">
                    {signal.key}
                  </span>
                </td>
                <td className="py-2 text-zinc-500">{signal.group}</td>
                <td className="py-2">
                  <span
                    className={clsx(
                      'rounded px-2 py-0.5 text-xs font-medium',
                      qualityStyles[state],
                    )}
                  >
                    {qualityLabels[state]}
                  </span>
                </td>
                <td className="py-2 tabular-nums">
                  {entry && state !== 'unavailable'
                    ? formatAge(entry.age_ms)
                    : NO_VALUE}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}
