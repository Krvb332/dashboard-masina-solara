import { CoachingPanel } from '../../components/CoachingPanel'
import { ConsumptionPanel } from '../../components/ConsumptionPanel'
import { ElevationProfileChart } from '../../components/ElevationProfile'
import { Panel } from '../../components/Panel'
import { StatTile } from '../../components/StatTile'
import { toneAbove, toneBelow } from '../../lib/stat-tone'
import { TelemetryChart } from '../../components/TelemetryChart'
import { DERIVED_SIGNALS, derivedBuffer } from '../../lib/derived-buffer'
import { formatNumber, NO_VALUE } from '../../lib/format'
import { sustainableWhPerKm } from '../../lib/coaching'
import { useAnalyticsStore } from '../../stores/analytics-store'
import { useDriverStore } from '../../stores/driver-store'

/**
 * Pagina de decizie rapidă: numai grafice, cifre derivate și ce are pilotul de
 * făcut. Fără liste de senzori și fără tabele de diagnostic — acelea au pagina
 * lor, iar aici ar întârzia exact decizia pentru care s-a deschis pagina.
 *
 * Ordinea de pe ecran este ordinea întrebărilor din boxă: ce facem acum, cât
 * consumăm, cum evoluează, cine conduce.
 */
export function StatisticsPage() {
  const snapshot = useAnalyticsStore((state) => state.snapshot)
  const strategy = useAnalyticsStore((state) => state.strategy)
  const setStrategy = useAnalyticsStore((state) => state.setStrategy)

  const sustainable = sustainableWhPerKm(
    snapshot.solarW,
    snapshot.averageSpeedKph,
  )

  return (
    <>
      <section className="mt-7" aria-label="Recomandări pentru pilot">
        <Panel
          title="Ce transmitem pilotului"
          subtitle="Cea mai gravă observație, cu cifra din spatele ei"
        >
          <CoachingPanel />
        </Panel>
      </section>

      <section
        className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicatori de decizie"
      >
        <StatTile
          label="Consum acum"
          value={snapshot.recentWhPerKm}
          unit="Wh/km"
          decimals={1}
          formula="ΔE / Δd, fereastră 2 min"
          tone={toneAbove(snapshot.recentWhPerKm, 25, 40)}
        />
        <StatTile
          label="Prag susținut de soare"
          value={sustainable}
          unit="Wh/km"
          decimals={1}
          formula="P_solar / v"
          hint="Peste acest consum, diferența iese din pachet."
        />
        <StatTile
          label="Recuperare regenerativă"
          value={snapshot.regenW}
          unit="W"
          decimals={0}
          formula="energie întoarsă în pachet"
          tone={
            snapshot.regenW !== null && snapshot.regenW > 0 ? 'good' : 'neutral'
          }
        />
        <StatTile
          label="Autonomie"
          value={snapshot.rangeKm}
          unit="km"
          decimals={1}
          formula="E_rămasă / consum specific"
          tone={toneBelow(snapshot.rangeKm, 40, 15)}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <Panel
          title="Consum și recuperare"
          subtitle="Cât scoate motorul din pachet și cât întoarce frâna regenerativă"
        >
          <TelemetryChart
            signalKeys={[
              'calc_consumption_w',
              'calc_regen_w',
              'calc_net_power_w',
            ]}
            source={derivedBuffer}
            extraDefinitions={DERIVED_SIGNALS}
            windowMs={6 * 60_000}
            height={260}
            ariaLabel="Grafic cu puterea consumată, puterea recuperată și bilanțul de putere"
          />
        </Panel>

        <Panel
          title="Ținta de strategie"
          subtitle="Se aplică imediat în recomandări"
        >
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm text-zinc-300">
              Consum-țintă (Wh/km)
              <input
                type="number"
                min={0}
                step={0.5}
                value={strategy.targetWhPerKm ?? ''}
                onChange={(event) =>
                  setStrategy({
                    targetWhPerKm:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                  })
                }
                className="min-h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-300">
              Distanță rămasă (km)
              <input
                type="number"
                min={0}
                step={1}
                value={strategy.remainingDistanceKm ?? ''}
                onChange={(event) =>
                  setStrategy({
                    remainingDistanceKm:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                  })
                }
                className="min-h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white"
              />
            </label>

            <p className="text-xs leading-5 text-zinc-500">
              Câmpurile goale înseamnă „fără țintă impusă": recomandările se
              raportează atunci doar la pragul de echilibru solar, care nu are
              nevoie de nicio setare.
            </p>
          </div>
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Consum specific"
          subtitle="Wh pe kilometru, pe fereastră glisantă"
        >
          <TelemetryChart
            signalKeys={['calc_wh_per_km']}
            source={derivedBuffer}
            extraDefinitions={DERIVED_SIGNALS}
            windowMs={6 * 60_000}
            height={220}
            ariaLabel="Grafic cu consumul specific în timp"
          />
        </Panel>

        <Panel
          title="Cerut față de necesar"
          subtitle="Puterea consumată față de rezistența la înaintare"
        >
          <TelemetryChart
            signalKeys={['calc_consumption_w', 'calc_road_load_w']}
            source={derivedBuffer}
            extraDefinitions={DERIVED_SIGNALS}
            windowMs={6 * 60_000}
            height={220}
            ariaLabel="Grafic cu puterea consumată și rezistența la înaintare"
          />
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Energie: consum, soare, baterie"
          subtitle="Ultimele șapte minute"
        >
          <TelemetryChart
            signalKeys={['battery_power_w', 'solar_power_w', 'motor_power_w']}
            height={220}
            ariaLabel="Grafic cu puterea bateriei, puterea solară și puterea motorului"
          />
        </Panel>

        <Panel
          title="Autonomie și bilanț energetic"
          subtitle="Cum evoluează rezerva"
        >
          <TelemetryChart
            signalKeys={['calc_range_km', 'calc_energy_balance_wh']}
            source={derivedBuffer}
            extraDefinitions={DERIVED_SIGNALS}
            windowMs={6 * 60_000}
            height={220}
            ariaLabel="Grafic cu autonomia estimată și bilanțul energetic"
          />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Panou de consum"
          subtitle="Toate formulele utile pentru optimizare în timpul mersului"
        >
          <ConsumptionPanel />
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)]">
        <Panel
          title="Profil de elevație"
          subtitle="Altitudine față de distanța parcursă"
        >
          <ElevationProfileChart height={220} />
        </Panel>

        <Panel title="Teren" subtitle="Cât din efort este dat de pantă">
          <div className="grid gap-2 sm:grid-cols-2">
            <StatTile
              label="Pantă"
              value={snapshot.gradePct}
              unit="%"
              decimals={1}
              formula="Δaltitudine / Δdistanță"
            />
            <StatTile
              label="Altitudine"
              value={snapshot.altitudeM}
              unit="m"
              decimals={1}
              formula="GNSS, WGS84"
            />
            <StatTile
              label="Urcat cumulat"
              value={snapshot.totals.elevationGainM}
              unit="m"
              decimals={0}
              formula="Σ creșteri peste 0,5 m"
            />
            <StatTile
              label="Coborât cumulat"
              value={snapshot.totals.elevationLossM}
              unit="m"
              decimals={0}
              formula="Σ scăderi peste 0,5 m"
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Fără altitudine validă panta rămâne „—", nu zero: modelul de
            rezistență la înaintare ar minți la fel de tare cu „drum plat" pus
            în locul lui „nu știu".
          </p>
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Termic"
          subtitle="Cât spațiu mai este până la limitarea de putere"
        >
          <ul className="grid gap-2">
            {snapshot.thermal.map((trend) => (
              <li
                key={trend.key}
                className="flex min-h-11 items-center justify-between gap-4 rounded-xl bg-black/15 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-zinc-200">
                    {thermalLabels[trend.key] ?? trend.key}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {trend.ratePerMinC === null
                      ? 'fără tendință calculabilă'
                      : `${formatNumber(trend.ratePerMinC, 2)} °C/min`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold text-zinc-100 tabular-nums">
                    {trend.valueC === null
                      ? NO_VALUE
                      : `${formatNumber(trend.valueC, 1)} °C`}
                  </span>
                  <span className="block text-xs text-zinc-500 tabular-nums">
                    {trend.timeToCritS === null
                      ? 'nu se apropie de prag'
                      : `prag critic în ~${Math.max(1, Math.round(trend.timeToCritS / 60))} min`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <DriverSummary />
      </section>
    </>
  )
}

const thermalLabels: Record<string, string> = {
  motor_temp_c: 'Motor',
  inverter_temp_c: 'Invertor',
  battery_temp_max_c: 'Baterie',
}

/** Cine conduce acum și cum se compară piloții între ei. */
function DriverSummary() {
  const profiles = useDriverStore((state) => state.profiles)
  const stints = useDriverStore((state) => state.stints)
  const activeDriverId = useDriverStore((state) => state.activeDriverId)
  // Cumulul se recalculează din `stints`, la care componenta este deja abonată.
  const aggregate = useDriverStore((state) => state.aggregate)

  const rows = profiles
    .map((profile) => ({ profile, aggregate: aggregate(profile.id) }))
    .filter((row) => row.aggregate.stints > 0)
    .sort((a, b) => {
      const left = a.aggregate.whPerKm ?? Number.POSITIVE_INFINITY
      const right = b.aggregate.whPerKm ?? Number.POSITIVE_INFINITY
      return left - right
    })

  return (
    <Panel
      title="Piloți"
      subtitle={
        stints.length === 0
          ? 'Se completează după primul stint'
          : `${stints.length} stinturi înregistrate`
      }
      bodyClassName="overflow-x-auto"
    >
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Niciun stint încheiat. Consumul pe pilot apare după prima schimbare la
          volan.
        </p>
      ) : (
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
              <th className="pb-2 font-medium">Pilot</th>
              <th className="pb-2 font-medium">Distanță</th>
              <th className="pb-2 font-medium">Consum</th>
              <th className="pb-2 font-medium">Cel mai bun</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {rows.map(({ profile, aggregate }) => (
              <tr key={profile.id} className="border-t border-white/5">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: profile.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium text-white">
                      {profile.name}
                    </span>
                    {profile.id === activeDriverId && (
                      <span className="text-xs text-emerald-300">la volan</span>
                    )}
                  </span>
                </td>
                <td className="py-2 tabular-nums">
                  {formatNumber(aggregate.distanceKm, 1)} km
                </td>
                <td className="py-2 tabular-nums">
                  {aggregate.whPerKm === null
                    ? NO_VALUE
                    : `${formatNumber(aggregate.whPerKm, 1)} Wh/km`}
                </td>
                <td className="py-2 tabular-nums">
                  {aggregate.bestWhPerKm === null
                    ? NO_VALUE
                    : `${formatNumber(aggregate.bestWhPerKm, 1)} Wh/km`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
