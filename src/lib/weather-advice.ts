import type { WeatherReport } from '../schemas/weather'
import type { Advice } from './coaching'
import type { WeatherImpact } from './weather-impact'

/**
 * Vremea tradusă în ce are pilotul de făcut.
 *
 * Aceleași trei reguli ca la `lib/coaching.ts`, pentru că panoul le afișează
 * împreună și ar fi absurd ca jumătate din sfaturi să se poarte altfel:
 *
 *  - **Fără date, fără sfaturi.** Un raport `unavailable` produce listă goală.
 *  - **Fiecare sfat poartă cifra din spate.** „Vânt de față 18 km/h, te costă
 *    210 W" se poate verifica; „e vânt" nu.
 *  - **Cel mult un sfat pe cauză.** Vântul de față și consumul crescut din
 *    cauza lui sunt același lucru, raportat o dată.
 *
 * Strategia de viteză pe vânt este cea clasică din cursele solare, și merită
 * spus de ce: puterea aerodinamică depinde de pătratul vitezei aerului, dar
 * energia pe kilometru depinde de cât timp stai în acel aer. Pe vânt de față
 * este mai ieftin să încetinești puțin și să lași vântul să treacă; pe vânt din
 * spate, kilometrii sunt ieftini și merită luați acum.
 */

/** Peste atâția km/h, componenta frontală a vântului schimbă planul de viteză. */
const WIND_RELEVANT_KPH = 8
/** Sub această viteză mașina nu merge, iar vântul frontal nu costă nimic. */
const MOVING_KPH = 5
/** Peste atâția wați, vântul merită anunțat pe radio. */
const WIND_PENALTY_W = 60
/** Peste atâția km/h lateral, stabilitatea unei caroserii ușoare devine problemă. */
const CROSSWIND_KPH = 25
/** Rafale cu atât peste vântul constant înseamnă aer instabil. */
const GUST_SPREAD_KPH = 15
/** Peste atâta nebulozitate, aportul solar se prăbușește vizibil. */
const CLOUD_HEAVY_PCT = 70
/** Sub atâtea grade deasupra orizontului, soarele nu mai produce util. */
const SUN_LOW_DEG = 10
/** Peste atâta probabilitate, ploaia intră în plan. */
const RAIN_LIKELY_PCT = 50
const THUNDER_PCT = 30
/** Sub atâtea grade diferență temperatură - punct de rouă, apare condensul. */
const FOG_SPREAD_C = 2.5
/** Peste acest indice de căldură, pilotul se deshidratează vizibil. */
const HEAT_STRESS_C = 32
const HEAT_SEVERE_C = 38
/** Sub atâția km vizibilitate, viteza trebuie adaptată. */
const VISIBILITY_KM = 2
/** Peste acest indice UV, expunerea prelungită arde pielea în sub 20 de minute. */
const UV_HIGH = 8
/** Peste atâtea procente pierdere termică, panourile merită menționate. */
const PV_LOSS_PCT = 8

function round(value: number, decimals = 0): string {
  return value.toFixed(decimals).replace('.', ',')
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export type WeatherAdviceInput = {
  report: WeatherReport
  impact: WeatherImpact
  /** Viteza la sol, km/h. Fără ea, sfaturile despre vânt nu au cifră. */
  speedKph: number | null
}

/**
 * Sfaturile care ies din condițiile meteo actuale.
 *
 * Lista este deja ordonată după gravitate; `primaryAdvice` din `coaching.ts`
 * alege oricum primul, dar ordinea contează pentru panoul care le listează.
 */
export function weatherAdvice(input: WeatherAdviceInput): Advice[] {
  const { report, impact, speedKph } = input
  if (report.status === 'unavailable' || report.current === null) return []

  const values = report.current.values
  const advice: Advice[] = []

  // --- siguranță -------------------------------------------------------

  if (
    finite(values.thunderstorm_probability_pct) &&
    values.thunderstorm_probability_pct >= THUNDER_PCT
  ) {
    advice.push({
      id: 'weather-thunderstorm',
      level: 'critical',
      title: 'Risc de furtună',
      detail: `Probabilitate de descărcări electrice ${round(values.thunderstorm_probability_pct)} %.`,
      action: 'Pregătește intrarea în boxe. Nu rămâne pe traseu deschis.',
    })
  }

  if (finite(impact.dewPointSpreadC) && impact.dewPointSpreadC < FOG_SPREAD_C) {
    advice.push({
      id: 'weather-fog',
      level: 'warning',
      title: 'Condens și ceață',
      detail: `Temperatura este la ${round(impact.dewPointSpreadC, 1)} °C de punctul de rouă.`,
      action:
        'Aerisește habitaclul înainte să se aburească parbrizul. Mărește distanțele.',
    })
  }

  if (finite(values.visibility_km) && values.visibility_km < VISIBILITY_KM) {
    advice.push({
      id: 'weather-visibility',
      level: 'warning',
      title: 'Vizibilitate redusă',
      detail: `Vizibilitate ${round(values.visibility_km, 1)} km.`,
      action:
        'Aprinde luminile și coboară viteza sub ce poți opri în câmpul vizual.',
    })
  }

  const rainNow = finite(values.precipitation_mm) && values.precipitation_mm > 0
  const rainLikely =
    finite(values.precipitation_probability_pct) &&
    values.precipitation_probability_pct >= RAIN_LIKELY_PCT

  if (rainNow || rainLikely) {
    advice.push({
      id: 'weather-rain',
      level: rainNow ? 'warning' : 'info',
      title: rainNow ? 'Plouă pe traseu' : 'Ploaie probabilă',
      detail: rainNow
        ? `${round(values.precipitation_mm as number, 1)} mm în ultima oră.`
        : `Probabilitate de precipitații ${round(values.precipitation_probability_pct as number)} %.`,
      action:
        'Frânează mai devreme și mai lin. Pe umed, frâna regenerativă poate bloca roata motoare.',
    })
  }

  if (finite(values.heat_index_c) && values.heat_index_c >= HEAT_STRESS_C) {
    advice.push({
      id: 'weather-heat',
      level: values.heat_index_c >= HEAT_SEVERE_C ? 'critical' : 'warning',
      title: 'Stres termic pentru pilot',
      detail: `Temperatura resimțită ${round(values.heat_index_c, 1)} °C.`,
      action:
        values.heat_index_c >= HEAT_SEVERE_C
          ? 'Programează schimbul de pilot mai devreme. Hidratare la fiecare oprire.'
          : 'Bea apă la fiecare tur de boxe și verifică ventilația habitaclului.',
    })
  }

  // --- vânt -------------------------------------------------------------

  if (
    finite(impact.crosswindKph) &&
    Math.abs(impact.crosswindKph) >= CROSSWIND_KPH
  ) {
    advice.push({
      id: 'weather-crosswind',
      level: 'warning',
      title: 'Vânt lateral puternic',
      detail: `${round(Math.abs(impact.crosswindKph))} km/h din ${impact.crosswindKph > 0 ? 'dreapta' : 'stânga'}.`,
      action:
        'Ține volanul ferm la ieșirea din porțiunile adăpostite. Evită corecțiile bruște.',
    })
  } else if (
    finite(impact.gustSpreadKph) &&
    impact.gustSpreadKph >= GUST_SPREAD_KPH
  ) {
    advice.push({
      id: 'weather-gusts',
      level: 'info',
      title: 'Rafale neregulate',
      detail: `Rafalele depășesc vântul constant cu ${round(impact.gustSpreadKph)} km/h.`,
      action:
        'Așteaptă-te la smucituri laterale. Nu urmări perfect traiectoria pe vânt.',
    })
  }

  const moving = finite(speedKph) && speedKph >= MOVING_KPH

  // Vântul frontal este o veste doar pentru o mașină care merge: oprită în
  // boxe, aceleași 20 km/h nu costă și nu economisesc nimic.
  if (
    moving &&
    finite(impact.headwindKph) &&
    Math.abs(impact.headwindKph) >= WIND_RELEVANT_KPH
  ) {
    const penalty = impact.windPenaltyW
    const headwind = impact.headwindKph
    const hasPenalty = finite(penalty) && Math.abs(penalty) >= WIND_PENALTY_W

    if (headwind > 0) {
      advice.push({
        id: 'weather-headwind',
        level: hasPenalty ? 'warning' : 'info',
        title: 'Vânt din față',
        detail: hasPenalty
          ? `${round(headwind)} km/h frontal — aerodinamic te costă ${round(penalty as number)} W în plus.`
          : `${round(headwind)} km/h frontal; mașina „vede" ${round(impact.apparentAirSpeedKph ?? 0)} km/h de aer.`,
        action:
          'Coboară puțin viteza pe porțiunea cu vânt: pierzi mai puțin decât câștigi din rezistență.',
      })
    } else {
      advice.push({
        id: 'weather-tailwind',
        level: 'good',
        title: 'Vânt din spate',
        detail: hasPenalty
          ? `${round(Math.abs(headwind))} km/h din spate — economisești ${round(Math.abs(penalty as number))} W.`
          : `${round(Math.abs(headwind))} km/h din spate.`,
        action: 'Kilometrii sunt ieftini acum. Urcă viteza cât ține vântul.',
      })
    }
  }

  // --- soare și panouri --------------------------------------------------

  const daytime = values.is_daytime !== false

  if (
    daytime &&
    finite(impact.solarElevationDeg) &&
    impact.solarElevationDeg > 0 &&
    impact.solarElevationDeg < SUN_LOW_DEG
  ) {
    advice.push({
      id: 'weather-sun-low',
      level: 'info',
      title: 'Soare jos pe cer',
      detail: `Înălțimea soarelui ${round(impact.solarElevationDeg, 1)}°, iradianță estimată ${round(impact.estimatedGhiWM2 ?? 0)} W/m².`,
      action: 'Aportul solar se stinge în curând. Treci pe bugetul de pachet.',
    })
  } else if (
    daytime &&
    finite(values.cloud_cover_pct) &&
    values.cloud_cover_pct >= CLOUD_HEAVY_PCT &&
    finite(impact.cloudLossPct)
  ) {
    advice.push({
      id: 'weather-clouds',
      level: 'warning',
      title: 'Cer acoperit',
      detail: `${round(values.cloud_cover_pct)} % nori — norii iau ${round(impact.cloudLossPct)} % din lumina disponibilă (${round(impact.estimatedGhiWM2 ?? 0)} W/m²).`,
      action:
        'Panourile nu mai acoperă consumul. Condu economic până se deschide cerul.',
    })
  }

  if (
    finite(impact.pvTemperatureLossPct) &&
    impact.pvTemperatureLossPct >= PV_LOSS_PCT
  ) {
    advice.push({
      id: 'weather-pv-heat',
      level: 'info',
      title: 'Panouri calde',
      detail: `Celulele la ~${round(impact.cellTemperatureC ?? 0)} °C pierd ${round(impact.pvTemperatureLossPct, 1)} % din putere.`,
      action:
        'Normal pe soare puternic. La oprire, parchează array-ul în bătaia vântului.',
    })
  }

  // --- aer rar -----------------------------------------------------------

  if (finite(impact.relativeDensity) && impact.relativeDensity < 0.95) {
    advice.push({
      id: 'weather-thin-air',
      level: 'good',
      title: 'Aer rar',
      detail: `Densitatea aerului ${round(impact.airDensityKgM3 ?? 0, 3)} kg/m³, cu ${round((1 - impact.relativeDensity) * 100, 1)} % sub standard.`,
      action: `Rezistența aerodinamică este mai mică; viteza economică urcă spre ${round(impact.economicSpeedKph ?? 0)} km/h.`,
    })
  }

  if (finite(values.uv_index) && values.uv_index >= UV_HIGH) {
    advice.push({
      id: 'weather-uv',
      level: 'info',
      title: 'Indice UV ridicat',
      detail: `UV ${round(values.uv_index)}.`,
      action: 'Protejează pilotul și echipa de boxe la fiecare oprire lungă.',
    })
  }

  return advice
}
