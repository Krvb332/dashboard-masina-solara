import type { AnalyticsTotals } from './analytics'
import {
  efficiencyKmPerKwh,
  regenRatioPct,
  solarFractionPct,
  specificConsumptionWhPerKm,
} from './telemetry-math'

/**
 * Profilurile piloților și bilanțul fiecărui stint.
 *
 * Într-o cursă solară pilotul se schimbă de câteva ori pe zi, iar diferența
 * dintre doi piloți pe același traseu se vede în Wh/km înainte să se vadă în
 * cronometru. Ca să fie comparabilă, energia trebuie tăiată exact la schimbul
 * de pilot — nu pe sesiune și nu pe tur.
 *
 * Mecanismul este scăderea unei linii de bază: acumulatorul de statistici
 * numără continuu pe toată sesiunea, iar stintul reține contoarele din
 * momentul urcării în mașină. Ce se afișează este diferența. Nu există un al
 * doilea acumulator care s-ar putea desincroniza de primul.
 *
 * Datele sunt exclusiv locale (`localStorage`), la fel ca restul dashboardului:
 * funcționează fără internet și nu depind de ce backend rulează în pitlane.
 */

export type DriverProfile = {
  id: string
  name: string
  /** Etichetă scurtă pentru insigne și tabele. */
  shortName: string
  color: string
  createdAt: number
  /**
   * Profil creat automat la primul flux de date, nu de un om. Se poate
   * redenumi; steagul dispare atunci, fiindcă a devenit un pilot cunoscut.
   */
  auto: boolean
  note: string
}

/** Bilanțul unui stint, calculat din diferența de contoare. */
export type StintSummary = {
  durationS: number
  distanceKm: number
  energyConsumedWh: number
  energyRegenWh: number
  energySolarWh: number
  motorEnergyWh: number
  whPerKm: number | null
  kmPerKwh: number | null
  averageSpeedKph: number | null
  maxSpeedKph: number
  regenRatioPct: number | null
  solarFractionPct: number | null
  harshAccelCount: number
  harshBrakeCount: number
  elevationGainM: number
  maxMotorTempC: number
  maxBatteryTempC: number
}

export type DriverStint = {
  id: string
  driverId: string
  driverName: string
  vehicleId: string | null
  sessionId: string | null
  startedAt: number
  endedAt: number | null
  /** Contoarele acumulatorului în momentul urcării la volan. */
  baseline: AnalyticsTotals
  /** Ultimele contoare văzute. La stintul închis, cele de la coborâre. */
  latest: AnalyticsTotals
  summary: StintSummary
}

/** Paleta pentru insignele piloților, în ordinea alocării. */
export const DRIVER_COLORS = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#f87171',
] as const

/**
 * Identificator scurt și unic. `crypto.randomUUID` nu există în toate
 * contextele în care rulează testele, deci nu ne bazăm pe el.
 */
export function makeId(prefix: string, now = Date.now()): string {
  const random = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')
  return `${prefix}-${now.toString(36)}-${random}`
}

/** Inițialele numelui: „Andrei Pop" → „AP", „Pilot 2" → „P2". */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '??'
  if (words.length === 1) {
    const single = words[0]
    return (single.slice(0, 1) + (single.slice(-1) || '')).toUpperCase()
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export function colorFor(index: number): string {
  return DRIVER_COLORS[index % DRIVER_COLORS.length]
}

/** Numele implicit al următorului pilot creat automat. */
export function nextAutoName(profiles: DriverProfile[]): string {
  const used = new Set(profiles.map((profile) => profile.name))
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `Pilot ${index}`
    if (!used.has(candidate)) return candidate
  }
  return `Pilot ${profiles.length + 1}`
}

export function makeProfile(
  name: string,
  index: number,
  options: { auto?: boolean; note?: string; now?: number } = {},
): DriverProfile {
  const now = options.now ?? Date.now()
  const trimmed = name.trim() || `Pilot ${index + 1}`

  return {
    id: makeId('driver', now),
    name: trimmed,
    shortName: initialsFor(trimmed),
    color: colorFor(index),
    createdAt: now,
    auto: options.auto ?? false,
    note: options.note ?? '',
  }
}

/**
 * Diferența dintre două seturi de contoare.
 *
 * Contoarele care sunt extreme (viteză maximă, temperaturi maxime) nu se scad:
 * maximul unui stint este maximul observat în el, iar acumulatorul îl ține deja
 * global. Pentru stinturi îl aproximăm cu maximul global, ceea ce este corect
 * pentru primul stint și conservator pentru următoarele — o cifră prea mare
 * atrage o verificare, una prea mică ar ascunde o supraîncălzire.
 */
export function totalsDelta(
  baseline: AnalyticsTotals,
  latest: AnalyticsTotals,
): AnalyticsTotals {
  const difference = (key: keyof AnalyticsTotals): number =>
    Math.max(0, (latest[key] as number) - (baseline[key] as number))

  return {
    samples: difference('samples'),
    activeSeconds: difference('activeSeconds'),
    distanceKm: difference('distanceKm'),
    energyConsumedWh: difference('energyConsumedWh'),
    energyRegenWh: difference('energyRegenWh'),
    energySolarWh: difference('energySolarWh'),
    motorEnergyWh: difference('motorEnergyWh'),
    elevationGainM: difference('elevationGainM'),
    elevationLossM: difference('elevationLossM'),
    harshAccelCount: difference('harshAccelCount'),
    harshBrakeCount: difference('harshBrakeCount'),
    maxSpeedKph: latest.maxSpeedKph,
    maxMotorPowerW: latest.maxMotorPowerW,
    maxBatteryTempC: latest.maxBatteryTempC,
    maxMotorTempC: latest.maxMotorTempC,
  }
}

/** Bilanțul stintului, din diferența de contoare. */
export function summarize(
  baseline: AnalyticsTotals,
  latest: AnalyticsTotals,
): StintSummary {
  const delta = totalsDelta(baseline, latest)

  return {
    durationS: delta.activeSeconds,
    distanceKm: delta.distanceKm,
    energyConsumedWh: delta.energyConsumedWh,
    energyRegenWh: delta.energyRegenWh,
    energySolarWh: delta.energySolarWh,
    motorEnergyWh: delta.motorEnergyWh,
    whPerKm: specificConsumptionWhPerKm(
      delta.energyConsumedWh,
      delta.distanceKm,
    ),
    kmPerKwh: efficiencyKmPerKwh(delta.distanceKm, delta.energyConsumedWh),
    averageSpeedKph:
      delta.activeSeconds > 0
        ? (delta.distanceKm / delta.activeSeconds) * 3600
        : null,
    maxSpeedKph: delta.maxSpeedKph,
    regenRatioPct: regenRatioPct(delta.energyRegenWh, delta.energyConsumedWh),
    solarFractionPct: solarFractionPct(
      delta.energySolarWh,
      delta.energyConsumedWh,
    ),
    harshAccelCount: delta.harshAccelCount,
    harshBrakeCount: delta.harshBrakeCount,
    elevationGainM: delta.elevationGainM,
    maxMotorTempC: delta.maxMotorTempC,
    maxBatteryTempC: delta.maxBatteryTempC,
  }
}

export type DriverAggregate = {
  driverId: string
  stints: number
  distanceKm: number
  energyConsumedWh: number
  durationS: number
  whPerKm: number | null
  bestWhPerKm: number | null
  averageSpeedKph: number | null
  maxSpeedKph: number
  harshEvents: number
}

/**
 * Cumulul tuturor stinturilor unui pilot.
 *
 * `bestWhPerKm` ia doar stinturile cu peste 500 m parcurși: pe o distanță mai
 * mică raportul este dominat de rezoluția contorului și ar declara „recordul
 * de eficiență" o urcare în mașină de zece secunde.
 */
export function aggregateFor(
  driverId: string,
  stints: DriverStint[],
): DriverAggregate {
  const own = stints.filter((stint) => stint.driverId === driverId)

  let distanceKm = 0
  let energyWh = 0
  let durationS = 0
  let maxSpeedKph = 0
  let harshEvents = 0
  let bestWhPerKm: number | null = null

  for (const stint of own) {
    distanceKm += stint.summary.distanceKm
    energyWh += stint.summary.energyConsumedWh
    durationS += stint.summary.durationS
    maxSpeedKph = Math.max(maxSpeedKph, stint.summary.maxSpeedKph)
    harshEvents += stint.summary.harshAccelCount + stint.summary.harshBrakeCount

    if (stint.summary.distanceKm >= 0.5 && stint.summary.whPerKm !== null) {
      bestWhPerKm =
        bestWhPerKm === null
          ? stint.summary.whPerKm
          : Math.min(bestWhPerKm, stint.summary.whPerKm)
    }
  }

  return {
    driverId,
    stints: own.length,
    distanceKm,
    energyConsumedWh: energyWh,
    durationS,
    whPerKm: specificConsumptionWhPerKm(energyWh, distanceKm),
    bestWhPerKm,
    averageSpeedKph: durationS > 0 ? (distanceKm / durationS) * 3600 : null,
    maxSpeedKph,
    harshEvents,
  }
}
