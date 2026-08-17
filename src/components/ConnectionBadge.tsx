import clsx from 'clsx'
import { Radio, RotateCw, TriangleAlert, WifiOff } from 'lucide-react'
import { useTick } from '../hooks/useTick'
import { formatAge, formatNumber } from '../lib/format'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Starea reală a legăturii cu mașina.
 *
 * Arată nu doar „conectat", ci și vechimea ultimului mesaj și câte mesaje s-au
 * pierdut. Un dashboard care spune „conectat" în timp ce datele au înghețat de
 * treizeci de secunde este mai periculos decât unul care nu spune nimic.
 */

const labels = {
  connecting: 'Se conectează',
  connected: 'Telemetrie conectată',
  reconnecting: 'Reconectare',
  disconnected: 'Deconectat',
} as const

const icons = {
  connecting: RotateCw,
  connected: Radio,
  reconnecting: RotateCw,
  disconnected: WifiOff,
} as const

/** Peste acest prag, legătura e „conectată" dar datele sunt vechi. */
const STALE_LINK_MS = 2000

export function ConnectionBadge({ compact = false }: { compact?: boolean }) {
  const connection = useTelemetryStore((state) => state.connection)
  const latest = useTelemetryStore((state) => state.latest)
  const stats = useTelemetryStore((state) => state.stats)
  const clockOffset = useTelemetryStore((state) => state.clientClockOffsetMs)
  const now = useTick(500)

  const lastMessageMs = latest
    ? new Date(latest.server_received_at).getTime()
    : null
  const ageMs =
    lastMessageMs === null
      ? null
      : Math.max(0, now - clockOffset - lastMessageMs)

  const stale = ageMs !== null && ageMs > STALE_LINK_MS
  const healthy = connection === 'connected' && !stale && lastMessageMs !== null
  const Icon =
    stale && connection === 'connected' ? TriangleAlert : icons[connection]

  const tone = healthy
    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
    : connection === 'disconnected'
      ? 'border-rose-400/25 bg-rose-400/10 text-rose-200'
      : 'border-amber-400/20 bg-amber-400/10 text-amber-100'

  return (
    <div
      className={clsx(
        'flex min-h-11 items-center gap-3 rounded-xl border px-4 text-sm',
        tone,
      )}
      role="status"
      data-connection={connection}
      data-stale={stale ? 'true' : 'false'}
    >
      {healthy ? (
        <span className="relative flex size-2.5" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
        </span>
      ) : (
        <Icon size={16} aria-hidden="true" />
      )}

      <span className="font-medium">
        {stale && connection === 'connected'
          ? 'Date învechite'
          : labels[connection]}
      </span>

      {!compact && (
        <span className="hidden text-xs text-current/70 sm:inline">
          {lastMessageMs === null
            ? 'niciun mesaj primit'
            : `ultimul mesaj acum ${formatAge(ageMs)}`}
          {stats.dropped > 0 ? ` · ${stats.dropped} pierdute` : ''}
          {stats.effective_hz > 0
            ? ` · ${formatNumber(stats.effective_hz, 1)} Hz`
            : ''}
        </span>
      )}
    </div>
  )
}
