import { Battery, BatteryCharging, Gauge, Sun, Zap } from 'lucide-react'
import { Panel } from '../../components/Panel'
import { SignalCard } from '../../components/SignalCard'
import { SignalTable } from '../../components/SignalTable'
import { TelemetryChart } from '../../components/TelemetryChart'
import { formatEnergy } from '../../lib/format'
import { historyBuffer, useTelemetryStore } from '../../stores/telemetry-store'

const powerSeries = [
  { signal: 'motor_power_w', label: 'Motor', color: '#60a5fa', area: true },
  { signal: 'solar_power_w', label: 'Solar', color: '#fbbf24' },
  { signal: 'battery_power_w', label: 'Baterie', color: '#34d399' },
]

const cellSeries = [
  { signal: 'cell_voltage_min_v', label: 'Celulă minimă', color: '#f87171' },
  { signal: 'cell_voltage_max_v', label: 'Celulă maximă', color: '#60a5fa' },
]

export function EnergyPage() {
  return (
    <>
      <section
        className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicatori de energie"
      >
        <SignalCard
          signal="battery_soc_pct"
          icon={BatteryCharging}
          accent="emerald"
        />
        <SignalCard signal="battery_voltage_v" icon={Zap} />
        <SignalCard signal="battery_current_a" icon={Gauge} />
        <SignalCard signal="solar_power_w" icon={Sun} accent="amber" />
      </section>

      <EnergyCounters />

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title="Bilanț de putere"
          subtitle="Consum, producție solară și fluxul din baterie"
        >
          <TelemetryChart
            series={powerSeries}
            unit="W"
            ariaLabel="Evoluția puterii pe motor, panouri solare și baterie"
          />
        </Panel>

        <Panel
          title="Echilibrul celulelor"
          subtitle="Tensiunea celulei minime față de cea maximă"
        >
          <TelemetryChart
            series={cellSeries}
            unit="V"
            decimals={2}
            ariaLabel="Evoluția tensiunii celulelor extreme"
          />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel title="Semnale de baterie și solar" subtitle="Valori curente">
          <SignalTable groups={['baterie', 'solar']} />
        </Panel>
      </section>
    </>
  )
}

/**
 * Energia acumulată pe durata istoricului păstrat în memorie.
 *
 * Este o valoare orientativă, nu un contor de sesiune: bufferul are lungime
 * limitată, iar la reîncărcarea paginii repornește. Contorizarea reală a
 * sesiunii trebuie făcută pe server, unde există istoricul complet.
 */
function EnergyCounters() {
  useTelemetryStore((state) => state.historyVersion)

  const consumed = historyBuffer.integrate('motor_power_w')
  const harvested = historyBuffer.integrate('solar_power_w')
  const net =
    consumed !== null && harvested !== null ? consumed - harvested : null

  return (
    <section className="mt-4">
      <Panel
        title="Energie acumulată"
        subtitle="Integrată pe istoricul păstrat în browser"
        aside={
          <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400">
            orientativ
          </span>
        }
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <Counter
            icon={Gauge}
            label="Consumată de motor"
            value={formatEnergy(consumed)}
          />
          <Counter
            icon={Sun}
            label="Produsă de panouri"
            value={formatEnergy(harvested)}
          />
          <Counter
            icon={Battery}
            label="Bilanț net"
            value={formatEnergy(net)}
            hint={
              net === null
                ? undefined
                : net > 0
                  ? 'Se consumă din baterie'
                  : 'Bateria se încarcă'
            }
          />
        </dl>
      </Panel>
    </section>
  )
}

function Counter({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Battery
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl bg-black/15 p-4">
      <dt className="flex items-center gap-2 text-xs tracking-wider text-zinc-500 uppercase">
        <Icon size={14} aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-2 text-2xl font-semibold text-white tabular-nums">
        {value}
      </dd>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  )
}
