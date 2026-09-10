import clsx from 'clsx'
import { Check, Pencil, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { analyticsTotals } from '../lib/analytics-control'
import { formatDuration, formatNumber, NO_VALUE } from '../lib/format'
import { useDriverStore } from '../stores/driver-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Gestionarea piloților: creare, schimbare la volan, istoricul fiecăruia.
 *
 * Momentul care contează este apăsarea pe „la volan": ea taie contoarele exact
 * acolo. De aceea butonul este mare, vizibil și nu cere confirmare — o
 * confirmare în plus la schimbul de pilot ar întârzia tăietura cu secundele în
 * care mașina chiar merge.
 *
 * Ștergerea unui profil, în schimb, cere confirmare, fiindcă nu se poate anula.
 */

export function DriverPanel() {
  const profiles = useDriverStore((state) => state.profiles)
  const stints = useDriverStore((state) => state.stints)
  const activeDriverId = useDriverStore((state) => state.activeDriverId)
  const autoCreate = useDriverStore((state) => state.autoCreate)

  const vehicleId = useTelemetryStore((state) => state.vehicleId)
  const sessionId = useTelemetryStore((state) => state.sessionId)

  const [name, setName] = useState('')
  const [roster, setRoster] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const context = () => ({
    totals: analyticsTotals(),
    vehicleId,
    sessionId,
  })

  const store = useDriverStore.getState

  return (
    <div className="grid gap-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          store().createProfile(name)
          setName('')
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nume pilot"
          aria-label="Nume pilot nou"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white placeholder:text-zinc-600"
        />
        <button
          type="submit"
          className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          disabled={!name.trim()}
        >
          <UserPlus size={16} aria-hidden="true" />
          Adaugă pilot
        </button>
      </form>

      <details className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <Users size={15} aria-hidden="true" />
          Creează profiluri pentru tot lotul
        </summary>
        <p className="mt-2 text-xs text-zinc-500">
          Un nume pe linie sau separate prin virgulă. Numele deja existente sunt
          sărite, deci lista se poate lipi din nou fără să dubleze piloții.
        </p>
        <textarea
          value={roster}
          onChange={(event) => setRoster(event.target.value)}
          rows={4}
          aria-label="Lista de piloți"
          placeholder={'Andrei Pop\nMaria Ionescu\nVlad Dumitru'}
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
        />
        <button
          type="button"
          onClick={() => {
            const names = roster
              .split(/[\n,;]+/)
              .map((entry) => entry.trim())
              .filter(Boolean)
            if (names.length === 0) return
            store().importRoster(names)
            setRoster('')
          }}
          className="mt-2 min-h-10 rounded-xl bg-white/10 px-4 text-sm text-zinc-100 hover:bg-white/15"
        >
          Creează profilurile
        </button>
      </details>

      <label className="flex items-center gap-3 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={autoCreate}
          onChange={(event) => store().setAutoCreate(event.target.checked)}
          className="size-4 accent-blue-500"
        />
        Creează automat un pilot când încep să curgă date
      </label>

      {profiles.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Niciun pilot înregistrat. Se creează unul automat la primul flux de
          date, iar apoi îl poți redenumi.
        </p>
      ) : (
        <ul className="grid gap-2" aria-label="Piloți">
          {profiles.map((profile) => {
            const aggregate = store().aggregate(profile.id)
            const active = profile.id === activeDriverId

            return (
              <li
                key={profile.id}
                className={clsx(
                  'rounded-xl border px-3 py-2.5',
                  active
                    ? 'border-emerald-400/30 bg-emerald-400/[0.06]'
                    : 'border-white/10 bg-white/[0.02]',
                )}
                data-driver={profile.id}
                data-active={active ? 'true' : 'false'}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold text-zinc-950"
                    style={{ backgroundColor: profile.color }}
                    aria-hidden="true"
                  >
                    {profile.shortName}
                  </span>

                  {editing === profile.id ? (
                    <>
                      <input
                        type="text"
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        aria-label={`Redenumește ${profile.name}`}
                        className="min-h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white"
                        autoFocus
                      />
                      <button
                        type="button"
                        aria-label="Salvează numele"
                        onClick={() => {
                          store().renameProfile(profile.id, editValue)
                          setEditing(null)
                        }}
                        className="grid size-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-200"
                      >
                        <Check size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Renunță"
                        onClick={() => setEditing(null)}
                        className="grid size-9 place-items-center rounded-lg bg-white/5 text-zinc-400"
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {profile.name}
                          {profile.auto && (
                            <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] tracking-wide text-zinc-400 uppercase">
                              automat
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-zinc-500">
                          {aggregate.stints === 0
                            ? 'Niciun stint încheiat'
                            : `${aggregate.stints} stinturi · ${formatNumber(aggregate.distanceKm, 1)} km · ${
                                aggregate.whPerKm === null
                                  ? NO_VALUE
                                  : `${formatNumber(aggregate.whPerKm, 1)} Wh/km`
                              }`}
                        </p>
                      </div>

                      {active ? (
                        <button
                          type="button"
                          onClick={() => store().endStint(context())}
                          className="min-h-9 rounded-lg bg-white/10 px-3 text-xs text-zinc-200 hover:bg-white/15"
                        >
                          Coboară
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            store().selectDriver(profile.id, context())
                          }
                          className="min-h-9 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-500"
                        >
                          La volan
                        </button>
                      )}

                      <button
                        type="button"
                        aria-label={`Redenumește ${profile.name}`}
                        onClick={() => {
                          setEditing(profile.id)
                          setEditValue(profile.name)
                        }}
                        className="grid size-9 place-items-center rounded-lg bg-white/5 text-zinc-400 hover:text-zinc-100"
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>

                      {confirmDelete === profile.id ? (
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              store().removeProfile(profile.id)
                              setConfirmDelete(null)
                            }}
                            className="min-h-9 rounded-lg bg-rose-600 px-3 text-xs font-medium text-white"
                          >
                            Șterge
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className="min-h-9 rounded-lg bg-white/5 px-3 text-xs text-zinc-300"
                          >
                            Nu
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Șterge ${profile.name}`}
                          onClick={() => setConfirmDelete(profile.id)}
                          className="grid size-9 place-items-center rounded-lg bg-white/5 text-zinc-500 hover:text-rose-300"
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-xs text-zinc-500">
        Ștergerea unui profil nu șterge stinturile lui: energia măsurată rămâne
        în istoricul sesiunii, fiindcă este o măsurătoare, nu o proprietate a
        numelui.
      </p>

      {stints.length > 0 && <StintTable />}
    </div>
  )
}

/** Istoricul stinturilor, cel mai recent primul. */
function StintTable() {
  const stints = useDriverStore((state) => state.stints)
  const activeStintId = useDriverStore((state) => state.activeStintId)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Stinturile înregistrate</caption>
        <thead>
          <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
            <th className="pb-2 font-medium">Pilot</th>
            <th className="pb-2 font-medium">Durată</th>
            <th className="pb-2 font-medium">Distanță</th>
            <th className="pb-2 font-medium">Energie</th>
            <th className="pb-2 font-medium">Consum</th>
            <th className="pb-2 font-medium">Viteză medie</th>
            <th className="pb-2 font-medium">Manevre bruște</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {[...stints].reverse().map((stint) => (
            <tr key={stint.id} className="border-t border-white/5">
              <td className="py-2 font-medium text-white">
                {stint.driverName}
                {stint.id === activeStintId && (
                  <span className="ml-2 text-xs text-emerald-300">activ</span>
                )}
              </td>
              <td className="py-2 tabular-nums">
                {formatDuration(stint.summary.durationS)}
              </td>
              <td className="py-2 tabular-nums">
                {formatNumber(stint.summary.distanceKm, 2)} km
              </td>
              <td className="py-2 tabular-nums">
                {formatNumber(stint.summary.energyConsumedWh, 0)} Wh
              </td>
              <td className="py-2 tabular-nums">
                {stint.summary.whPerKm === null
                  ? NO_VALUE
                  : `${formatNumber(stint.summary.whPerKm, 1)} Wh/km`}
              </td>
              <td className="py-2 tabular-nums">
                {stint.summary.averageSpeedKph === null
                  ? NO_VALUE
                  : `${formatNumber(stint.summary.averageSpeedKph, 1)} km/h`}
              </td>
              <td className="py-2 tabular-nums">
                {stint.summary.harshAccelCount + stint.summary.harshBrakeCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
