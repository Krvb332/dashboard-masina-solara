import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { analyticsTotals } from '../lib/analytics-control'
import { formatNumber, NO_VALUE } from '../lib/format'
import { useDriverStore } from '../stores/driver-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Schimbarea pilotului, la un clic distanță din orice pagină.
 *
 * Stă în antet pentru că schimbul de pilot se face sub presiune de timp, iar
 * navigarea către o pagină dedicată ca să apeși un buton ar întârzia tăierea
 * contoarelor exact în minutul în care contează. Panoul complet, cu istoric,
 * rămâne în pagina „Piloți".
 */

export function DriverSwitcher() {
  const [open, setOpen] = useState(false)

  const profiles = useDriverStore((state) => state.profiles)
  const activeDriverId = useDriverStore((state) => state.activeDriverId)
  const stints = useDriverStore((state) => state.stints)
  const activeStintId = useDriverStore((state) => state.activeStintId)

  const vehicleId = useTelemetryStore((state) => state.vehicleId)
  const sessionId = useTelemetryStore((state) => state.sessionId)

  const active = profiles.find((profile) => profile.id === activeDriverId)
  const stint = stints.find((entry) => entry.id === activeStintId)

  const context = () => ({
    totals: analyticsTotals(),
    vehicleId,
    sessionId,
  })

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-11 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm text-zinc-200 hover:bg-white/10"
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold text-zinc-950"
          style={{ backgroundColor: active?.color ?? '#3f3f46' }}
          aria-hidden="true"
        >
          {active?.shortName ?? '—'}
        </span>
        <span className="hidden max-w-32 truncate sm:inline">
          {active?.name ?? 'Fără pilot'}
        </span>
      </button>

      {open && (
        <>
          {/* Închiderea la clic în afară, fără să prindem tastatura. */}
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default"
            aria-label="Închide selectorul de pilot"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-2xl shadow-black/50"
            role="menu"
          >
            <p className="px-2 py-1 text-xs tracking-wide text-zinc-500 uppercase">
              La volan
            </p>

            {profiles.length === 0 ? (
              <p className="px-2 py-2 text-sm text-zinc-500">
                Niciun pilot înregistrat încă.
              </p>
            ) : (
              <ul className="grid gap-1">
                {profiles.map((profile) => (
                  <li key={profile.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        useDriverStore
                          .getState()
                          .selectDriver(profile.id, context())
                        setOpen(false)
                      }}
                      className={clsx(
                        'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm',
                        profile.id === activeDriverId
                          ? 'bg-emerald-400/10 text-emerald-100'
                          : 'text-zinc-300 hover:bg-white/5',
                      )}
                    >
                      <span
                        className="grid size-6 shrink-0 place-items-center rounded text-[10px] font-semibold text-zinc-950"
                        style={{ backgroundColor: profile.color }}
                        aria-hidden="true"
                      >
                        {profile.shortName}
                      </span>
                      <span className="truncate">{profile.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {stint && (
              <p className="mt-2 border-t border-white/10 px-2 pt-2 text-xs text-zinc-500">
                Stint curent: {formatNumber(stint.summary.distanceKm, 2)} km ·{' '}
                {stint.summary.whPerKm === null
                  ? NO_VALUE
                  : `${formatNumber(stint.summary.whPerKm, 1)} Wh/km`}
              </p>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 px-2 pt-2">
              <Link
                to="/piloti"
                onClick={() => setOpen(false)}
                className="text-xs text-blue-300 hover:text-blue-200"
              >
                Gestionează piloții
              </Link>
              {activeStintId !== null && (
                <button
                  type="button"
                  onClick={() => {
                    useDriverStore.getState().endStint(context())
                    setOpen(false)
                  }}
                  className="rounded-lg bg-white/5 px-2 py-1 text-xs text-zinc-300 hover:bg-white/10"
                >
                  Coboară din mașină
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
