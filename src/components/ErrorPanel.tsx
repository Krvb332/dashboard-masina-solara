import clsx from 'clsx'
import { BellRing, Check, CheckCircle2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { ackAlarm } from '../lib/api'
import { formatClock } from '../lib/format'
import {
  sortEntries,
  useErrorStore,
  type ErrorEntry,
} from '../stores/error-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import {
  severityIcons,
  severityLabels,
  severityStyles,
  sourceIcons,
  sourceLabels,
} from './error-tone'

/**
 * Panoul lateral cu toate erorile, active și rezolvate.
 *
 * Stă peste conținut, nu în fluxul paginii: se deschide oriunde te-ai afla,
 * fără să rearanjeze dashboardul sub ochii cuiva care tocmai citea o valoare.
 */

export function ErrorPanel() {
  const open = useErrorStore((state) => state.panelOpen)
  const setPanelOpen = useErrorStore((state) => state.setPanelOpen)
  const markAllSeen = useErrorStore((state) => state.markAllSeen)
  const clearResolved = useErrorStore((state) => state.clearResolved)
  const entries = useErrorStore((state) => state.entries)
  const closeButton = useRef<HTMLButtonElement>(null)

  const sorted = useMemo(() => sortEntries(entries), [entries])
  const active = sorted.filter((entry) => entry.active)
  const resolved = sorted.filter((entry) => !entry.active)

  // Deschiderea panoului înseamnă „le-am văzut": insigna de „noi" se stinge.
  useEffect(() => {
    if (open) {
      markAllSeen()
      closeButton.current?.focus()
    }
  }, [open, markAllSeen])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setPanelOpen])

  return (
    <>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50"
          aria-label="Închide panoul de erori"
          onClick={() => setPanelOpen(false)}
        />
      )}

      <aside
        id="error-panel"
        className={clsx(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/10 bg-zinc-950 shadow-2xl shadow-black/60 transition-transform',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        // `inert` scoate panoul închis din ordinea de tabulare; altfel Tab ar
        // pleca într-un panou pe care nimeni nu-l vede.
        inert={!open}
        aria-label="Jurnal de erori"
      >
        <header className="flex items-start gap-3 border-b border-white/10 px-4 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-white">Erori</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {active.length === 0
                ? 'Nimic activ în acest moment'
                : `${active.length} ${active.length === 1 ? 'eroare activă' : 'erori active'}`}
              {resolved.length > 0 &&
                ` · ${resolved.length} ${resolved.length === 1 ? 'rezolvată' : 'rezolvate'}`}
            </p>
          </div>

          <button
            ref={closeButton}
            type="button"
            onClick={() => setPanelOpen(false)}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Închide panoul de erori"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {sorted.length === 0 ? (
            <p className="flex items-center gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-3 text-sm text-emerald-100">
              <CheckCircle2 size={18} className="shrink-0" aria-hidden="true" />
              Nicio eroare înregistrată în această sesiune.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="error-list">
              {sorted.map((entry) => (
                <ErrorRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </div>

        {resolved.length > 0 && (
          <footer className="border-t border-white/10 px-4 py-3">
            <button
              type="button"
              onClick={clearResolved}
              className="flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Trash2 size={15} aria-hidden="true" />
              {resolved.length === 1
                ? 'Șterge eroarea rezolvată'
                : `Șterge cele ${resolved.length} rezolvate`}
            </button>
          </footer>
        )}
      </aside>
    </>
  )
}

function ErrorRow({ entry }: { entry: ErrorEntry }) {
  const SeverityIcon = severityIcons[entry.severity]
  const SourceIcon = sourceIcons[entry.source]

  // Alarmele serverului se pot confirma („am văzut"), iar confirmarea intră în
  // istoricul sesiunii. Restul surselor n-au ce confirma: dispar când se rezolvă.
  const alarmId =
    entry.source === 'alarm' ? entry.id.slice('alarm:'.length) : null
  const acknowledged = useTelemetryStore((state) =>
    alarmId === null ? false : state.acknowledged.includes(alarmId),
  )
  const acknowledgeAlarm = useTelemetryStore((state) => state.acknowledgeAlarm)

  const handleAck = () => {
    if (alarmId === null) return
    acknowledgeAlarm(alarmId)
    // Eșecul cererii nu trebuie să blocheze interfața: alarma rămâne oricum
    // vizibilă, iar confirmarea locală s-a aplicat deja.
    void ackAlarm(alarmId).catch(() => undefined)
  }

  return (
    <li
      className={clsx(
        'rounded-xl border p-3',
        entry.active
          ? severityStyles[entry.severity]
          : 'border-white/10 bg-white/[0.02] text-zinc-400',
        entry.active && acknowledged && 'opacity-55',
      )}
      data-severity={entry.severity}
      data-source={entry.source}
      data-active={entry.active ? 'true' : 'false'}
    >
      <div className="flex items-start gap-3">
        <SeverityIcon
          size={18}
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{entry.title}</p>
          <p className="mt-1 text-xs leading-5 text-current/70">
            {entry.message}
          </p>

          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-current/50">
            <span className="inline-flex items-center gap-1">
              <SourceIcon size={12} aria-hidden="true" />
              {sourceLabels[entry.source]}
            </span>
            <span aria-hidden="true">·</span>
            <span>{severityLabels[entry.severity]}</span>
            <span aria-hidden="true">·</span>
            <span>de la {formatClock(entry.firstAt)}</span>
            {entry.occurrences > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span>de {entry.occurrences} ori</span>
              </>
            )}
          </p>
        </div>

        {!entry.active ? (
          <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-zinc-400">
            rezolvată {formatClock(entry.lastAt)}
          </span>
        ) : (
          alarmId !== null &&
          !acknowledged && (
            <button
              type="button"
              onClick={handleAck}
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-black/20 transition-colors hover:bg-black/35"
              aria-label={`Confirmă alarma ${entry.title}`}
              title="Confirmă"
            >
              <Check size={15} aria-hidden="true" />
            </button>
          )
        )}
      </div>
    </li>
  )
}

/** Butonul care deschide panoul, cu numărul de erori active. */
export function ErrorPanelToggle() {
  const entries = useErrorStore((state) => state.entries)
  const open = useErrorStore((state) => state.panelOpen)
  const togglePanel = useErrorStore((state) => state.togglePanel)

  const activeCount = entries.filter((entry) => entry.active).length
  const unseen = entries.some((entry) => entry.active && !entry.seen)
  const critical = entries.some(
    (entry) => entry.active && entry.severity === 'critical',
  )

  return (
    <button
      type="button"
      onClick={togglePanel}
      aria-expanded={open}
      aria-controls="error-panel"
      aria-label={
        activeCount === 0
          ? 'Deschide jurnalul de erori (nicio eroare activă)'
          : `Deschide jurnalul de erori (${activeCount} active)`
      }
      data-testid="error-panel-toggle"
      className={clsx(
        'relative flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors',
        activeCount === 0
          ? 'border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white'
          : critical
            ? 'border-rose-400/25 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15'
            : 'border-amber-400/20 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15',
      )}
    >
      <BellRing size={17} aria-hidden="true" />
      <span>Erori</span>
      {activeCount > 0 && (
        <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-xs tabular-nums">
          {activeCount}
        </span>
      )}
      {unseen && (
        <span
          className="absolute -top-1 -right-1 size-2.5 animate-pulse rounded-full bg-rose-500"
          aria-hidden="true"
        />
      )}
    </button>
  )
}
