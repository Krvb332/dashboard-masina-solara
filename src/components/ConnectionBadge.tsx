import clsx from 'clsx'
import { useFreshness } from '../hooks/use-telemetry'
import { formatAge } from '../lib/format'
import { useTelemetryStore } from '../stores/telemetry-store'

type Presentation = {
  label: string
  className: string
  dotClassName: string
  pulse: boolean
}

/**
 * Starea legăturii, combinând transportul cu vechimea datelor.
 *
 * Un socket deschis nu înseamnă date proaspete: dacă mașina tace, transportul
 * rămâne „conectat" dar operatorul trebuie să vadă imediat că valorile de pe
 * ecran sunt vechi. De aceea vechimea are prioritate față de starea socketului.
 */
function present(
  connection: string,
  isStale: boolean,
  isLost: boolean,
  isEmpty: boolean,
): Presentation {
  if (connection === 'connected' && isLost) {
    return {
      label: 'Fără date',
      className: 'border-red-400/30 bg-red-400/10 text-red-200',
      dotClassName: 'bg-red-400',
      pulse: false,
    }
  }
  if (connection === 'connected' && isStale) {
    return {
      label: 'Date învechite',
      className: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
      dotClassName: 'bg-amber-400',
      pulse: false,
    }
  }

  switch (connection) {
    case 'connected':
      return {
        label: isEmpty ? 'Se așteaptă date' : 'Telemetrie conectată',
        className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
        dotClassName: 'bg-emerald-400',
        pulse: !isEmpty,
      }
    case 'connecting':
      return {
        label: 'Se conectează',
        className: 'border-blue-400/25 bg-blue-400/10 text-blue-200',
        dotClassName: 'bg-blue-400',
        pulse: true,
      }
    case 'reconnecting':
      return {
        label: 'Reconectare',
        className: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
        dotClassName: 'bg-amber-400',
        pulse: true,
      }
    case 'error':
      return {
        label: 'Eroare de conexiune',
        className: 'border-red-400/30 bg-red-400/10 text-red-200',
        dotClassName: 'bg-red-400',
        pulse: false,
      }
    default:
      return {
        label: 'Deconectat',
        className: 'border-white/10 bg-white/5 text-zinc-300',
        dotClassName: 'bg-zinc-500',
        pulse: false,
      }
  }
}

export function ConnectionBadge() {
  const connection = useTelemetryStore((state) => state.connection)
  const { ageMs, isStale, isLost, isEmpty } = useFreshness()
  const { label, className, dotClassName, pulse } = present(
    connection,
    isStale,
    isLost,
    isEmpty,
  )

  return (
    <div
      className={clsx(
        'flex min-h-11 items-center gap-3 rounded-xl border px-4 text-sm',
        className,
      )}
      role="status"
    >
      <span className="relative flex size-2.5">
        {pulse && (
          <span
            className={clsx(
              'absolute inline-flex size-full animate-ping rounded-full opacity-50',
              dotClassName,
            )}
          />
        )}
        <span
          className={clsx(
            'relative inline-flex size-2.5 rounded-full',
            dotClassName,
          )}
        />
      </span>
      <span>{label}</span>
      {!isEmpty && (
        <span className="text-xs tabular-nums opacity-70">
          {formatAge(ageMs)}
        </span>
      )}
    </div>
  )
}
