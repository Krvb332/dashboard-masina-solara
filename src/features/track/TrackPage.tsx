import { Flag, Gauge, Satellite } from 'lucide-react'
import { Panel } from '../../components/Panel'
import { SignalCard } from '../../components/SignalCard'
import { SignalTable } from '../../components/SignalTable'
import { TelemetryChart } from '../../components/TelemetryChart'
import { TrackMap } from '../../components/TrackMap'

const speedSeries = [
  { signal: 'vehicle_speed_kph', label: 'Viteză', color: '#60a5fa', area: true },
]

export function TrackPage() {
  return (
    <>
      <section
        className="mt-7 grid gap-4 sm:grid-cols-3"
        aria-label="Indicatori de traseu"
      >
        <SignalCard signal="vehicle_speed_kph" icon={Gauge} />
        <SignalCard signal="lap_number" icon={Flag} detail="Tur curent" />
        <SignalCard signal="gps_accuracy_m" icon={Satellite} />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Traseu parcurs"
          subtitle="Reconstituit din coordonatele GPS, ultimele 10 minute"
        >
          <TrackMap />
        </Panel>

        <Panel title="Profil de viteză" subtitle="Ultimele 7 minute">
          <TelemetryChart
            series={speedSeries}
            unit="km/h"
            decimals={1}
            height={300}
            ariaLabel="Evoluția vitezei vehiculului"
          />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel title="Semnale de poziție" subtitle="Valori curente">
          <SignalTable groups={['pozitie', 'vehicul']} />
        </Panel>
      </section>
    </>
  )
}
