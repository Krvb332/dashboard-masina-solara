import clsx from 'clsx'
import { useState } from 'react'
import { ElevationProfileChart } from '../../components/ElevationProfile'
import { GpsMappingPanel } from '../../components/GpsMappingPanel'
import { MetricCard, MetricRow } from '../../components/MetricCard'
import { Panel } from '../../components/Panel'
import { TelemetryChart } from '../../components/TelemetryChart'
import { TrackMap, type TrackColorBy } from '../../components/TrackMap'
import { TrackPositionPanel } from '../../components/TrackPositionPanel'
import { useSignalsByGroup } from '../../hooks/useSignal'
import { trackReference } from '../../lib/track-reference'

/** Zona 4 din documentul de arhitectură: harta și poziția pe traseu. */
export function TrackPage() {
  const gpsSignals = useSignalsByGroup('gps')
  const [colorBy, setColorBy] = useState<TrackColorBy>('speed')

  return (
    <>
      <section
        className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicatori de traseu"
      >
        <MetricCard signalKey="vehicle_speed_kph" />
        <MetricCard signalKey="lap_number" />
        <MetricCard signalKey="distance_km" />
        <MetricCard signalKey="gps_altitude_m" />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <Panel
          title={trackReference.name}
          subtitle="Circuitul desenat din referință, poziția proiectată pe el"
          action={<ColorByToggle value={colorBy} onChange={setColorBy} />}
        >
          <TrackMap height={420} colorBy={colorBy} />
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            {colorBy === 'speed'
              ? 'Albastru: viteză mică. Chihlimbar: viteză mare.'
              : 'Verde: punctul cel mai de jos. Roz: cel mai de sus.'}{' '}
            Banda gri este asfaltul, iar linia roșie estompată este poziția
            brută, înainte de proiecție — distanța dintre ele este cât corectează
            maparea. Bara albă marchează linia de start/sosire.
          </p>
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
            VDOP se referă la verticală: fără el sub 3,5, altitudinea nu susține
            calculul de pantă.
          </p>
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Profil de elevație"
          subtitle="Altitudine față de distanța parcursă"
        >
          <ElevationProfileChart height={240} />
        </Panel>

        <Panel
          title="Verificarea mapării poziției"
          subtitle="Latitudine, longitudine și altitudine, confruntate cu restul telemetriei"
        >
          <GpsMappingPanel />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Poziția pe circuit"
          subtitle="Sector, metru al turului și abaterea față de mijlocul asfaltului"
        >
          <TrackPositionPanel />
        </Panel>
      </section>

      <section className="mt-4">
        {/*
          `gps_speed_kph` a fost scos din serii: nu există nici în catalogul
          serverului, nici printre semnalele derivate local, deci graficul cerea
          o serie pe care nu o produce nimeni — o legendă fără linie.

          Nici nu era de adăugat. Viteza mașinii *este* cea raportată de GNSS:
          `vehicle_speed_kph` vine din `gps.speed_kmh`, deci a doua serie ar fi
          desenat aceleași puncte sub alt nume.
        */}
        <Panel title="Viteză pe traseu" subtitle="Ultimele 7 minute">
          <TelemetryChart
            signalKeys={['vehicle_speed_kph', 'motor_power_w']}
            height={240}
            ariaLabel="Grafic cu viteza mașinii și puterea motorului"
          />
        </Panel>
      </section>
    </>
  )
}

/**
 * Comutatorul de colorare a urmei.
 *
 * Viteza rămâne implicită pentru că este ce se citește într-o tură normală;
 * elevația se cere explicit, când întrebarea devine „unde urcăm".
 */
function ColorByToggle({
  value,
  onChange,
}: {
  value: TrackColorBy
  onChange: (next: TrackColorBy) => void
}) {
  const options: { key: TrackColorBy; label: string }[] = [
    { key: 'speed', label: 'Viteză' },
    { key: 'elevation', label: 'Altitudine' },
  ]

  return (
    <div
      className="flex gap-1 rounded-lg bg-white/5 p-1"
      role="group"
      aria-label="Colorează urma după"
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={clsx(
            'rounded-md px-3 py-1 text-xs transition-colors',
            value === option.key
              ? 'bg-white/15 text-white'
              : 'text-zinc-400 hover:text-zinc-200',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
