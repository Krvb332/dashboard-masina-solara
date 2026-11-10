import clsx from 'clsx'
import {
  Bolt,
  ChartLine,
  Check,
  CloudSun,
  History,
  LayoutDashboard,
  LayoutGrid,
  Map,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { watchDriverStateFlush } from '../lib/driver-storage'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAnalyticsEngine } from '../hooks/useAnalyticsEngine'
import { useErrorLog } from '../hooks/useErrorLog'
import { useErrorFocus } from '../hooks/useErrorNavigation'
import { useTelemetryStream } from '../hooks/useTelemetryStream'
import { useWeather } from '../hooks/useWeather'
import { API_URL } from '../lib/api'
import { safeStorage } from '../lib/safe-storage'
import { useLayoutEdit } from '../stores/layout-store'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { ConnectionBadge } from './ConnectionBadge'
import { DriverSwitcher } from './DriverSwitcher'
import { ErrorPanel, ErrorPanelToggle } from './ErrorPanel'
import { ErrorToasts } from './ErrorToasts'
import { RecordingButton } from './RecordingButton'
import { ReplayControls } from './ReplayControls'

/**
 * Cadrul aplicației: navigație, starea legăturii și conexiunea live.
 *
 * Fluxul de telemetrie se montează o singură dată, aici, ca schimbarea paginii
 * să nu închidă și să redeschidă WebSocketul.
 */

// Grupate după întrebarea la care răspund: ce face mașina acum, cum a mers
// până acum, și în ce stare sunt mașina și datele.
const navigation = [
  {
    group: 'Cursă',
    items: [
      { to: '/', label: 'Prezentare', icon: LayoutDashboard, end: true },
      { to: '/traseu', label: 'Traseu', icon: Map },
      { to: '/vreme', label: 'Vreme', icon: CloudSun },
      { to: '/piloti', label: 'Piloți', icon: Users },
    ],
  },
  {
    group: 'Analiză',
    items: [
      { to: '/statistici', label: 'Statistici', icon: ChartLine },
      { to: '/energie', label: 'Energie', icon: Bolt },
    ],
  },
  {
    group: 'Mașină și date',
    items: [
      { to: '/sistem', label: 'Sistem', icon: Settings },
      { to: '/sesiuni', label: 'Sesiuni', icon: History },
    ],
  },
]

const SIDEBAR_KEY = 'tucn:sidebar-open'
/**
 * Bara laterală rămâne deschisă între reîncărcări dacă nu a fost închisă
 * explicit: pe un laptop din pitlane meniul vizibil este starea utilă.
 */
function readSidebarPreference(): boolean {
  return safeStorage().getItem(SIDEBAR_KEY) !== 'closed'
}

export function AppShell() {
  useTelemetryStream()
  useAnalyticsEngine()
  useWeather()
  useErrorLog()
  useErrorFocus()

  // Două stări separate: sertarul peste conținut (mobil) și coloana fixă
  // (desktop), care se strânge la o bandă de pictograme în loc să dispară.
  // Aceeași stare pentru amândouă ar redeschide sertarul mobil doar pentru că
  // bara era deschisă pe ecran mare.
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarPreference)
  const location = useLocation()
  const mode = useSessionStore((state) => state.mode)
  const recordingSessionId = useTelemetryStore(
    (state) => state.recordingSessionId,
  )

  // Ce nu a apucat să plece spre server (schimbarea de pilot se trimite cu o
  // întârziere de câteva secunde, ca să nu inundăm rețeaua) pleacă acum, când
  // fila se ascunde sau se închide.
  useEffect(() => watchDriverStateFlush(), [])

  useEffect(() => setMenuOpen(false), [location.pathname])

  useEffect(() => {
    safeStorage().setItem(SIDEBAR_KEY, sidebarOpen ? 'open' : 'closed')
  }, [sidebarOpen])

  const editing = useLayoutEdit((state) => state.editing)
  const hasGrid = useLayoutEdit((state) => state.grids > 0)
  const toggleEditing = useLayoutEdit((state) => state.toggle)
  const pageLabel = navigation
    .flatMap((section) => section.items)
    .find((item) => item.to === location.pathname)?.label

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  // Pe ecran mare, bara strânsă arată doar pictogramele.
  const railOnly = !sidebarOpen && 'lg:hidden'

  return (
    <div
      className={clsx(
        'min-h-screen lg:grid',
        sidebarOpen
          ? 'lg:grid-cols-[232px_minmax(0,1fr)]'
          : 'lg:grid-cols-[72px_minmax(0,1fr)]',
      )}
    >
      {menuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          aria-label="Închide meniul"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        id="navigatie-laterala"
        className={clsx(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col overflow-y-auto border-r border-white/10 bg-zinc-950 px-4 py-5 transition-transform lg:sticky lg:top-0 lg:h-screen lg:w-auto lg:translate-x-0 lg:self-start lg:bg-black/20',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
          !sidebarOpen && 'lg:px-3',
        )}
      >
        <div className="flex min-h-11 items-center gap-3">
          <span
            className={clsx(
              'grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white',
              railOnly,
            )}
          >
            <Sun size={22} aria-hidden="true" />
          </span>
          <div className={clsx('min-w-0', railOnly)}>
            <p className="truncate font-semibold text-white">
              TUCN Racing Team
            </p>
            <p className="truncate text-xs text-zinc-500">Pitlane telemetry</p>
          </div>
          <button
            type="button"
            className="ml-auto grid size-11 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Închide meniul"
          >
            <X size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mx-auto hidden size-11 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white lg:grid"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? 'Strânge meniul' : 'Extinde meniul'}
            aria-controls="navigatie-laterala"
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={18} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={18} aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="mt-6 space-y-5" aria-label="Navigație principală">
          {navigation.map(({ group, items }) => (
            <div key={group}>
              <p
                className={clsx(
                  'px-3 text-[11px] font-medium tracking-[0.16em] text-zinc-500 uppercase',
                  railOnly,
                )}
              >
                {group}
              </p>
              <ul className="mt-2 space-y-1">
                {items.map(({ to, label, icon: Icon, end }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={end}
                      title={sidebarOpen ? undefined : label}
                      className={({ isActive }) =>
                        clsx(
                          'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors',
                          !sidebarOpen && 'lg:justify-center lg:px-0',
                          isActive
                            ? 'bg-blue-500/15 text-blue-200'
                            : 'text-zinc-400 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      <Icon size={18} className="shrink-0" aria-hidden="true" />
                      <span className={clsx(!sidebarOpen && 'lg:sr-only')}>
                        {label}
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div
          className={clsx(
            'mt-auto rounded-xl border border-white/10 bg-white/[0.035] p-3',
            railOnly,
          )}
        >
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

      <main className="min-w-0 px-4 pb-6 sm:px-6 lg:px-8">
        {/*
          Lipit sus pe ecran mare: starea legăturii, înregistrarea și erorile
          rămân la vedere oricât ai derula. Pe telefon antetul se rupe pe mai
          multe rânduri și ar acoperi prea mult din ecran.
        */}
        <header className="-mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-white/10 bg-zinc-950/90 px-4 py-3 sm:-mx-6 sm:px-6 lg:sticky lg:top-0 lg:z-10 lg:-mx-8 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Deschide meniul"
              aria-controls="navigatie-laterala"
              aria-expanded={menuOpen}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-blue-300 uppercase">
                {mode === 'replay' ? 'Sesiune înregistrată' : 'Sesiune live'}
                {pageLabel && (
                  <span className="text-zinc-500"> · {pageLabel}</span>
                )}
              </p>
              <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                Sol Invictus II
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {hasGrid && (
              <button
                type="button"
                className={clsx(
                  'flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium',
                  editing
                    ? 'border-blue-400/40 bg-blue-500/20 text-blue-100'
                    : 'border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white',
                )}
                aria-pressed={editing}
                onClick={toggleEditing}
              >
                {editing ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <LayoutGrid size={18} aria-hidden="true" />
                )}
                {editing ? 'Gata' : 'Aranjează'}
              </button>
            )}
            <RecordingButton />
            <DriverSwitcher />
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
