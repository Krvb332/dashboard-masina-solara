import { Link } from 'react-router-dom'
import { MetricCard } from '../../components/MetricCard'
import { Panel } from '../../components/Panel'
import { PanelGrid, PanelSlot } from '../../components/PanelGrid'
import { SpeedCard } from '../../components/SpeedCard'
import { DERIVED_SIGNALS, derivedBuffer } from '../../lib/derived-buffer'
import { TeensyStatsPanel } from '../../components/TeensyStatsPanel'
import { TelemetryChart } from '../../components/TelemetryChart'
import { TrackMap } from '../../components/TrackMap'
import { WeatherSummary } from '../../components/WeatherPanel'
import { useOverviewSignals } from '../../hooks/useSignal'
import { formatNumber } from '../../lib/format'
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
          overview.map((signal) =>
            // Viteza are card propriu: când placa nu o trimite, o deduce din
            // turație și spune asta, în loc să rămână „—" la nesfârșit.
            signal.key === 'vehicle_speed_kph' ? (
              <SpeedCard key={signal.key} />
            ) : (
              <MetricCard key={signal.key} signalKey={signal.key} />
            ),
          )
        ) : (
          <SkeletonCards />
        )}
      </section>

      <PanelGrid storageKey="prezentare">
        <PanelSlot id="flux" title="Flux energetic" span={4}>
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
        </PanelSlot>

        <PanelSlot id="teensy" title="Placă Teensy" span={2}>
          <Panel title="Placă Teensy" subtitle="Starea plăcii de achiziție">
            <TeensyStatsPanel />
          </Panel>
        </PanelSlot>

        <PanelSlot id="traseu" title="Poziție pe traseu" span={3}>
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
        </PanelSlot>

        <PanelSlot id="viteza" title="Viteza mașinii" span={3}>
          <Panel
            title="Viteza mașinii"
            subtitle="Ultimele 7 minute · raportată de placă sau dedusă din turația motorului"
          >
            <TelemetryChart
              signalKeys={['calc_ground_speed_kph']}
              source={derivedBuffer}
              extraDefinitions={DERIVED_SIGNALS}
              windowMs={7 * 60_000}
              height={260}
              ariaLabel="Grafic cu viteza mașinii"
            />
          </Panel>
        </PanelSlot>

        <PanelSlot id="vreme" title="Vreme la fața locului" span={6}>
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
        </PanelSlot>
      </PanelGrid>
    </>
  )
}

function LiveRate() {
  const { effective_hz: effectiveHz } = useStreamStats()

  return (
    <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400">
      {effectiveHz > 0
        ? `Ritm cadre ${formatNumber(effectiveHz, 1)} Hz`
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
