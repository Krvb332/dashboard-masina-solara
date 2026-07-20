import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Bolt,
  Gauge,
  LayoutDashboard,
  Map,
  Radio,
  Settings,
  Sun,
  Thermometer,
} from 'lucide-react'
import { MetricCard } from '../../components/MetricCard'
import { TelemetryChart } from '../../components/TelemetryChart'
import { useTelemetryStore } from '../../stores/telemetry-store'

const navigation = [
  { label: 'Prezentare', icon: LayoutDashboard, active: true },
  { label: 'Energie', icon: Bolt },
  { label: 'Traseu', icon: Map },
  { label: 'Sistem', icon: Settings },
]

export function DashboardPage() {
  const connection = useTelemetryStore((state) => state.connection)

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden border-r border-white/10 bg-black/20 px-4 py-6 lg:flex lg:flex-col">
        <div className="flex min-h-11 items-center gap-3 px-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-950">
            <Sun size={22} aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-white">Solaris</p>
            <p className="text-xs text-zinc-500">Pitlane telemetry</p>
          </div>
        </div>

        <nav className="mt-9" aria-label="Navigație principală">
          <ul className="space-y-2">
            {navigation.map(({ label, icon: Icon, active }) => (
              <li key={label}>
                <button
                  type="button"
                  className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors ${
                    active
                      ? 'bg-blue-500/15 text-blue-200'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto rounded-xl border border-white/10 bg-white/[0.035] p-3">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Radio size={16} className="text-emerald-400" aria-hidden="true" />
            Gateway pitlane
          </div>
          <p className="mt-2 text-xs text-zinc-500">192.168.4.10 · local</p>
        </div>
      </aside>

      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-blue-300 uppercase">
              Sesiune demonstrativă
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Mașina solară 01
            </h1>
          </div>
          <div
            className="flex min-h-11 items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 text-sm text-emerald-200"
            role="status"
          >
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
            </span>
            {connection === 'connected'
              ? 'Telemetrie conectată'
              : 'Reconectare'}
          </div>
        </header>

        <section
          className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Indicatori principali"
        >
          <MetricCard
            label="Viteză"
            value="63,8 km/h"
            detail="+2,4 km/h în ultimul minut"
            icon={Gauge}
          />
          <MetricCard
            label="Baterie"
            value="76,2%"
            detail="112,6 V · 18,4 A"
            icon={BatteryCharging}
            tone="success"
          />
          <MetricCard
            label="Putere solară"
            value="1,04 kW"
            detail="Randament MPPT 96,8%"
            icon={Sun}
            tone="warning"
          />
          <MetricCard
            label="Temperatură max."
            value="41,7°C"
            detail="Invertor · limite normale"
            icon={Thermometer}
            tone="success"
          />
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.7fr)]">
          <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-white">Flux energetic</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Ultimele 7 minute · date simulate
                </p>
              </div>
              <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400">
                Actualizare 10 Hz
              </span>
            </div>
            <div className="mt-4">
              <TelemetryChart />
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-white">Stare sistem</h2>
                <p className="mt-1 text-sm text-zinc-500">Verificări active</p>
              </div>
              <Activity
                size={20}
                className="text-blue-300"
                aria-hidden="true"
              />
            </div>

            <ul className="mt-6 space-y-3">
              <StatusItem label="BMS" detail="96 celule online" />
              <StatusItem label="MPPT" detail="4 / 4 controlere" />
              <StatusItem label="Invertor" detail="Funcționare normală" />
            </ul>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.07] p-3">
              <AlertTriangle
                size={18}
                className="mt-0.5 shrink-0 text-amber-300"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium text-amber-100">
                  Semnal GPS degradat
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-200/60">
                  Precizie estimată la 4,2 metri. Monitorizarea continuă.
                </p>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}

function StatusItem({ label, detail }: { label: string; detail: string }) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-4 rounded-xl bg-black/15 px-3">
      <div>
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        <p className="text-xs text-zinc-500">{detail}</p>
      </div>
      <span className="size-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.55)]">
        <span className="sr-only">Operațional</span>
      </span>
    </li>
  )
}
