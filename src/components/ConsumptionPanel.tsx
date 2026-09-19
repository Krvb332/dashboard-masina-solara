import { formatDuration, formatNumber } from '../lib/format'
import {
  PACK_POWER_KNEE_W,
  compressPackPowerW,
  isPackPowerCompressed,
} from '../lib/power-scale'
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

/**
 * Explicația de sub „Putere din pachet". Peste pragul de compresie spune și
 * valoarea măsurată, altfel cifra afișată ar fi singura vizibilă nicăieri.
 */
function packPowerHint(measuredW: number | null): string {
  const base =
    'Puterea netă scoasă din pachet acum, după aportul solar. Pozitivă la descărcare.'
  if (!isPackPowerCompressed(measuredW)) return base
  return `${base} Afișare comprimată peste ${formatNumber(PACK_POWER_KNEE_W, 0)} W; măsurat ${formatNumber(measuredW as number, 0)} W.`
}

export function ConsumptionPanel() {
  const snapshot = useAnalyticsStore((state) => state.snapshot)
  const { totals } = snapshot
  const cutoff = snapshot.motorCutoffSocPct

  return (
    <div className="@container grid gap-4">
      <Section title="Acum, în mașină">
        <StatTile
          label="Putere din pachet"
          value={compressPackPowerW(snapshot.packPowerW)}
          unit="W"
          decimals={0}
          formula="P_baterie (sau U · I)"
          hint={packPowerHint(snapshot.packPowerW)}
          // Tonul rămâne pe valoarea măsurată: compresia este de afișare, nu de
          // avertizare. Un consum real de 6 kW trebuie să fie tot roșu, chiar
          // dacă cifra de pe placă scrie 3 995 W.
          tone={toneAbove(snapshot.packPowerW, 3000, 6000)}
        />
        <StatTile
          label="Recuperare regenerativă"
          value={snapshot.regenW}
          unit="W"
          decimals={0}
          formula="P_regen raportată (sau max(0, −P_motor))"
          hint="Puterea întoarsă acum în pachet de frâna regenerativă."
          tone={
            snapshot.regenW !== null && snapshot.regenW > 0 ? 'good' : 'neutral'
          }
        />
        <StatTile
          label="Putere solară"
          value={snapshot.solarW}
          unit="W"
          decimals={0}
          formula="solar_power_w (Σ MPPT în verificarea mapării)"
          tone="good"
        />
        <StatTile
          label="Bilanț de putere"
          value={snapshot.netPowerW}
          unit="W"
          decimals={0}
          formula="P_solar − P_sarcină = −P_baterie"
          hint="Pozitiv: pachetul se încarcă în mers. Solarul este deja scăzut în puterea din pachet, nu se mai scade o dată."
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
          label="Consum din pachet (2 min)"
          value={snapshot.recentWhPerKm}
          unit="Wh/km"
          decimals={1}
          formula="ΔE_pachet / Δd, fereastră 2 min"
          hint="Reacționează la stilul de condus în câteva zeci de secunde. Energia scoasă din pachet pe kilometru, după aportul solar."
          tone={toneAbove(snapshot.recentWhPerKm, 25, 40)}
        />
        <StatTile
          label="Consum din pachet (sesiune)"
          value={snapshot.whPerKm}
          unit="Wh/km"
          decimals={1}
          formula="E_pachet / d_total"
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
          label="Vârf putere din pachet (P95)"
          value={snapshot.peakPackPowerW}
          unit="W"
          decimals={0}
          formula="percentila 95 a P_baterie pe 2 min"
          hint="Cât scoate mașina din pachet în vârfuri, fără ca un eșantion aberant să dicteze cifra."
        />
      </Section>

      <Section title="Unde se duce puterea">
        <StatTile
          label="Rezistență la înaintare"
          value={snapshot.roadLoadW}
          unit="W"
          decimals={0}
          formula="(Crr·m·g·v + ½ρCdA·v³ + m·g·v·sinθ)/η + P_aux"
          hint={
            'Puterea teoretic necesară la viteza și panta actuale (aer standard, 1,2 kg/m³). Rămâne „—" fără o pantă validă din altitudine.'
          }
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
          label="Viteză economică (aer standard)"
          value={snapshot.economicSpeedKph}
          unit="km/h"
          decimals={1}
          formula="v = ∛(η·P_aux / (ρ·CdA))"
          hint="Viteza la care energia pe kilometru este minimă, cu ρ = 1,2 kg/m³. Pagina Vreme o recalculează cu densitatea măsurată."
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
          label="Energie utilizabilă"
          value={snapshot.usableWh}
          unit="Wh"
          decimals={0}
          formula={`(SOC − ${cutoff} %) · E_pachet`}
          hint={`Controllerul motorului se oprește la ${cutoff} % SOC; energia de sub prag rămâne în pachet, dar nu mai mișcă mașina.`}
          tone={toneBelow(snapshot.usableWh, 700, 350)}
        />
        <StatTile
          label="Energie totală în pachet"
          value={snapshot.remainingWh}
          unit="Wh"
          decimals={0}
          formula="SOC · E_pachet"
          hint="Inclusiv partea de sub pragul de oprire, care nu se poate folosi pentru mers."
        />
        <StatTile
          label="Autonomie"
          value={snapshot.rangeKm}
          unit="km"
          decimals={1}
          formula="E_utilizabilă / consum din pachet"
          hint={`Până la oprirea controllerului motorului, la ${cutoff} % SOC.`}
        />
        <StatTile
          label="Timp până la oprirea motorului"
          value={
            snapshot.timeToCutoffS === null ? null : snapshot.timeToCutoffS / 60
          }
          unit="min"
          decimals={0}
          formula="E_utilizabilă / P_baterie"
          hint={
            snapshot.timeToCutoffS === null
              ? 'Pachetul nu se descarcă acum (sau nu există putere de pachet validă).'
              : `${formatDuration(snapshot.timeToCutoffS)} până la ${cutoff} % SOC`
          }
        />
        <StatTile
          label="SOC peste 30 min"
          value={snapshot.projectedSoc30MinPct}
          unit="%"
          decimals={1}
          formula="SOC + rată · 30"
          hint={`Sub ${cutoff} % controllerul motorului se oprește.`}
          tone={toneBelow(
            snapshot.projectedSoc30MinPct,
            cutoff + 10,
            cutoff + 3,
          )}
        />
        <StatTile
          label="Variație SOC"
          value={snapshot.socRatePctPerMin}
          unit="%/min"
          decimals={2}
          formula="panta SOC pe 2 min"
          hint="Negativ = pachetul se descarcă, pozitiv = se încarcă."
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
          label="Bilanț pachet"
          value={totals.samples > 0 ? snapshot.packBalanceWh : null}
          unit="Wh"
          decimals={0}
          formula="E_intrat − E_ieșit din pachet"
          hint="Ce a intrat în pachet (regenerare și surplus solar) minus ce a ieșit. Solarul consumat direct de motor nu trece prin pachet."
          tone={
            totals.samples > 0 && snapshot.packBalanceWh >= 0 ? 'good' : 'warn'
          }
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
          label="Energie ieșită din pachet"
          value={totals.energyConsumedWh}
          unit="Wh"
          decimals={0}
          formula="contor BMS sau ∫max(0, P_baterie) dt"
        />
        <StatTile
          label="Energie intrată în pachet"
          value={totals.energyRegenWh}
          unit="Wh"
          decimals={0}
          formula="contor BMS sau ∫ max(0, −P) dt"
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
          label="Recuperat din ce a ieșit"
          value={snapshot.regenRatioPct}
          unit="%"
          decimals={1}
          formula="E_intrat / E_ieșit"
          tone={toneBelow(snapshot.regenRatioPct, 3, 1)}
        />
        <StatTile
          label="Acoperit de soare"
          value={snapshot.solarFractionPct}
          unit="%"
          decimals={0}
          formula="E_solar / E_sarcină"
          hint="Raportat la sarcina totală (motor), nu la ce a ieșit din pachet."
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
