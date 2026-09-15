import { z } from 'zod'

/**
 * Contractele secțiunii meteo. Oglindesc modelele Pydantic din
 * `server/app/schemas.py`.
 *
 * Fiecare mărime este `number | null`. Nu există `.default(0)` nicăieri în
 * acest fișier, și asta este intenționat: un zero strecurat aici ar intra
 * nevăzut în densitatea aerului, în iradianța estimată și în sfaturile date
 * pilotului. „Nu am primit valoarea" trebuie să rămână distinct de „valoarea
 * este zero" până în pixelul afișat.
 */

const isoDateTime = z.iso.datetime({ offset: true })

/** Un număr care chiar este număr. Respinge `NaN` și infinitul. */
const finiteNumber = z.number().refine(Number.isFinite, 'valoare nefinită')

const nullableNumber = finiteNumber.nullable().default(null)
const nullableText = z.string().nullable().default(null)

export const weatherStatusSchema = z.enum(['ok', 'stale', 'unavailable'])

export const weatherConditionSchema = z.object({
  type: nullableText,
  description: nullableText,
  icon_uri: nullableText,
})

export const weatherMeasurementsSchema = z.object({
  temperature_c: nullableNumber,
  feels_like_c: nullableNumber,
  dew_point_c: nullableNumber,
  heat_index_c: nullableNumber,
  wet_bulb_c: nullableNumber,
  relative_humidity_pct: nullableNumber,
  /** Presiune redusă la nivelul mării, în hPa. */
  pressure_hpa: nullableNumber,
  cloud_cover_pct: nullableNumber,
  uv_index: nullableNumber,
  visibility_km: nullableNumber,
  wind_speed_kph: nullableNumber,
  wind_gust_kph: nullableNumber,
  /** Direcția DIN CARE bate vântul, grade față de nord. */
  wind_from_deg: nullableNumber,
  wind_cardinal: nullableText,
  precipitation_probability_pct: nullableNumber,
  precipitation_type: nullableText,
  precipitation_mm: nullableNumber,
  snow_mm: nullableNumber,
  thunderstorm_probability_pct: nullableNumber,
  is_daytime: z.boolean().nullable().default(null),
})

export const weatherHistorySchema = z.object({
  max_temperature_c: nullableNumber,
  min_temperature_c: nullableNumber,
  temperature_change_c: nullableNumber,
  precipitation_mm: nullableNumber,
})

export const weatherObservationSchema = z.object({
  observed_at: isoDateTime.nullable().default(null),
  time_zone: nullableText,
  condition: weatherConditionSchema,
  values: weatherMeasurementsSchema,
  history: weatherHistorySchema,
})

export const weatherForecastHourSchema = z.object({
  start_time: isoDateTime,
  end_time: isoDateTime.nullable().default(null),
  condition: weatherConditionSchema,
  values: weatherMeasurementsSchema,
})

export const weatherLocationSchema = z.object({
  latitude: finiteNumber,
  longitude: finiteNumber,
  /** „gps" când vremea este a mașinii, „configurat" când e a unui punct fix. */
  source: z.string(),
})

export const weatherReportSchema = z.object({
  status: weatherStatusSchema,
  provider: z.string(),
  location: weatherLocationSchema.nullable().default(null),
  fetched_at: isoDateTime.nullable().default(null),
  /** Vechimea observației servite, în secunde. */
  age_s: finiteNumber.nullable().default(null),
  reason: nullableText,
  current: weatherObservationSchema.nullable().default(null),
  forecast: z.array(weatherForecastHourSchema).default([]),
})

export type WeatherStatus = z.infer<typeof weatherStatusSchema>
export type WeatherCondition = z.infer<typeof weatherConditionSchema>
export type WeatherMeasurements = z.infer<typeof weatherMeasurementsSchema>
export type WeatherHistory = z.infer<typeof weatherHistorySchema>
export type WeatherObservation = z.infer<typeof weatherObservationSchema>
export type WeatherForecastHour = z.infer<typeof weatherForecastHourSchema>
export type WeatherLocation = z.infer<typeof weatherLocationSchema>
export type WeatherReport = z.infer<typeof weatherReportSchema>

/**
 * Raportul folosit cât timp nu a venit niciun răspuns.
 *
 * Toate câmpurile lipsesc, deci fiecare cifră derivată din el iese `null` și
 * fiecare panou afișează „—". Este exact comportamentul cerut: cu nimic
 * conectat, nicio statistică nu primește o valoare inventată.
 */
export const EMPTY_WEATHER: WeatherReport = {
  status: 'unavailable',
  provider: 'google-weather',
  location: null,
  fetched_at: null,
  age_s: null,
  reason: null,
  current: null,
  forecast: [],
}

export const EMPTY_MEASUREMENTS: WeatherMeasurements = {
  temperature_c: null,
  feels_like_c: null,
  dew_point_c: null,
  heat_index_c: null,
  wet_bulb_c: null,
  relative_humidity_pct: null,
  pressure_hpa: null,
  cloud_cover_pct: null,
  uv_index: null,
  visibility_km: null,
  wind_speed_kph: null,
  wind_gust_kph: null,
  wind_from_deg: null,
  wind_cardinal: null,
  precipitation_probability_pct: null,
  precipitation_type: null,
  precipitation_mm: null,
  snow_mm: null,
  thunderstorm_probability_pct: null,
  is_daytime: null,
}
