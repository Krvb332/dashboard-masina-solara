import type { WeatherReport } from '../schemas/weather'
import { VEHICLE, economicSpeedKph } from './telemetry-math'
import {
  aeroPowerW,
  airDensityKgM3,
  apparentAirSpeedKph,
  cellTemperatureC,
  clearSkyGhiWM2,
  cloudTransmittance,
  dewPointC,
  dewPointSpreadC,
  effectiveApertureM2,
  estimatedGhiWM2,
  pvTemperatureFactor,
  relativeAirDensity,
  solarPosition,
  solarYieldPct,
  stationPressureHpa,
  windComponents,
  windPenaltyW,
} from './weather-math'

/**
 * Unde se întâlnește vremea cu mașina.
 *
 * `weather-math.ts` conține formulele; fișierul de față le leagă de starea
 * reală a vehiculului — viteza, direcția de mers, altitudinea, puterea solară
 * măsurată — și produce setul de cifre pe care le afișează secțiunea meteo.
 *
 * Este cod pur: aceleași intrări dau aceleași cifre, în test ca și în pitlane.
 * Fiecare câmp rămâne `null` dacă îi lipsește o intrare, ceea ce înseamnă că un
 * dashboard pornit fără nimic conectat afișează „—" pe toată secțiunea, nu un
 * perete de zerouri care ar arăta ca măsurători.
 */

export type WeatherImpactInput = {
  report: WeatherReport
  /** Viteza la sol, km/h. */
  speedKph: number | null
  /** Direcția de mers, grade față de nord. */
  headingDeg: number | null
  /** Altitudinea de la GPS, m. Corectează presiunea redusă la nivelul mării. */
  altitudeM: number | null
  /** Puterea solară măsurată pe mașină, W. */
  solarPowerW: number | null
  /**
   * Suprafața array-ului, m². Rămâne `null` până când echipa o completează:
   * un randament calculat pe o suprafață presupusă ar fi o părere prezentată
   * ca procent.
   */
  arrayAreaM2?: number | null
  /** Momentul pentru care se calculează poziția soarelui. */
  now?: Date
}

export type WeatherImpact = {
  // --- aer -------------------------------------------------------------
  /** Presiunea la altitudinea mașinii, hPa. */
  pressureHpa: number | null
  airDensityKgM3: number | null
  /** Densitatea raportată la atmosfera standard. Sub 1 = aer rar. */
  relativeDensity: number | null
  dewPointC: number | null
  dewPointSpreadC: number | null

  // --- vânt ------------------------------------------------------------
  /** Pozitiv = vânt din față, km/h. */
  headwindKph: number | null
  /** Pozitiv = vânt dinspre dreapta, km/h. */
  crosswindKph: number | null
  /** Cu cât depășesc rafalele vântul constant, km/h. */
  gustSpreadKph: number | null
  apparentAirSpeedKph: number | null
  aeroPowerW: number | null
  aeroPowerStillAirW: number | null
  /** Cât din puterea aerodinamică este pusă acolo de vânt, W. */
  windPenaltyW: number | null
  /** Viteza cu consum minim, recalculată cu densitatea reală a aerului. */
  economicSpeedKph: number | null

  // --- soare -----------------------------------------------------------
  solarElevationDeg: number | null
  solarAzimuthDeg: number | null
  /** Unghiul soarelui față de axa mașinii: 0 = în față, 180 = în spate. */
  sunRelativeBearingDeg: number | null
  clearSkyGhiWM2: number | null
  estimatedGhiWM2: number | null
  /** Cât din lumina cerului senin iau norii, în procente. */
  cloudLossPct: number | null
  cellTemperatureC: number | null
  /** Pierderea de putere a panourilor din cauza temperaturii, în procente. */
  pvTemperatureLossPct: number | null
  /** Aria efectivă de captare dedusă din măsurători, m². */
  effectiveApertureM2: number | null
  /** Randamentul array-ului, dacă suprafața lui este cunoscută, în procente. */
  solarYieldPct: number | null
  isDaytime: boolean | null
}

export const EMPTY_IMPACT: WeatherImpact = {
  pressureHpa: null,
  airDensityKgM3: null,
  relativeDensity: null,
  dewPointC: null,
  dewPointSpreadC: null,
  headwindKph: null,
  crosswindKph: null,
  gustSpreadKph: null,
  apparentAirSpeedKph: null,
  aeroPowerW: null,
  aeroPowerStillAirW: null,
  windPenaltyW: null,
  economicSpeedKph: null,
  solarElevationDeg: null,
  solarAzimuthDeg: null,
  sunRelativeBearingDeg: null,
  clearSkyGhiWM2: null,
  estimatedGhiWM2: null,
  cloudLossPct: null,
  cellTemperatureC: null,
  pvTemperatureLossPct: null,
  effectiveApertureM2: null,
  solarYieldPct: null,
  isDaytime: null,
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Unghiul adus în intervalul 0-180: „cât de departe de axă", fără stânga/dreapta. */
function relativeBearing(
  azimuthDeg: number | null,
  headingDeg: number | null,
): number | null {
  if (!finite(azimuthDeg) || !finite(headingDeg)) return null
  const delta = Math.abs(((azimuthDeg - headingDeg) % 360) + 360) % 360
  return delta > 180 ? 360 - delta : delta
}

/**
 * Calculează efectul vremii asupra mașinii.
 *
 * Observația meteo este folosită și când este marcată `stale`: o presiune de
 * acum un sfert de oră este încă o presiune bună, iar panoul afișează separat
 * vechimea. Se oprește doar la `unavailable`, unde chiar nu există nimic.
 */
export function computeWeatherImpact(input: WeatherImpactInput): WeatherImpact {
  const observation = input.report.current
  if (observation === null || input.report.status === 'unavailable') {
    return EMPTY_IMPACT
  }

  const values = observation.values
  const now = input.now ?? new Date()

  const pressure = stationPressureHpa(
    values.pressure_hpa,
    input.altitudeM,
    values.temperature_c,
  )
  const density = airDensityKgM3(
    values.temperature_c,
    pressure,
    values.relative_humidity_pct,
  )

  // Punctul de rouă vine de la furnizor când există; îl recalculăm doar ca
  // rezervă, ca panoul de ceață să funcționeze și fără el.
  const dew =
    values.dew_point_c ??
    dewPointC(values.temperature_c, values.relative_humidity_pct)

  const wind = windComponents(
    values.wind_speed_kph,
    values.wind_from_deg,
    input.headingDeg,
  )
  const headwind = wind?.headwindKph ?? null
  const airSpeed = apparentAirSpeedKph(input.speedKph, headwind)

  const sun = solarPosition(
    now,
    input.report.location?.latitude ?? null,
    input.report.location?.longitude ?? null,
  )
  const clearSky = clearSkyGhiWM2(sun?.elevationDeg ?? null)
  const ghi = estimatedGhiWM2(sun?.elevationDeg ?? null, values.cloud_cover_pct)
  const transmittance = cloudTransmittance(values.cloud_cover_pct)
  const cellTemp = cellTemperatureC(values.temperature_c, ghi)
  const pvFactor = pvTemperatureFactor(cellTemp)

  return {
    pressureHpa: pressure,
    airDensityKgM3: density,
    relativeDensity: relativeAirDensity(density),
    dewPointC: dew,
    dewPointSpreadC: dewPointSpreadC(values.temperature_c, dew),

    headwindKph: headwind,
    crosswindKph: wind?.crosswindKph ?? null,
    gustSpreadKph:
      finite(values.wind_gust_kph) && finite(values.wind_speed_kph)
        ? Math.max(0, values.wind_gust_kph - values.wind_speed_kph)
        : null,
    apparentAirSpeedKph: airSpeed,
    aeroPowerW: aeroPowerW(input.speedKph, airSpeed, density, VEHICLE.dragArea),
    aeroPowerStillAirW: aeroPowerW(
      input.speedKph,
      input.speedKph,
      density,
      VEHICLE.dragArea,
    ),
    windPenaltyW: windPenaltyW(
      input.speedKph,
      headwind,
      density,
      VEHICLE.dragArea,
    ),
    // Viteza economică depinde de densitate: în aer rar se deplasează în sus.
    economicSpeedKph:
      density === null ? null : economicSpeedKph(VEHICLE, density),

    solarElevationDeg: sun?.elevationDeg ?? null,
    solarAzimuthDeg: sun?.azimuthDeg ?? null,
    sunRelativeBearingDeg: relativeBearing(
      sun?.azimuthDeg ?? null,
      input.headingDeg,
    ),
    clearSkyGhiWM2: clearSky,
    estimatedGhiWM2: ghi,
    cloudLossPct: transmittance === null ? null : (1 - transmittance) * 100,
    cellTemperatureC: cellTemp,
    pvTemperatureLossPct: pvFactor === null ? null : (1 - pvFactor) * 100,
    effectiveApertureM2: effectiveApertureM2(input.solarPowerW, ghi),
    solarYieldPct: solarYieldPct(
      input.solarPowerW,
      ghi,
      input.arrayAreaM2 ?? null,
    ),
    isDaytime: values.is_daytime,
  }
}
