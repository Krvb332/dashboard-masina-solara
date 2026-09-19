import clsx from 'clsx'
import { LocateFixed, X } from 'lucide-react'
import { useMemo } from 'react'
import { useGoToErrorSource } from '../hooks/useErrorNavigation'
import { locateError } from '../lib/error-locator'
import { sortEntries, useErrorStore } from '../stores/error-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { severityIcons, severityLabels, severityStyles } from './error-tone'

/**
 * Notificările care apar când se ivește o eroare nouă.
 *
 * Nu dispar singure. Într-un pitlane nimeni nu se uită la ecran în secunda în
 * care apare problema, iar o notificare care se stinge după cinci secunde este
 * o notificare pe care n-a văzut-o nimeni. Se închid la cerere, iar închiderea
 * lor nu șterge nimic: eroarea rămâne în panoul lateral.
 *
 * Un click pe notificare duce la locul erorii pe interfață și o închide: cine
 * a dat click a văzut-o, iar notificarea ar acoperi altfel exact zona arătată.
 */

/** Câte se arată simultan. Restul se numără, ca să nu acoperim ecranul. */
const MAX_VISIBLE = 3

export function ErrorToasts() {
  const entries = useErrorStore((state) => state.entries)
  const dismiss = useErrorStore((state) => state.dismiss)
  const dismissAll = useErrorStore((state) => state.dismissAll)
  const setPanelOpen = useErrorStore((state) => state.setPanelOpen)
  const panelOpen = useErrorStore((state) => state.panelOpen)
  const catalogByKey = useTelemetryStore((state) => state.catalogByKey)
  const goToSource = useGoToErrorSource()

  const pending = useMemo(
    () =>
      sortEntries(entries.filter((entry) => entry.active && !entry.dismissed)),
    [entries],
  )

  // Cu panoul deschis, erorile sunt deja pe ecran în întregime.
  if (panelOpen || pending.length === 0) return null

  const visible = pending.slice(0, MAX_VISIBLE)
  const hidden = pending.length - visible.length

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
      role="region"
      aria-label="Notificări de eroare"
    >
      {visible.map((entry) => {
        const Icon = severityIcons[entry.severity]
        const locatable = locateError(entry, catalogByKey) !== null
        const badge = (
          <span className="ml-2 rounded bg-black/25 px-1.5 py-0.5 text-[11px] font-normal tracking-wide uppercase">
            {severityLabels[entry.severity]}
          </span>
        )

        return (
          <div
            key={entry.id}
            role="alert"
            data-severity={entry.severity}
            data-testid="error-toast"
            className={clsx(
              'pointer-events-auto relative flex w-full items-start gap-3 rounded-xl border p-3 shadow-2xl shadow-black/50 backdrop-blur-md',
              severityStyles[entry.severity],
              locatable && 'hover:ring-1 hover:ring-white/20',
            )}
          >
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />

            <div className="min-w-0 flex-1">
              {locatable ? (
                // Întins peste toată notificarea prin `after:`; linkul și
                // butonul de închidere stau deasupra (`relative`).
                <button
                  type="button"
                  onClick={() => {
                    dismiss(entry.id)
                    goToSource(entry)
                  }}
                  className="block w-full text-left text-sm font-medium after:absolute after:inset-0 after:rounded-xl after:content-['']"
                  title="Arată pe interfață de unde vine eroarea"
                  data-testid="error-toast-locate"
                >
                  {entry.title}
                  <LocateFixed
                    size={13}
                    className="ml-1.5 inline-block align-[-2px] text-current/60"
                    aria-hidden="true"
                  />
                  {badge}
                  <span className="sr-only"> — arată sursa pe interfață</span>
                </button>
              ) : (
                <p className="text-sm font-medium">
                  {entry.title}
                  {badge}
                </p>
              )}
              <p className="mt-1 text-xs leading-5 text-current/70">
                {entry.message}
              </p>
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="relative mt-2 text-xs font-medium text-current/80 underline underline-offset-2 hover:text-current"
              >
                Vezi toate erorile
              </button>
            </div>

            <button
              type="button"
              onClick={() => dismiss(entry.id)}
              className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-black/20 transition-colors hover:bg-black/35"
              aria-label={`Închide notificarea: ${entry.title}`}
              title="Închide"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        )
      })}

      {hidden > 0 && (
        <button
          type="button"
          onClick={dismissAll}
          className="pointer-events-auto rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-1.5 text-xs text-zinc-400 shadow-lg transition-colors hover:text-white"
        >
          încă {hidden} — închide toate
        </button>
      )}
    </div>
  )
}
