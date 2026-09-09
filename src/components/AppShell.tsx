import clsx from 'clsx'
import {
  Bolt,
  Circle,
  LayoutDashboard,
  Map,
  Menu,
  Radio,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useErrorLog } from '../hooks/useErrorLog'
import { useTelemetryStream } from '../hooks/useTelemetryStream'
import { API_URL } from '../lib/api'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { ConnectionBadge } from './ConnectionBadge'
import { ErrorPanel, ErrorPanelToggle } from './ErrorPanel'
import { ErrorToasts } from './ErrorToasts'
import { ReplayControls } from './ReplayControls'

/**
 * Cadrul aplicației: navigație, starea legăturii și conexiunea live.
 *
 * Fluxul de telemetrie se montează o singură dată, aici, ca schimbarea paginii
 * să nu închidă și să redeschidă WebSocketul.
 */

const navigation = [
  { to: '/', label: 'Prezentare', icon: LayoutDashboard, end: true },
  { to: '/energie', label: 'Energie', icon: Bolt },
  { to: '/traseu', label: 'Traseu', icon: Map },
  { to: '/sistem', label: 'Sistem', icon: Settings },
  { to: '/sesiuni', label: 'Sesiuni', icon: Circle },
]

export function AppShell() {
  useTelemetryStream()
  useErrorLog()

  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const mode = useSessionStore((state) => state.mode)
  const vehicleId = useTelemetryStore((state) => state.vehicleId)
  const recordingSessionId = useTelemetryStore(
    (state) => state.recordingSessionId,
  )

  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      {menuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          aria-label="Închide meniul"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-white/10 bg-zinc-950 px-4 py-6 transition-transform lg:static lg:w-auto lg:translate-x-0 lg:bg-black/20',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex min-h-11 items-center gap-3 px-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-950">
            <Sun size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">
              TUCN Racing Team
            </p>
            <p className="truncate text-xs text-zinc-500">Pitlane telemetry</p>
          </div>
          <button
            type="button"
            className="ml-auto grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Închide meniul"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="mt-9" aria-label="Navigație principală">
          <ul className="space-y-2">
            {navigation.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    clsx(
                      'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-blue-500/15 text-blue-200'
                        : 'text-zinc-400 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto rounded-xl border border-white/10 bg-white/[0.035] p-3">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Radio size={16} className="text-emerald-400" aria-hidden="true" />
            Serviciu telemetrie
          </div>
          <p className="mt-2 truncate text-xs text-zinc-500" title={API_URL}>
            {API_URL.replace(/^https?:\/\//, '')}
          </p>
          {recordingSessionId && (
            <p className="mt-2 flex items-center gap-2 text-xs text-rose-300">
              <span className="size-2 animate-pulse rounded-full bg-rose-500" />
              Înregistrare activă
            </p>
          )}
        </div>
      </aside>

      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-300 lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Deschide meniul"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-blue-300 uppercase">
                {mode === 'replay' ? 'Sesiune înregistrată' : 'Sesiune live'}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {vehicleId ?? 'Mașina solară'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {mode === 'live' ? <ConnectionBadge /> : <ReplayBadge />}
            <ErrorPanelToggle />
          </div>
        </header>

        {mode === 'replay' && <ReplayControls />}

        <Outlet />
      </main>

      <ErrorPanel />
      <ErrorToasts />
    </div>
  )
}

function ReplayBadge() {
  return (
    <div
      className="flex min-h-11 items-center gap-3 rounded-xl border border-violet-400/25 bg-violet-400/10 px-4 text-sm font-medium text-violet-100"
      role="status"
    >
      <span
        className="size-2.5 rounded-full bg-violet-400"
        aria-hidden="true"
      />
      REDARE ÎNREGISTRARE — nu sunt date live
    </div>
  )
}
