import { DriverPanel } from '../../components/DriverPanel'
import { Panel } from '../../components/Panel'
import { StatTile } from '../../components/StatTile'
import { isMemoryOnly } from '../../lib/safe-storage'
import { useAnalyticsStore } from '../../stores/analytics-store'
import { useDriverStore } from '../../stores/driver-store'

/**
 * Piloții: cine urcă la volan, cine a condus și cu ce consum.
 *
 * Pagina are și rolul de a arăta *stintul în curs* separat de istoric: în timpul
 * cursei, cifra care contează este cât a consumat pilotul de la ultima
 * schimbare, nu media zilei.
 */
export function DriversPage() {
  const stints = useDriverStore((state) => state.stints)
  const activeStintId = useDriverStore((state) => state.activeStintId)
  const activeDriverId = useDriverStore((state) => state.activeDriverId)
  const profiles = useDriverStore((state) => state.profiles)
  const live = useAnalyticsStore((state) => state.snapshot.live)

  const stint = stints.find((entry) => entry.id === activeStintId) ?? null
  const driver =
    profiles.find((profile) => profile.id === activeDriverId) ?? null

  return (
    <>
      <section className="mt-7">
        <Panel
          title="Stint în curs"
          subtitle={
            driver === null
              ? 'Nimeni la volan'
              : `${driver.name}${live ? '' : ' · fără date de la mașină'}`
          }
        >
          {stint === null ? (
            <p className="text-sm text-zinc-500">
              Niciun stint deschis. Se deschide unul automat la primul flux de
              date sau când alegi un pilot din antet.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Distanță"
                value={stint.summary.distanceKm}
                unit="km"
                decimals={2}
                formula="contor de la urcarea la volan"
              />
              <StatTile
                label="Energie"
                value={stint.summary.energyConsumedWh}
                unit="Wh"
                decimals={0}
                formula="ΔE față de linia de bază"
              />
              <StatTile
                label="Consum"
                value={stint.summary.whPerKm}
                unit="Wh/km"
                decimals={1}
                formula="ΔE / Δd"
              />
              <StatTile
                label="Viteză medie"
                value={stint.summary.averageSpeedKph}
                unit="km/h"
                decimals={1}
                formula="Δd / timp cu date"
                hint="Împărțit la secundele cu telemetrie proaspătă, nu la durata stintului."
              />
              <StatTile
                label="Intrat în pachet"
                value={stint.summary.energyRegenWh}
                unit="Wh"
                decimals={0}
                formula="ΔE_intrat (regenerare și surplus solar)"
                tone={stint.summary.energyRegenWh > 0 ? 'good' : 'neutral'}
              />
              <StatTile
                label="Solar"
                value={stint.summary.energySolarWh}
                unit="Wh"
                decimals={0}
                formula="ΔE_solar"
                tone={stint.summary.energySolarWh > 0 ? 'good' : 'neutral'}
              />
              <StatTile
                label="Accelerări bruște"
                value={stint.summary.harshAccelCount}
                decimals={0}
                formula="a > 1,2 m/s²"
              />
              <StatTile
                label="Frânări bruște"
                value={stint.summary.harshBrakeCount}
                decimals={0}
                formula="a < −2,0 m/s²"
              />
            </div>
          )}
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Profiluri"
          subtitle="Creare manuală, creare în masă și schimbarea pilotului"
        >
          <DriverPanel />
        </Panel>
      </section>

      {isMemoryOnly() && (
        <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-100">
          Browserul nu permite stocare locală, deci piloții și stinturile se
          pierd la reîncărcarea paginii. Totul funcționează în sesiunea curentă;
          exportă înainte să închizi fila.
        </p>
      )}
    </>
  )
}
