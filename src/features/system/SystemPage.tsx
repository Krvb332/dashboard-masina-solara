import { AlarmPanel } from '../../components/AlarmPanel'
import { Panel } from '../../components/Panel'
import { SignalTable } from '../../components/SignalTable'
import { env } from '../../config/env'
import { useAlarms, useFreshness } from '../../hooks/use-telemetry'
import { formatAge, formatClock, formatNumber, NO_DATA } from '../../lib/format'
import { useTelemetryStore } from '../../stores/telemetry-store'

export function SystemPage() {
  const alarms = useAlarms()

  return (
    <>
      <section className="mt-7 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.6fr)]">
        <Panel
          title="Diagnostic legătură"
          subtitle="Calitatea fluxului de telemetrie"
        >
          <LinkDiagnostics />
        </Panel>

        <Panel
          title="Alarme active"
          subtitle="Praguri locale și alarme de la server"
        >
          <AlarmPanel alarms={alarms} />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Toate semnalele"
          subtitle="Valoarea curentă și calitatea raportată pentru fiecare semnal"
        >
          <SignalTable />
        </Panel>
      </section>
    </>
  )
}

function LinkDiagnostics() {
  const stats = useTelemetryStore((state) => state.stats)
  const meta = useTelemetryStore((state) => state.meta)
  const connection = useTelemetryStore((state) => state.connection)
  const connectionDetail = useTelemetryStore((state) => state.connectionDetail)
  const sourceKind = useTelemetryStore((state) => state.sourceKind)
  const sourceLabel = useTelemetryStore((state) => state.sourceLabel)
  const { ageMs, isEmpty } = useFreshness()

  const lossRate =
    stats.received + stats.gaps > 0
      ? (stats.gaps / (stats.received + stats.gaps)) * 100
      : 0

  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Sursă" value={sourceKind === 'simulator' ? 'Simulator' : 'Server'} hint={sourceLabel} />
        <Stat label="Transport" value={connection} hint={connectionDetail} />
        <Stat
          label="Vechime ultim mesaj"
          value={isEmpty ? NO_DATA : formatAge(ageMs)}
        />
        <Stat
          label="Rată recepție"
          value={`${formatNumber(stats.rateHz, 0)} Hz`}
          hint={`interfața se actualizează la ${env.uiRefreshHz} Hz`}
        />
        <Stat label="Mesaje primite" value={formatNumber(stats.received, 0)} />
        <Stat
          label="Mesaje lipsă"
          value={formatNumber(stats.gaps, 0)}
          hint={`${formatNumber(lossRate, 2)}% pierdere`}
          tone={stats.gaps > 0 ? 'warning' : 'default'}
        />
        <Stat
          label="Ordine greșită"
          value={formatNumber(stats.outOfOrder, 0)}
          tone={stats.outOfOrder > 0 ? 'warning' : 'default'}
        />
        <Stat
          label="Mesaje invalide"
          value={formatNumber(stats.invalid, 0)}
          hint={stats.lastInvalidReason ?? undefined}
          tone={stats.invalid > 0 ? 'danger' : 'default'}
        />
        <Stat
          label="Decalaj ceas"
          value={
            stats.clockSkewMs === null
              ? NO_DATA
              : `${formatNumber(stats.clockSkewMs, 0)} ms`
          }
          hint="mașină față de browser"
          tone={
            stats.clockSkewMs !== null && Math.abs(stats.clockSkewMs) > 1_000
              ? 'warning'
              : 'default'
          }
        />
      </dl>

      {meta && (
        <div className="mt-5 rounded-xl bg-black/20 p-4 font-mono text-xs text-zinc-400">
          <p>
            <span className="text-zinc-600">vehicle_id</span> {meta.vehicleId}
          </p>
          <p className="mt-1.5">
            <span className="text-zinc-600">session_id</span> {meta.sessionId}
          </p>
          <p className="mt-1.5">
            <span className="text-zinc-600">sequence</span> {meta.sequence}
          </p>
          <p className="mt-1.5">
            <span className="text-zinc-600">timestamp</span>{' '}
            {formatClock(meta.vehicleTime)}
          </p>
        </div>
      )}
    </>
  )
}

const toneClasses = {
  default: 'text-white',
  warning: 'text-amber-300',
  danger: 'text-red-300',
}

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: keyof typeof toneClasses
}) {
  return (
    <div className="rounded-xl bg-black/15 p-3">
      <dt className="text-xs tracking-wider text-zinc-500 uppercase">{label}</dt>
      <dd
        className={`mt-1.5 text-lg font-semibold tabular-nums ${toneClasses[tone]}`}
      >
        {value}
      </dd>
      {hint && <p className="mt-1 truncate text-xs text-zinc-600">{hint}</p>}
    </div>
  )
}
