import { ElevationProfileChart } from '../../components/ElevationProfile'
import { Panel } from '../../components/Panel'
import { TelemetryChart } from '../../components/TelemetryChart'
import { TrackMap } from '../../components/TrackMap'
import { DERIVED_SIGNALS, derivedBuffer } from '../../lib/derived-buffer'

/**
 * Pagina numai-grafice: fiecare mărime apare desenată, niciuna scrisă.
 *
 * Restul interfeței explică — formule sub cifre, praguri, recomandări. Aici nu
 * există niciun rând de proză, niciun tabel și niciun card cu valoare: rămân
 * titlul scurt al fiecărui panou și desenul propriu-zis, fiindcă asta e tot ce
 * trebuie ca să vezi o tendință dintr-o privire. Cine vrea cifra exactă o are
 * în tooltipul graficului sau pe pagina care răspunde la întrebarea aceea.
 *
 * Ordinea urmează lanțul fizic al mașinii: cât de repede mergem, câtă putere
 * curge, de unde vine, ce se încălzește, unde suntem.
 */
export function ChartsPage() {
  return (
    <>
      <section
        className="mt-7 grid gap-4 xl:grid-cols-2"
        aria-label="Mișcare și putere"
      >
        <Panel title="Viteză">
          <TelemetryChart
            signalKeys={['vehicle_speed_kph', 'calc_ground_speed_kph']}
            extraDefinitions={DERIVED_SIGNALS}
            height={240}
            ariaLabel="Grafic cu viteza vehiculului"
          />
        </Panel>

        <Panel title="Turație motor">
          <TelemetryChart
            signalKeys={['motor_rpm']}
            height={240}
            ariaLabel="Grafic cu turația motorului"
          />
        </Panel>

        <Panel title="Putere: pachet, motor, panouri">
          <TelemetryChart
            signalKeys={['battery_power_w', 'motor_power_w', 'solar_power_w']}
            height={240}
            ariaLabel="Grafic cu puterea pachetului, a motorului și a panourilor"
          />
        </Panel>

        <Panel title="Consum, recuperare, bilanț">
          <TelemetryChart
            signalKeys={[
              'calc_consumption_w',
              'calc_regen_w',
              'calc_net_power_w',
            ]}
            source={derivedBuffer}
            extraDefinitions={DERIVED_SIGNALS}
            height={240}
            ariaLabel="Grafic cu puterea consumată, cea recuperată și bilanțul net"
          />
        </Panel>
      </section>

      <section
        className="mt-4 grid gap-4 xl:grid-cols-2"
        aria-label="Pachet și randament"
      >
        <Panel title="Pachet: tensiune și curent">
          <TelemetryChart
            signalKeys={['battery_voltage_v', 'battery_current_a']}
            height={240}
            ariaLabel="Grafic cu tensiunea și curentul pachetului"
          />
        </Panel>

        <Panel title="Stare de încărcare">
          <TelemetryChart
            signalKeys={['battery_soc_pct']}
            height={240}
            ariaLabel="Grafic cu starea de încărcare a pachetului"
          />
        </Panel>

        <Panel title="Consum specific și autonomie">
          <TelemetryChart
            signalKeys={['calc_wh_per_km', 'calc_range_km']}
            source={derivedBuffer}
            extraDefinitions={DERIVED_SIGNALS}
            height={240}
            ariaLabel="Grafic cu consumul specific și autonomia estimată"
          />
        </Panel>

        <Panel title="Panouri: putere pe convertor">
          <TelemetryChart
            signalKeys={['mppt1_power_w', 'mppt2_power_w', 'solar_power_w']}
            height={240}
            ariaLabel="Grafic cu puterea fiecărui convertor solar și totalul"
          />
        </Panel>
      </section>

      <section className="mt-4 grid gap-4" aria-label="Celulele pachetului">
        <Panel title="Celule: extreme și dezechilibru">
          {/*
            Grila din `CellGrid` arată fiecare celulă, dar o face cu etichete și
            cu o legendă scrisă — aici ar fi fost singurul loc cu proză. Aceleași
            date, desenate: minima, maxima și distanța dintre ele în timp, care
            e oricum întrebarea reală („se desparte pachetul?").
          */}
          <TelemetryChart
            signalKeys={[
              'cell_voltage_min_v',
              'cell_voltage_max_v',
              'cell_voltage_delta_v',
            ]}
            height={260}
            ariaLabel="Grafic cu tensiunea minimă, cea maximă și dezechilibrul dintre celule"
          />
        </Panel>
      </section>

      <section
        className="mt-4 grid gap-4 xl:grid-cols-2"
        aria-label="Temperaturi"
      >
        <Panel title="Temperaturi: motor și invertor">
          <TelemetryChart
            signalKeys={['motor_temp_c', 'inverter_temp_c']}
            height={240}
            ariaLabel="Grafic cu temperatura motorului și a invertorului"
          />
        </Panel>

        <Panel title="Temperaturi: pachet">
          <TelemetryChart
            signalKeys={['battery_temp_min_c', 'battery_temp_max_c']}
            height={240}
            ariaLabel="Grafic cu temperatura minimă și maximă din pachet"
          />
        </Panel>
      </section>

      <section
        className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
        aria-label="Poziție pe traseu"
      >
        <Panel title="Traseu">
          <TrackMap height={360} colorBy="speed" />
        </Panel>

        <Panel title="Profil de altitudine">
          <ElevationProfileChart height={360} />
        </Panel>
      </section>
    </>
  )
}
