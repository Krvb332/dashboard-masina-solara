import {
  BatteryCharging,
  Gauge,
  Sun,
  Thermometer,
} from 'lucide-react'
import { AlarmPanel } from '../../components/AlarmPanel'
import { Panel } from '../../components/Panel'
import { SignalCard } from '../../components/SignalCard'
import { SubsystemStatus } from '../../components/SubsystemStatus'
import { TelemetryChart } from '../../components/TelemetryChart'
import { env } from '../../config/env'
import { useAlarms } from '../../hooks/use-telemetry'
import { useTelemetryStore } from '../../stores/telemetry-store'

const energySeries = [
  { signal: 'motor_power_w', label: 'Consum', color: '#60a5fa', area: true },
  { signal: 'solar_power_w', label: 'Solar', color: '#fbbf24' },
]

export function DashboardPage() {
  const alarms = useAlarms()
  const rateHz = useTelemetryStore((state) => state.stats.rateHz)

  return (
    <>
      <section
        className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicatori principali"
      >
        <SignalCard signal="vehicle_speed_kph" icon={Gauge} />
        <SignalCard
          signal="battery_soc_pct"
          icon={BatteryCharging}
          accent="emerald"
        />
        <SignalCard signal="solar_power_w" icon={Sun} accent="amber" />
        <SignalCard
          signal="cell_temp_max_c"
          icon={Thermometer}
          accent="emerald"
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.7fr)]">
        <Panel
          title="Flux energetic"
          subtitle="Puterea consumată de motor față de producția solară"
          aside={
            <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs whitespace-nowrap text-zinc-400 tabular-nums">
              {rateHz > 0 ? `${rateHz} Hz` : 'fără flux'} · afișare{' '}
              {env.uiRefreshHz} Hz
            </span>
          }
        >
          <TelemetryChart
            series={energySeries}
            unit="W"
            ariaLabel="Evoluția puterii consumate și a puterii solare"
          />
        </Panel>

        <div className="grid gap-4 content-start">
          <Panel title="Stare sistem" subtitle="Verificări active">
            <SubsystemStatus />
          </Panel>

          <Panel
            title="Alarme"
            subtitle={
              alarms.length > 0
                ? `${alarms.length} active`
                : 'Toate valorile în limite'
            }
          >
            <AlarmPanel alarms={alarms} />
          </Panel>
        </div>
      </section>
    </>
  )
}
