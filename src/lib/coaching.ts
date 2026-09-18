import type { AnalyticsSnapshot } from './analytics'
import { formatNumber } from './format'

/**
 * Traducerea statisticilor în instrucțiuni pentru pilot.
 *
 * Un panou cu douăzeci de cifre nu schimbă felul în care merge mașina. „Ridică
 * piciorul cu 6 km/h" îl schimbă. Modulul de față este stratul care transformă
 * mărimile calculate în `lib/analytics.ts` într-un număr mic de propoziții pe
 * care cineva din boxă le poate citi la stație, în ordinea în care contează.
 *
 * Trei reguli de proiectare:
 *
 *  - **Fără date, fără sfaturi.** Cu fluxul căzut, funcția întoarce lista
 *    goală. Un panou care spune „condu mai economic" pe baza ultimei valori de
 *    acum două minute este mai rău decât un panou gol.
 *  - **Fiecare sfat poartă cifra din spate.** Pilotul trebuie să poată verifica
 *    afirmația, nu doar să o creadă.
 *  - **Cel mult un sfat pe cauză.** Consumul mare din cauza vitezei și consumul
 *    mare în general sunt aceeași problemă; se raportează o dată, la cauză.
 */

export type AdviceLevel = 'critical' | 'warning' | 'info' | 'good'

export type Advice = {
  id: string
  level: AdviceLevel
  /** Ce se întâmplă, într-o propoziție scurtă. */
  title: string
  /** De ce, cu cifra care susține afirmația. */
  detail: string
  /** Ce are pilotul de făcut acum. */
  action: string
}

export type CoachingOptions = {
  /** Consumul-țintă al strategiei, în Wh/km. */
  targetWhPerKm?: number | null
  /** Cât mai este de parcurs, în km, dacă strategia îl cunoaște. */
  remainingDistanceKm?: number | null
}

/**
 * Peste atâta din aportul solar, sarcina mașinii nu mai este acoperită de
 * panouri: la 1,5 pachetul dă jumătate din cât dau panourile. Se aplică
 * sarcinii (pachet + solar), nu consumului din pachet, care este deja net.
 */
const SOLAR_DEFICIT_RATIO = 1.5
/** Peste atâta procent din consum dus în aerodinamică, viteza este problema. */
const AERO_DOMINANT_PCT = 60
/** Sub acest scor, pedala este nervoasă. */
const ROUGH_SMOOTHNESS = 55
/** Sub atâtea secunde până la pragul critic, temperatura devine urgentă. */
const THERMAL_URGENT_S = 300
/** Sub acest randament, lanțul electric pierde vizibil. */
const POOR_DRIVETRAIN_PCT = 75
/** Peste atâtea frânări bruște cu recuperare mică, regenerarea e irosită. */
const HARSH_BRAKE_BUDGET = 8
const LOW_REGEN_PCT = 3

const thermalLabels: Record<string, string> = {
  motor_temp_c: 'Motorul',
  inverter_temp_c: 'Invertorul',
  battery_temp_max_c: 'Bateria',
}

function round(value: number, decimals = 1): string {
  return formatNumber(value, decimals)
}

/**
 * Aportul solar pe kilometru la viteza actuală, în Wh/km.
 *
 * `P_solar [W] / v [km/h] = Wh/km`: la 900 W și 45 km/h, panourile aduc
 * 20 Wh/km. Este partea din sarcină pe care o plătește soarele; restul iese
 * din pachet și este exact consumul specific afișat (`energy_consumed_wh` e
 * deja net de solar). Sarcina totală este deci `consum din pachet + aport`.
 */
export function sustainableWhPerKm(
  solarW: number | null,
  speedKph: number | null,
): number | null {
  if (solarW === null || speedKph === null) return null
  if (!Number.isFinite(solarW) || !Number.isFinite(speedKph)) return null
  if (speedKph <= 1) return null
  return solarW / speedKph
}

export function buildAdvice(
  snapshot: AnalyticsSnapshot,
  options: CoachingOptions = {},
): Advice[] {
  // Fără flux nu avem ce recomanda. Vezi nota din capul fișierului.
  if (!snapshot.live) return []

  const advice: Advice[] = []

  const speedKph =
    snapshot.averageSpeedKph !== null && snapshot.totals.samples > 0
      ? snapshot.averageSpeedKph
      : null
  const consumption = snapshot.recentWhPerKm ?? snapshot.whPerKm
  const sustainable = sustainableWhPerKm(snapshot.solarW, speedKph)
  const target = options.targetWhPerKm ?? null

  // --- 1. autonomia nu acoperă distanța rămasă -----------------------------
  const remaining = options.remainingDistanceKm ?? null
  if (
    remaining !== null &&
    snapshot.rangeKm !== null &&
    snapshot.rangeKm < remaining
  ) {
    const deficit = remaining - snapshot.rangeKm
    advice.push({
      id: 'range-short',
      level: 'critical',
      title: 'Energia nu ajunge până la final',
      detail: `Autonomia estimată este ${round(snapshot.rangeKm)} km, dar mai sunt ${round(remaining)} km — lipsesc ${round(deficit)} km.`,
      action:
        'Coboară viteza cu 8–10 km/h și menține-o constantă; la viteză mai mică autonomia crește mai repede decât scade timpul.',
    })
  }

  // --- 2. bateria se golește prea repede -----------------------------------
  if (
    snapshot.projectedSoc30MinPct !== null &&
    snapshot.projectedSoc30MinPct < 10 &&
    snapshot.socRatePctPerMin !== null &&
    snapshot.socRatePctPerMin < 0
  ) {
    advice.push({
      id: 'soc-drop',
      level: 'critical',
      title: 'Bateria scade prea repede',
      detail: `La ritmul actual (${round(snapshot.socRatePctPerMin, 2)} %/min), în 30 de minute rămân ${round(snapshot.projectedSoc30MinPct)} %.`,
      action:
        'Redu imediat puterea cerută: mai puțină accelerație, viteză constantă, fără reprize.',
    })
  }

  // --- 3. sarcina depășește cu mult ce produc panourile --------------------
  // `consumption` este ce iese din pachet, adică sarcina fără partea plătită
  // de soare. Sarcina întreagă este suma celor două; pragul se pune pe ea.
  const load =
    consumption !== null && sustainable !== null
      ? consumption + sustainable
      : null
  const deficitRule =
    load !== null &&
    sustainable !== null &&
    load > sustainable * SOLAR_DEFICIT_RATIO

  if (deficitRule) {
    const excess = ((load as number) / (sustainable as number) - 1) * 100
    advice.push({
      id: 'energy-deficit',
      level: 'warning',
      title: 'Consumi mai mult decât produc panourile',
      detail: `Sarcina este ${round(load as number)} Wh/km, din care soarele aduce ${round(sustainable as number)} Wh/km și pachetul ${round(consumption as number)} Wh/km — cu ${round(excess, 0)} % peste echilibru.`,
      action:
        'Condu mai economic: ridică piciorul pe porțiunile drepte și lasă mașina să ruleze liber înainte de viraje.',
    })
  } else if (
    target !== null &&
    consumption !== null &&
    consumption > target * 1.1
  ) {
    advice.push({
      id: 'over-target',
      level: 'warning',
      title: 'Consum peste ținta de strategie',
      detail: `${round(consumption)} Wh/km față de ținta de ${round(target)} Wh/km.`,
      action:
        'Redu viteza cu 5 km/h și verifică dacă revii sub țintă în următorul minut.',
    })
  }

  // --- 4. viteza, nu masa, este cauza consumului ---------------------------
  if (
    snapshot.aeroSharePct !== null &&
    snapshot.aeroSharePct > AERO_DOMINANT_PCT &&
    snapshot.economicSpeedKph !== null &&
    speedKph !== null &&
    speedKph > snapshot.economicSpeedKph
  ) {
    advice.push({
      id: 'aero-dominant',
      level: 'info',
      title: 'Aerodinamica domină consumul',
      detail: `${round(snapshot.aeroSharePct, 0)} % din rezistența la înaintare este aer. Puterea aerodinamică crește cu cubul vitezei.`,
      action: `Fiecare km/h scăzut se plătește imediat. Viteza cea mai eficientă pentru mașina asta este în jur de ${round(snapshot.economicSpeedKph)} km/h.`,
    })
  }

  // --- 5. frânări bruște cu recuperare mică --------------------------------
  if (
    snapshot.totals.harshBrakeCount > HARSH_BRAKE_BUDGET &&
    (snapshot.regenRatioPct === null || snapshot.regenRatioPct < LOW_REGEN_PCT)
  ) {
    advice.push({
      id: 'regen-unused',
      level: 'warning',
      title: 'Frânezi fără să recuperezi',
      detail:
        snapshot.regenRatioPct === null
          ? `${snapshot.totals.harshBrakeCount} frânări bruște, fără nicio energie măsurată înapoi în pachet.`
          : `${snapshot.totals.harshBrakeCount} frânări bruște, dar doar ${round(snapshot.regenRatioPct)} % din energie s-a întors în pachet.`,
      action:
        'Ridică piciorul mai devreme și lasă frâna regenerativă să încetinească mașina; frâna mecanică transformă energia în căldură, definitiv.',
    })
  }

  // --- 6. pedala nervoasă ---------------------------------------------------
  if (
    snapshot.smoothnessScore !== null &&
    snapshot.smoothnessScore < ROUGH_SMOOTHNESS
  ) {
    advice.push({
      id: 'rough-throttle',
      level: 'info',
      title: 'Accelerație în trepte',
      detail: `Scorul de linearitate este ${round(snapshot.smoothnessScore, 0)} din 100.`,
      action:
        'Menține pedala într-o poziție fixă și corectează viteza din unghiul de intrare în viraj, nu din accelerație.',
    })
  }

  // --- 7. temperaturi care urcă spre limită --------------------------------
  for (const trend of snapshot.thermal) {
    if (trend.timeToCritS === null || trend.timeToCritS > THERMAL_URGENT_S) {
      continue
    }
    // `timeToCritS` există doar cu valoare și rată calculate; cifrele de mai
    // jos nu pot lipsi, dar nici nu se inventează cu zero dacă ar lipsi.
    if (trend.valueC === null || trend.ratePerMinC === null) continue
    const minutes = Math.max(1, Math.round(trend.timeToCritS / 60))
    advice.push({
      id: `thermal-${trend.key}`,
      level: 'warning',
      title: `${thermalLabels[trend.key] ?? trend.key} se apropie de limită`,
      detail: `${round(trend.valueC)} °C, în creștere cu ${round(trend.ratePerMinC, 2)} °C/min — pragul critic în ~${minutes} min.`,
      action:
        'Redu puterea cerută acum. Controllerul limitează singur când atinge pragul, și o face brusc.',
    })
  }

  // --- 8. pierderi în lanțul electric --------------------------------------
  if (
    snapshot.drivetrainEfficiencyPct !== null &&
    snapshot.drivetrainEfficiencyPct < POOR_DRIVETRAIN_PCT
  ) {
    advice.push({
      id: 'drivetrain-loss',
      level: 'info',
      title: 'Pierderi mari între pachet și motor',
      detail: `Doar ${round(snapshot.drivetrainEfficiencyPct, 0)} % din puterea de pe magistrală (pachet plus solar) ajunge la motor.`,
      action:
        'De verificat la prima oprire: conectori calzi, cabluri de putere, temperatura invertorului.',
    })
  }

  if (advice.length > 0) return advice

  // --- nimic de corectat ----------------------------------------------------
  if (consumption !== null) {
    let detail = `Consum din pachet ${round(consumption)} Wh/km, fără abateri detectate.`
    if (sustainable !== null) {
      detail = `Consum din pachet ${round(consumption)} Wh/km; soarele aduce ${round(sustainable)} Wh/km din sarcina de ${round(consumption + sustainable)} Wh/km.`
    } else if (target !== null) {
      detail = `Consum din pachet ${round(consumption)} Wh/km, sub ținta de ${round(target)} Wh/km.`
    }
    return [
      {
        id: 'on-target',
        level: 'good',
        title: 'Ritm eficient — menține-l',
        detail,
        action: 'Nu schimba nimic: aceeași viteză, aceeași pedală.',
      },
    ]
  }

  return [
    {
      id: 'warming-up',
      level: 'info',
      title: 'Se strâng date',
      detail:
        'Consumul specific are nevoie de câteva sute de metri parcurși ca să fie o cifră reală.',
      action: 'Continuă; primele recomandări apar după primul tronson.',
    },
  ]
}

/** Cel mai grav sfat din listă — cel afișat mare, pe banda de sus. */
export function primaryAdvice(advice: Advice[]): Advice | null {
  const order: Record<AdviceLevel, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    good: 3,
  }
  return [...advice].sort((a, b) => order[a.level] - order[b.level])[0] ?? null
}
