import clsx from 'clsx'
import { Bolt, LayoutDashboard, Map, Settings, Sun } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ConnectionBadge } from '../../components/ConnectionBadge'
import { useTelemetryConnection } from '../../hooks/use-telemetry-connection'
import { useTelemetryStore } from '../../stores/telemetry-store'
import { SourceSwitch } from './SourceSwitch'

const navigation = [
  { to: '/', label: 'Prezentare', icon: LayoutDashboard, end: true },
  { to: '/energie', label: 'Energie', icon: Bolt },
  { to: '/traseu', label: 'Traseu', icon: Map },
  { to: '/sistem', label: 'Sistem', icon: Settings },
]

const pageTitles: Record<string, string> = {
  '/': 'Prezentare generală',
  '/energie': 'Energie și baterie',
  '/traseu': 'Traseu și poziție',
  '/sistem': 'Sistem și diagnostic',
}

export function AppLayout() {
  // Sursa de telemetrie este pornită o singură dată, aici, pentru toată aplicația.
  useTelemetryConnection()

  const location = useLocation()
  const meta = useTelemetryStore((state) => state.meta)

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden border-r border-white/10 bg-black/20 px-4 py-6 lg:flex lg:flex-col">
        <div className="flex min-h-11 items-center gap-3 px-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-950">
            <Sun size={22} aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-white">TUCN Racing</p>
            <p className="text-xs text-zinc-500">Pitlane telemetry</p>
          </div>
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

        <SourceSwitch />
      </aside>

      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.18em] text-blue-300 uppercase">
              TUCN Racing Team
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {pageTitles[location.pathname] ?? 'Telemetrie'}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {meta
                ? `${meta.vehicleId} · sesiunea ${meta.sessionId}`
                : 'Se așteaptă primul mesaj de la mașină'}
            </p>
          </div>
          <ConnectionBadge />
        </header>

        {/* Navigație pentru ecrane mici, unde bara laterală este ascunsă. */}
        <nav
          className="mt-5 flex gap-2 overflow-x-auto lg:hidden"
          aria-label="Navigație principală"
        >
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-500/15 text-blue-200'
                    : 'bg-white/5 text-zinc-400',
                )
              }
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <Outlet />
      </main>
    </div>
  )
}
