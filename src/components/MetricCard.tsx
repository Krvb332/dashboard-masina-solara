import clsx from 'clsx'
import {
  BatteryCharging,
  Bolt,
  CircleDot,
  Cpu,
  Gauge,
  MapPin,
  Sun,
  Thermometer,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { useSignal } from '../hooks/useSignal'
import { formatAge, formatSigned } from '../lib/format'
import { compressPackPowerW, isCompressedPowerSignal } from '../lib/power-scale'
import { telemetryBuffer } from '../lib/telemetry-buffer'
import { toneFor, type MetricTone } from '../lib/tone'
import type { SignalDefinition } from '../schemas/telemetry'
import { useTelemetryStore } from '../stores/telemetry-store'
import { SignalValue } from './SignalValue'

/**
 * Cardul unui indicator. Nu primește text formatat, ci cheia semnalului:
 * eticheta, unitatea, numărul de zecimale și pragurile vin din catalogul
 * serverului, deci un senzor nou apare aici fără modificări de cod.
 */

const toneClasses: Record<MetricTone, string> = {
  default: 'bg-blue-500/10 text-blue-300 ring-blue-400/20',
  success: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  warning: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
  danger: 'bg-rose-500/10 text-rose-300 ring-rose-400/20',
}

const groupIcons: Record<string, LucideIcon> = {
  status: Gauge,
  energy: Bolt,
  thermal: Thermometer,
  motor: Waves,
  gps: MapPin,
  chassis: CircleDot,
  board: Cpu,
}

const signalIcons: Record<string, LucideIcon> = {
  vehicle_speed_kph: Gauge,
  battery_soc_pct: BatteryCharging,
  solar_power_w: Sun,
  battery_temp_max_c: Thermometer,
}

/** Fereastra pe care se calculează tendința afișată sub valoare. */
const TREND_WINDOW_MS = 60_000

type MetricCardProps = {
  signalKey: string
  icon?: LucideIcon
  detail?: string
  className?: string
}

export function MetricCard({
  signalKey,
  icon,
  detail,
  className,
}: MetricCardProps) {
  const { definition, value, fresh, state, quality } = useSignal(signalKey)
  // Ne re-randăm odată cu cadrele, ca tendința citită din buffer să fie actuală.
  useTelemetryStore((store) => store.lastFrameAt)

  const tone = toneFor(definition, fresh ? value : null)
  const Icon =
    icon ??
    signalIcons[signalKey] ??
    (definition ? groupIcons[definition.group] : undefined) ??
    Gauge

  return (
    <article
      className={clsx(
        // `min-w-0` este obligatoriu: fără el, un element de grid nu coboară sub
        // lățimea conținutului, iar textele cu `truncate` (white-space: nowrap)
        // împing cardul în afara ecranului pe telefon.
        'min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm',
        state === 'sensor_error' && 'border-rose-400/30',
        className,
      )}
      // Ancora după care jurnalul de erori găsește cardul acestui semnal.
      data-signal={signalKey}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-[0.16em] text-zinc-400 uppercase">
            {definition?.label ?? signalKey}
          </p>
          <p className="mt-3">
            <SignalValue signalKey={signalKey} size="lg" />
          </p>
        </div>
        <span
          className={clsx(
            'grid size-11 shrink-0 place-items-center rounded-xl ring-1',
            toneClasses[tone],
          )}
          aria-hidden="true"
        >
          <Icon size={20} strokeWidth={1.8} />
        </span>
      </div>

      <p className="mt-4 truncate text-sm text-zinc-400">
        {detail ?? describe(signalKey, definition, fresh, quality?.age_ms)}
      </p>
    </article>
  )
}

function describe(
  signalKey: string,
  definition: SignalDefinition | undefined,
  fresh: boolean,
  ageMs: number | undefined,
): string {
  if (!fresh) {
    // Nu „fără date de la mașină": restul semnalelor pot curge în continuare.
    // Lipsește exact acest semnal, iar cardul spune asta.
    return ageMs === undefined || ageMs === 0
      ? 'Semnalul nu a fost primit de la mașină'
      : `Ultima valoare acum ${formatAge(ageMs)}`
  }

  // Tendința se calculează pe cifrele *afișate*, nu pe cele brute: pentru
  // puterea de pachet, un „+2 400 W în ultimul minut" sub o valoare comprimată
  // la 3,9 kW ar fi o diferență pe care cardul nu o arată nicăieri.
  const scale = isCompressedPowerSignal(signalKey)
    ? compressPackPowerW
    : (value: number | null) => value
  const previous = scale(telemetryBuffer.valueAgo(signalKey, TREND_WINDOW_MS))
  const current = scale(telemetryBuffer.latest(signalKey))

  if (previous === null || current === null) {
    return definition?.description || 'Recepție normală'
  }

  const delta = current - previous
  const decimals = definition?.decimals ?? 1
  if (Math.abs(delta) < 10 ** -decimals) {
    return 'Stabil în ultimul minut'
  }

  const unit = definition?.unit ? ` ${definition.unit}` : ''
  return `${formatSigned(delta, decimals)}${unit} în ultimul minut`
}

/** Variantă compactă, pentru listele dense din paginile de detaliu. */
export function MetricRow({ signalKey }: { signalKey: string }) {
  const { definition, value, fresh } = useSignal(signalKey)
  const tone = toneFor(definition, fresh ? value : null)

  return (
    <li
      className="flex min-h-11 min-w-0 items-center justify-between gap-4 rounded-xl bg-black/15 px-3 py-2"
      data-signal={signalKey}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-200">
          {definition?.label ?? signalKey}
        </p>
        {definition?.description ? (
          <p className="truncate text-xs text-zinc-500">
            {definition.description}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <SignalValue signalKey={signalKey} size="sm" />
        <span
          className={clsx(
            'size-2 shrink-0 rounded-full',
            tone === 'danger' && 'bg-rose-400',
            tone === 'warning' && 'bg-amber-400',
            tone === 'success' && 'bg-emerald-400',
            tone === 'default' && 'bg-zinc-600',
          )}
          aria-hidden="true"
        />
      </div>
    </li>
  )
}
