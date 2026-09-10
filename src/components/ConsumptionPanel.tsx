import { formatDuration } from '../lib/format'
import { useAnalyticsStore } from '../stores/analytics-store'
import { StatTile } from './StatTile'
import { toneAbove, toneBelow } from '../lib/stat-tone'

/**
 * Panoul de consum: toate mărimile utile pentru optimizare în timp ce mașina
 * merge, fiecare cu formula din care iese.
 *
 * Împărțit pe întrebările care se pun efectiv în boxă:
 *
 *  1. cât consumăm și cât recuperăm chiar acum;
 *  2. cât ne costă un kilometru și cât mai avem;
 *  3. de ce costă atât — unde se duce puterea;
 *  4. ce ne spune bateria despre restul cursei.
 *
 * Cifrele care nu se pot calcula rămân „—". Contoarele cumulate rămân `0`,
 * fiindcă zero este exact ce s-a acumulat.
 */

export function ConsumptionPanel() {
  const snapshot = useAnalyticsStore((state) => state.snapshot)
  const { totals } = snapshot

  return (
    <div className="@container grid gap-4">
      <Section title="Acum, în mașină">
        <StatTile
          label="Consum instantaneu"
          value={snapshot.consumptionW}
          unit="W"
          decimals={0}
          formula="P = U · I"
          hint="Puterea scoasă din pachet în acest moment."
          tone={toneAbove(snapshot.consumptionW, 3000, 6000)}
        />
        <StatTile
          label="Recuperare regenerativă"
          value={snapshot.regenW}
          unit="W"
          decimals={0}
          formula="P_regen = max(0, −P_motor)"
          hint="Putere întoarsă în pachet. Numeric, W și Wh/h sunt același lucru."
          tone={
            snapshot.regenW !== null && snapshot.regenW > 0 ? 'good' : 'neutral'
          }
        />
        <StatTile
          label="Putere solară"
          value={snapshot.solarW}
          unit="W"
          decimals={0}
          formula="Σ MPPT"
          tone="good"
        />
        <StatTile
          label="Bilanț de putere"
          value={snapshot.netPowerW}
          unit="W"
          decimals={0}
          formula="P_net = P_solar − P_consum"
          hint="Pozitiv: pachetul se încarcă în mers."
          tone={
            snapshot.netPowerW === null
              ? 'neutral'
              : snapshot.netPowerW >= 0
                ? 'good'
                : 'warn'
          }
        />
      </Section>

      <Section title="Cât costă un kilometru">
        <StatTile
          label="Consum specific (recent)"
          value={snapshot.recentWhPerKm}
          unit="Wh/km"
          decimals={1}
          formula="ΔE / Δd, fereastră 2 min"
          hint="Reacționează la stilul de condus în câteva zeci de secunde."
          tone={toneAbove(snapshot.recentWhPerKm, 25, 40)}
        />
        <StatTile
          label="Consum specific (sesiune)"
          value={snapshot.whPerKm}
          unit="Wh/km"
          decimals={1}
          formula="E_total / d_total"
          tone={toneAbove(snapshot.whPerKm, 25, 40)}
        />
        <StatTile
          label="Eficiență"
          value={snapshot.kmPerKwh}
          unit="km/kWh"
          decimals={2}
          formula="d / (E / 1000)"
          tone={toneBelow(snapshot.kmPerKwh, 40, 25)}
        />
        <StatTile
          label="Vârf de consum (P95)"
          value={snapshot.peakConsumptionW}
          unit="W"
          decimals={0}
          formula="percentila 95 pe 2 min"
          hint="Cât cere mașina în vârfuri, fără ca un eșantion aberant să dicteze cifra."
        />
      </Section>

      <Section title="Unde se duce puterea">
        <StatTile
          label="Rezistență la înaintare"
          value={snapshot.roadLoadW}
          unit="W"
          decimals={0}
          formula="(Crr·m·g·v + ½ρCdA·v³ + m·g·v·sinθ)/η + P_aux"
          hint="Puterea teoretic necesară la viteza și panta actuale."
        />
        <StatTile
          label="Pondere aerodinamică"
          value={snapshot.aeroSharePct}
          unit="%"
          decimals={0}
          formula="P_aero / (P_aero + P_rulare)"
          hint="Peste 60 % problema este viteza, nu masa."
          tone={toneAbove(snapshot.aeroSharePct, 60, 80)}
        />
        <StatTile
          label="Viteză economică"
          value={snapshot.economicSpeedKph}
          unit="km/h"
          decimals={1}
          formula="v = ∛(P_aux / (ρ·CdA))"
          hint="Viteza la care energia pe kilometru este minimă."
        />
        <StatTile
          label="Randament lanț electric"
          value={snapshot.drivetrainEfficiencyPct}
          unit="%"
          decimals={0}
          formula="P_motor / (P_baterie + P_solar)"
          hint="Restul până la 100 % este electronica de bord plus pierderile pe cabluri și în invertor."
          tone={toneBelow(snapshot.drivetrainEfficiencyPct, 82, 75)}
        />
      </Section>

      <Section title="Bateria și restul cursei">
        <StatTile
          label="Energie rămasă"
          value={snapshot.remainingWh}
          unit="Wh"
          decimals={0}
          formula="SOC% · E_pachet"
          tone={toneBelow(snapshot.remainingWh, 1250, 750)}
        />
        <StatTile
          label="Autonomie"
          value={snapshot.rangeKm}
          unit="km"
          decimals={1}
          formula="E_rămasă / consum specific"
        />
        <StatTile
          label="Timp până la golire"
          value={
            snapshot.timeToEmptyS === null ? null : snapshot.timeToEmptyS / 60
          }
          unit="min"
          decimals={0}
          formula="E_rămasă / P_net"
          hint={
            snapshot.timeToEmptyS === null
              ? 'Cu bilanț pozitiv pachetul nu se golește.'
              : formatDuration(snapshot.timeToEmptyS)
          }
        />
        <StatTile
          label="SOC peste 30 min"
          value={snapshot.projectedSoc30MinPct}
          unit="%"
          decimals={1}
          formula="SOC + rată · 30"
          tone={toneBelow(snapshot.projectedSoc30MinPct, 25, 12)}
        />
        <StatTile
          label="Rată de descărcare"
          value={snapshot.socRatePctPerMin}
          unit="%/min"
          decimals={2}
          formula="panta SOC pe 2 min"
        />
        <StatTile
          label="Rată de curent"
          value={snapshot.cRate}
          unit="C"
          decimals={2}
          formula="|I| / capacitate"
          tone={toneAbove(snapshot.cRate, 1.5, 2.5)}
        />
        <StatTile
          label="Rezistență internă"
          value={
            snapshot.packResistanceOhm === null
              ? null
              : snapshot.packResistanceOhm * 1000
          }
          unit="mΩ"
          decimals={1}
          formula="R = −panta(U față de I)"
          hint="Creșterea ei în cursă arată o celulă sau un conector care cedează."
        />
        <StatTile
          label="Bilanț energetic"
          value={totals.samples > 0 ? snapshot.energyBalanceWh : null}
          unit="Wh"
          decimals={0}
          formula="E_solar + E_regen − E_consumat"
          tone={snapshot.energyBalanceWh >= 0 ? 'good' : 'warn'}
        />
      </Section>

      <Section title="Cumulat pe sesiune">
        <StatTile
          label="Distanță"
          value={totals.distanceKm}
          unit="km"
          decimals={2}
          formula="contor mașină sau ∫v dt"
        />
        <StatTile
          label="Energie consumată"
          value={totals.energyConsumedWh}
          unit="Wh"
          decimals={0}
          formula="contor BMS sau ∫P dt"
        />
        <StatTile
          label="Energie regenerată"
          value={totals.energyRegenWh}
          unit="Wh"
          decimals={0}
          formula="∫ max(0, −P) dt"
          tone="good"
        />
        <StatTile
          label="Energie solară"
          value={totals.energySolarWh}
          unit="Wh"
          decimals={0}
          formula="∫P_solar dt"
          tone="good"
        />
        <StatTile
          label="Recuperat din consum"
          value={snapshot.regenRatioPct}
          unit="%"
          decimals={1}
          formula="E_regen / E_consumat"
          tone={toneBelow(snapshot.regenRatioPct, 3, 1)}
        />
        <StatTile
          label="Acoperit de soare"
          value={snapshot.solarFractionPct}
          unit="%"
          decimals={0}
          formula="E_solar / E_consumat"
          tone={toneBelow(snapshot.solarFractionPct, 60, 30)}
        />
        <StatTile
          label="Timp cu date"
          value={totals.activeSeconds / 60}
          unit="min"
          decimals={1}
          formula="numai eșantioane valide"
          hint="Tăcerea de pe legătură nu este numărată ca timp de mers."
        />
        <StatTile
          label="Viteză maximă"
          value={totals.maxSpeedKph}
          unit="km/h"
          decimals={1}
          formula="max(v)"
        />
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-xs font-medium tracking-[0.16em] text-zinc-500 uppercase">
        {title}
      </h3>
      <div className="grid gap-2 @sm:grid-cols-2 @3xl:grid-cols-4">
        {children}
      </div>
    </section>
  )
}
