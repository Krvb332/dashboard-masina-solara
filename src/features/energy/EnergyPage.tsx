import { CellGrid } from '../../components/CellGrid'
import { MetricCard, MetricRow } from '../../components/MetricCard'
import { Panel } from '../../components/Panel'
import { TelemetryChart } from '../../components/TelemetryChart'
import { useSignalsByGroup } from '../../hooks/useSignal'
import { formatDuration, formatNumber, NO_VALUE } from '../../lib/format'
import { isInCapacityPanel, isInCellPanel } from '../../lib/signal-groups'
import { useTelemetryStore } from '../../stores/telemetry-store'

/**
 * Zona 2 din documentul de arhitectură: energie și baterie.
 *
 * Include consumul pe tur, calculat din trecerile prin start/finiș - indicatorul
 * după care se ia decizia de strategie într-o cursă solară.
 */
/** Cardurile mari de sus; nu se repetă și ca rânduri în lista de jos. */
const OVERVIEW_CARDS = [
  'battery_soc_pct',
  'battery_power_w',
  'solar_power_w',
  'energy_consumed_wh',
]

/** Puterea culeasă de fiecare convertor: singura serie desenată în grafic. */
const MPPT_POWER = /^mppt\d+_power_w$/
/** Rândurile din panoul MPPT: putere, ieșire, randament, temperatură radiator. */
const MPPT_MAIN =
  /^mppt\d+_(power_w|output_power_w|efficiency_pct|heatsink_temp_c)$/

export function EnergyPage() {
  const energySignals = useSignalsByGroup('energy')
  const mpptPower = energySignals.filter((signal) =>
    MPPT_POWER.test(signal.key),
  )
  const mpptMain = energySignals.filter((signal) => MPPT_MAIN.test(signal.key))
  // Tensiuni, curenți, mod, defect, id CAN: utile la diagnostic, nu la o
  // privire; stau pliate sub rândurile principale.
  const mpptOther = energySignals.filter(
    (signal) => signal.key.startsWith('mppt') && !MPPT_MAIN.test(signal.key),
  )
  // Celulele au panoul lor; fara excluderea de aici, cele 32 de tensiuni ar
  // aparea si ca 32 de randuri de text in lista de semnale.
  const rest = energySignals.filter(
    (signal) =>
      !signal.key.startsWith('mppt') &&
      !signal.overview &&
      !OVERVIEW_CARDS.includes(signal.key) &&
      !isInCellPanel(signal.key) &&
      !isInCapacityPanel(signal.key),
  )

  return (
    <>
      <section
        className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicatori de energie"
      >
        <MetricCard signalKey="battery_soc_pct" />
        <MetricCard signalKey="battery_power_w" />
        <MetricCard signalKey="solar_power_w" />
        <MetricCard signalKey="energy_consumed_wh" />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <Panel title="Baterie: tensiune și curent" subtitle="Ultimele 7 minute">
          <TelemetryChart
            signalKeys={['battery_voltage_v', 'battery_current_a']}
            ariaLabel="Grafic cu tensiunea și curentul pachetului de baterii"
          />
        </Panel>

        <Panel title="Celule" subtitle="Extremele raportate de BMS">
          <ul className="space-y-2">
            <MetricRow signalKey="cell_voltage_min_v" />
            <MetricRow signalKey="cell_voltage_max_v" />
            <MetricRow signalKey="battery_temp_delta_c" />
          </ul>
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Tensiunea pe celulă"
          subtitle="Fiecare celulă raportată de BMS, în ordinea din pachet"
        >
          <CellGrid />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel title="Capacitate și cicluri" subtitle="Raportate de BMS">
          <ul className="grid gap-2 sm:grid-cols-2">
            <MetricRow signalKey="battery_capacity_remain_ah" />
            <MetricRow signalKey="battery_capacity_total_ah" />
            <MetricRow signalKey="battery_cycles" />
            <MetricRow signalKey="battery_soh_pct" />
          </ul>
          <p className="mt-3 text-xs text-zinc-500">
            BMS-ul ANT raportează capacitatea învățată, nu pe cea de proiect.
            Starea de sănătate apare doar dacă firmware-ul cunoaște capacitatea
            de proiect și o calculează el; altfel rămâne „—", ceea ce este
            adevărat, spre deosebire de un procent dedus dintr-o referință care
            lipsește.
          </p>
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Controlere MPPT"
          subtitle="Cele două convertoare: putere culeasă, livrată, randament"
        >
          <ul className="space-y-2">
            {mpptMain.map((signal) => (
              <MetricRow key={signal.key} signalKey={signal.key} />
            ))}
          </ul>
          {mpptOther.length > 0 && (
            <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <summary className="cursor-pointer text-sm text-zinc-300">
                Diagnostic convertoare ({mpptOther.length} semnale)
              </summary>
              <ul className="mt-2 space-y-2">
                {mpptOther.map((signal) => (
                  <MetricRow key={signal.key} signalKey={signal.key} />
                ))}
              </ul>
            </details>
          )}
          <div className="mt-4">
            <TelemetryChart
              signalKeys={mpptPower.map((signal) => signal.key)}
              height={200}
              ariaLabel="Grafic cu puterea culeasă de fiecare convertor MPPT"
            />
          </div>
        </Panel>

        <LapTable />
      </section>

      <section className="mt-4">
        <Panel
          title="Semnale de energie"
          subtitle="Restul semnalelor din grupul energie, așa cum le raportează mașina"
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {rest.map((signal) => (
              <MetricRow key={signal.key} signalKey={signal.key} />
            ))}
          </ul>
        </Panel>
      </section>
    </>
  )
}

/** Consumul, durata și viteza medie pentru fiecare tur încheiat. */
function LapTable() {
  const laps = useTelemetryStore((state) => state.laps)

  return (
    <Panel
      title="Consum pe tur"
      subtitle={
        laps.length === 0
          ? 'Se completează la închiderea primului tur'
          : `${laps.length} tururi înregistrate`
      }
      bodyClassName="overflow-x-auto"
    >
      {laps.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Niciun tur încheiat de la pornirea dashboardului.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
              <th className="pb-2 font-medium">Tur</th>
              <th className="pb-2 font-medium">Durată</th>
              <th className="pb-2 font-medium">Energie</th>
              <th className="pb-2 font-medium">Viteză medie</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {[...laps].reverse().map((lap) => (
              <tr key={lap.lap} className="border-t border-white/5">
                <td className="py-2 font-medium text-white">{lap.lap}</td>
                <td className="py-2 tabular-nums">
                  {lap.durationS === null
                    ? NO_VALUE
                    : formatDuration(lap.durationS)}
                </td>
                <td className="py-2 tabular-nums">
                  {lap.energyWh === null
                    ? NO_VALUE
                    : `${formatNumber(lap.energyWh, 0)} Wh`}
                </td>
                <td className="py-2 tabular-nums">
                  {lap.averageSpeedKph === null
                    ? NO_VALUE
                    : `${formatNumber(lap.averageSpeedKph, 1)} km/h`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
