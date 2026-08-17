import { MetricCard, MetricRow } from '../../components/MetricCard'
import { Panel } from '../../components/Panel'
import { TelemetryChart } from '../../components/TelemetryChart'
import { TrackMap } from '../../components/TrackMap'
import { useSignalsByGroup } from '../../hooks/useSignal'

/** Zona 4 din documentul de arhitectură: harta și poziția pe traseu. */
export function TrackPage() {
  const gpsSignals = useSignalsByGroup('gps')

  return (
    <>
      <section
        className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicatori de traseu"
      >
        <MetricCard signalKey="vehicle_speed_kph" />
        <MetricCard signalKey="lap_number" />
        <MetricCard signalKey="distance_km" />
        <MetricCard signalKey="gps_hdop" />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <Panel
          title="Traseu"
          subtitle="Desenat local din coordonatele GPS, fără hărți externe"
        >
          <TrackMap height={420} />
        </Panel>

        <Panel title="Calitatea poziției" subtitle="Semnale GPS brute">
          <ul className="space-y-2">
            {gpsSignals.map((signal) => (
              <MetricRow key={signal.key} signalKey={signal.key} />
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-zinc-500">
            HDOP mic înseamnă poziție precisă. Peste 2,5 harta poate „sări", iar
            peste 5 poziția nu mai este de încredere pentru analiza turului.
          </p>
        </Panel>
      </section>

      <section className="mt-4">
        <Panel title="Viteză pe traseu" subtitle="Ultimele 7 minute">
          <TelemetryChart
            signalKeys={['vehicle_speed_kph', 'motor_power_w']}
            height={240}
            ariaLabel="Grafic cu viteza și puterea motorului"
          />
        </Panel>
      </section>
    </>
  )
}
