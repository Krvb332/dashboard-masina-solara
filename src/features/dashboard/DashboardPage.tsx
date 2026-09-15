import { Link } from 'react-router-dom'
import { MetricCard } from '../../components/MetricCard'
import { Panel } from '../../components/Panel'
import { TeensyStatsPanel } from '../../components/TeensyStatsPanel'
import { TelemetryChart } from '../../components/TelemetryChart'
import { TrackMap } from '../../components/TrackMap'
import { WeatherSummary } from '../../components/WeatherPanel'
import { useOverviewSignals } from '../../hooks/useSignal'
import { useStreamStats } from '../../hooks/useStreamStats'
import { useTelemetryStore } from '../../stores/telemetry-store'

/**
 * Zona 1 din documentul de arhitectură: starea generală.
 *
 * Cardurile nu sunt scrise de mână - vin din semnalele marcate `overview` în
 * catalogul serverului, deci ce se vede aici se schimbă dintr-un singur loc.
 */
export function DashboardPage() {
  const overview = useOverviewSignals()
  const catalogLoaded = useTelemetryStore((state) => state.catalog.length > 0)

  return (
    <>
      <section
        className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicatori principali"
      >
        {catalogLoaded ? (
          overview.map((signal) => (
            <MetricCard key={signal.key} signalKey={signal.key} />
          ))
        ) : (
          <SkeletonCards />
        )}
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <Panel
          title="Flux energetic"
          subtitle="Ultimele 7 minute · consum față de aport solar"
          action={<LiveRate />}
        >
          <TelemetryChart
            signalKeys={['battery_power_w', 'solar_power_w']}
            ariaLabel="Grafic cu puterea consumată din baterie și puterea solară"
          />
        </Panel>

        <Panel title="Placă Teensy" subtitle="Starea plăcii de achiziție">
          <TeensyStatsPanel />
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Poziție pe traseu"
          subtitle="Culoarea urmei indică viteza"
          action={
            <Link
              to="/traseu"
              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
            >
              Detalii
            </Link>
          }
        >
          <TrackMap height={260} />
        </Panel>

        <Panel title="Viteză și turație" subtitle="Ultimele 7 minute">
          <TelemetryChart
            signalKeys={['vehicle_speed_kph']}
            height={260}
            ariaLabel="Grafic cu viteza mașinii"
          />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Vreme la fața locului"
          subtitle="Condițiile care schimbă consumul și aportul solar"
          action={
            <Link
              to="/vreme"
              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
            >
              Detalii
            </Link>
          }
        >
          <WeatherSummary />
        </Panel>
      </section>
    </>
  )
}

function LiveRate() {
  const { effective_hz: effectiveHz } = useStreamStats()

  return (
    <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400">
      {effectiveHz > 0
        ? `Recepție ${effectiveHz.toFixed(1).replace('.', ',')} Hz`
        : 'Fără flux'}
    </span>
  )
}

function SkeletonCards() {
  return (
    <>
      {['status', 'energy', 'thermal', 'motor'].map((key) => (
        <article
          key={key}
          className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"
        >
          <p className="text-xs tracking-[0.16em] text-zinc-500 uppercase">
            Se încarcă
          </p>
          <p className="mt-3 text-3xl font-semibold text-zinc-700">—</p>
          <p className="mt-4 text-sm text-zinc-600">
            Se așteaptă catalogul de semnale
          </p>
        </article>
      ))}
    </>
  )
}
