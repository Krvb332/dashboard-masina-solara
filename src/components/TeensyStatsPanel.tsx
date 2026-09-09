import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Cpu, Gauge, Radio, Thermometer, Wifi, WifiOff } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useSignal } from '../hooks/useSignal'
import { useStreamStats } from '../hooks/useStreamStats'
import { useTick } from '../hooks/useTick'
import { fetchHealth } from '../lib/api'
import { formatAge, formatNumber, formatSignal, NO_VALUE } from '../lib/format'
import { summarizeSources } from '../lib/sensor-sources'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Starea plăcii de achiziție, nu a mașinii.
 *
 * Când cifrele de pe dashboard încep să arate ciudat, prima întrebare nu este
 * „ce face mașina", ci „mai trimite placa date, și de la câți senzori". Panoul
 * de față răspunde exact la asta: ritm de transfer, temperatura plăcii, câte
 * surse mai răspund și dacă legătura de rețea mai există.
 */

/**
 * Temperatura plăcii Teensy. Semnalul nu există încă în catalogul serverului —
 * urmează să fie adăugat în firmware. Până atunci cardul afișează „—", ceea ce
 * este corect: nu avem valoarea, deci nu inventăm una din alt senzor.
 */
const BOARD_TEMP_SIGNAL = 'teensy_temp_c'

/** Peste atât, „conectat" înseamnă de fapt „conectat, dar mut". */
const SILENT_LINK_MS = 3000

export function TeensyStatsPanel() {
  const stats = useStreamStats()
  const connection = useTelemetryStore((state) => state.connection)
  const quality = useTelemetryStore((state) => state.quality)
  const catalog = useTelemetryStore((state) => state.catalog)
  const latest = useTelemetryStore((state) => state.latest)
  const clockOffset = useTelemetryStore((state) => state.clientClockOffsetMs)
  const board = useSignal(BOARD_TEMP_SIGNAL)
  const now = useTick(1000)

  // Starea ingestiei de pe server (MQTT/HTTP) nu vine pe WebSocket, dar spune
  // dacă tăcerea e a mașinii sau a serverului.
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
    retry: false,
  })

  const summary = useMemo(
    () =>
      summarizeSources(
        catalog.map((signal) => signal.key),
        quality,
      ),
    [catalog, quality],
  )

  const lastMessageMs = latest
    ? new Date(latest.server_received_at).getTime()
    : null
  const ageMs =
    lastMessageMs === null
      ? null
      : Math.max(0, now - clockOffset - lastMessageMs)

  const silent = ageMs === null || ageMs > SILENT_LINK_MS
  const online = connection === 'connected' && !silent
  const transports = Object.entries(health?.ingest ?? {})
    .filter(([, up]) => up)
    .map(([name]) => name.toUpperCase())

  return (
    // Container query, nu breakpoint de ecran: panoul stă într-o coloană
    // îngustă pe desktop și lată pe telefon, deci contează lățimea LUI, nu a
    // ferestrei. Cu `sm:` cele două tile-uri ajungeau strivite exact pe
    // ecranul mare, unde era loc din belșug.
    <div className="@container grid gap-3">
      <div className="grid gap-2 @md:grid-cols-2">
        <Stat
          icon={Gauge}
          label="Viteză de transfer"
          value={
            stats.effective_hz > 0
              ? `${formatNumber(stats.effective_hz, 1)} Hz`
              : NO_VALUE
          }
          tone={stats.effective_hz > 0 ? 'ok' : 'muted'}
          detail={
            stats.received > 0
              ? `${formatNumber(stats.received, 0)} cadre${
                  stats.dropped > 0
                    ? ` · ${formatNumber(stats.dropped, 0)} pierdute`
                    : ''
                }`
              : 'niciun cadru primit'
          }
        />

        <Stat
          icon={Thermometer}
          label="Temperatură placă"
          value={
            board.fresh
              ? formatSignal(
                  board.value,
                  board.definition ?? { decimals: 1, unit: '°C' },
                )
              : NO_VALUE
          }
          tone={board.fresh ? 'ok' : 'muted'}
          detail={
            board.definition === undefined
              ? 'se așteaptă semnalul din firmware'
              : board.fresh
                ? 'senzor de pe placă'
                : `fără valoare proaspătă (${board.state})`
          }
        />

        <Stat
          icon={Cpu}
          label="Senzori conectați"
          value={
            summary.totalSources === 0
              ? NO_VALUE
              : `${summary.onlineSources}/${summary.totalSources}`
          }
          tone={
            summary.totalSources === 0
              ? 'muted'
              : summary.onlineSources === summary.totalSources
                ? 'ok'
                : summary.onlineSources === 0
                  ? 'bad'
                  : 'warn'
          }
          detail={
            summary.totalSources === 0
              ? 'catalogul nu s-a încărcat'
              : `${summary.freshSignals} din ${summary.totalSignals} semnale proaspete`
          }
        />

        <Stat
          icon={online ? Wifi : WifiOff}
          label="Rețea"
          value={online ? 'Conectată' : silent ? 'Fără date' : 'Deconectată'}
          tone={
            online
              ? 'ok'
              : silent && connection === 'connected'
                ? 'warn'
                : 'bad'
          }
          detail={
            lastMessageMs === null
              ? 'niciun mesaj primit'
              : `ultimul mesaj acum ${formatAge(ageMs)}${
                  transports.length > 0 ? ` · ${transports.join(' + ')}` : ''
                }`
          }
        />
      </div>

      {summary.totalSources > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Surse de date">
          {summary.sources.map((source) => (
            <li
              key={source.key}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
                source.online
                  ? 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200'
                  : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200',
              )}
              data-source={source.key}
              data-online={source.online ? 'true' : 'false'}
              title={`${source.fresh} din ${source.total} semnale proaspete`}
            >
              <Radio size={12} aria-hidden="true" />
              {source.label}
              <span className="text-current/60 tabular-nums">
                {source.fresh}/{source.total}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const tones = {
  ok: 'text-emerald-200',
  warn: 'text-amber-200',
  bad: 'text-rose-200',
  muted: 'text-zinc-500',
} as const

function Stat({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Gauge
  label: string
  value: ReactNode
  detail: string
  tone: keyof typeof tones
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      {/*
        Etichetă și valoare pe același rând: panoul stă într-o coloană îngustă,
        iar patru carduri „etichetă deasupra, cifră dedesubt" îl fac de două ori
        mai înalt decât graficul de lângă el.
      */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-xs tracking-wide text-zinc-500 uppercase">
          <Icon size={13} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </p>
        <p
          className={clsx(
            'shrink-0 text-lg font-semibold tabular-nums',
            tones[tone],
          )}
        >
          {value}
        </p>
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">{detail}</p>
    </div>
  )
}
