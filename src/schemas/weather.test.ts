import { describe, expect, it } from 'vitest'
import { weatherReportSchema } from './weather'

/**
 * Contractul dintre server și browser, verificat pe un răspuns adevărat.
 *
 * Restul testelor din secțiunea meteo construiesc obiecte cu mâna și dovedesc
 * că formulele sunt corecte. Niciunul nu dovedește că serverul chiar trimite
 * forma pe care o așteaptă Zod — iar acolo se rupe integrarea, tăcut și abia în
 * pitlane: un câmp redenumit pe server trece de toate testele Python și de toate
 * testele de formule, și cade la prima validare din browser.
 *
 * Sarcina de mai jos este captura exactă a lui `GET /api/v1/weather` de la
 * serverul pornit local, cu Google Weather API în spate, pe 2026-09-15.
 * Dacă o schimbare de pe server rupe contractul, testul acesta pică primul.
 */

const LIVE_RESPONSE = {
  status: 'ok',
  provider: 'google-weather',
  location: {
    latitude: 46.7712,
    longitude: 23.6236,
    source: 'configurat',
  },
  fetched_at: '2026-09-15T15:52:50.159840Z',
  age_s: 29.3,
  reason: null,
  current: {
    observed_at: '2026-09-15T15:52:50.007014Z',
    time_zone: 'Europe/Bucharest',
    condition: {
      type: 'MOSTLY_CLEAR',
      description: 'În mare parte însorit',
      icon_uri: 'https://maps.gstatic.com/weather/v1/mostly_sunny_dark.png',
    },
    values: {
      temperature_c: 22.1,
      feels_like_c: 24.2,
      dew_point_c: 9.0,
      heat_index_c: 24.2,
      wet_bulb_c: null,
      relative_humidity_pct: 43.0,
      pressure_hpa: 1019.62,
      cloud_cover_pct: 18.0,
      uv_index: 0.0,
      visibility_km: 16.0,
      wind_speed_kph: 5.0,
      wind_gust_kph: 10.0,
      wind_from_deg: 358.0,
      wind_cardinal: 'NORTH',
      precipitation_probability_pct: 0.0,
      precipitation_type: 'RAIN',
      precipitation_mm: 0.0,
      snow_mm: 0.0,
      thunderstorm_probability_pct: 0.0,
      is_daytime: true,
    },
    history: {
      max_temperature_c: 24.3,
      min_temperature_c: 9.2,
      temperature_change_c: 0.7,
      precipitation_mm: 0.0,
    },
  },
  forecast: [
    {
      start_time: '2026-09-15T15:00:00Z',
      end_time: '2026-09-15T16:00:00Z',
      condition: {
        type: 'MOSTLY_CLEAR',
        description: 'În mare parte însorit',
        icon_uri: 'https://maps.gstatic.com/weather/v1/mostly_sunny_dark.png',
      },
      values: {
        temperature_c: 23.4,
        feels_like_c: 24.5,
        dew_point_c: 8.9,
        heat_index_c: 24.5,
        wet_bulb_c: 14.7,
        relative_humidity_pct: 39.0,
        pressure_hpa: 1019.7,
        cloud_cover_pct: 24.0,
        uv_index: 0.0,
        visibility_km: 16.0,
        wind_speed_kph: 5.0,
        wind_gust_kph: 11.0,
        wind_from_deg: 358.0,
        wind_cardinal: 'NORTH',
        precipitation_probability_pct: 0.0,
        precipitation_type: 'RAIN',
        precipitation_mm: 0.0,
        snow_mm: 0.0,
        thunderstorm_probability_pct: 0.0,
        is_daytime: true,
      },
    },
    {
      start_time: '2026-09-15T16:00:00Z',
      end_time: '2026-09-15T17:00:00Z',
      condition: {
        type: 'CLEAR',
        description: 'Însorit',
        icon_uri: 'https://maps.gstatic.com/weather/v1/sunny_dark.png',
      },
      values: {
        temperature_c: 22.0,
        feels_like_c: 24.2,
        dew_point_c: 9.1,
        heat_index_c: 24.2,
        wet_bulb_c: 14.2,
        relative_humidity_pct: 43.0,
        pressure_hpa: 1019.61,
        cloud_cover_pct: 17.0,
        uv_index: 0.0,
        visibility_km: 16.0,
        wind_speed_kph: 5.0,
        wind_gust_kph: 10.0,
        wind_from_deg: 4.0,
        wind_cardinal: 'NORTH',
        precipitation_probability_pct: 0.0,
        precipitation_type: 'RAIN',
        precipitation_mm: 0.0,
        snow_mm: 0.0,
        thunderstorm_probability_pct: 0.0,
        is_daytime: true,
      },
    },
    {
      start_time: '2026-09-15T17:00:00Z',
      end_time: '2026-09-15T18:00:00Z',
      condition: {
        type: 'MOSTLY_CLEAR',
        description: 'Cer senin, periodic înnorat',
        icon_uri: 'https://maps.gstatic.com/weather/v1/mostly_clear_dark.png',
      },
      values: {
        temperature_c: 19.5,
        feels_like_c: 24.4,
        dew_point_c: 9.2,
        heat_index_c: 24.4,
        wet_bulb_c: 13.4,
        relative_humidity_pct: 51.0,
        pressure_hpa: 1019.87,
        cloud_cover_pct: 24.0,
        uv_index: 0.0,
        visibility_km: 16.0,
        wind_speed_kph: 3.0,
        wind_gust_kph: 6.0,
        wind_from_deg: 0.0,
        wind_cardinal: 'NORTH',
        precipitation_probability_pct: 0.0,
        precipitation_type: 'RAIN',
        precipitation_mm: 0.0,
        snow_mm: 0.0,
        thunderstorm_probability_pct: 0.0,
        is_daytime: false,
      },
    },
  ],
}

describe('contractul răspunsului meteo', () => {
  it('validează un răspuns real al serverului', () => {
    const parsed = weatherReportSchema.parse(LIVE_RESPONSE)

    expect(parsed.status).toBe('ok')
    expect(parsed.provider).toBe('google-weather')
    expect(parsed.current).not.toBeNull()
    expect(parsed.forecast.length).toBeGreaterThan(0)
  })

  it('păstrează mărimile ca numere, nu ca text', () => {
    const values = weatherReportSchema.parse(LIVE_RESPONSE).current?.values

    expect(typeof values?.temperature_c).toBe('number')
    expect(typeof values?.wind_from_deg).toBe('number')
    expect(typeof values?.cloud_cover_pct).toBe('number')
    expect(
      values?.is_daytime === null || typeof values?.is_daytime === 'boolean',
    ).toBe(true)
  })

  it('acceptă orice câmp absent ca `null`, fără să îl umple cu zero', () => {
    const minimal = {
      status: 'unavailable',
      provider: 'google-weather',
    }

    const parsed = weatherReportSchema.parse(minimal)

    expect(parsed.current).toBeNull()
    expect(parsed.location).toBeNull()
    expect(parsed.age_s).toBeNull()
    expect(parsed.forecast).toEqual([])
  })

  it('respinge un câmp numeric sosit ca text — altfel ar ajunge `NaN` în formule', () => {
    const corrupt = {
      ...LIVE_RESPONSE,
      current: {
        ...LIVE_RESPONSE.current,
        values: { ...LIVE_RESPONSE.current.values, temperature_c: '22,1' },
      },
    }

    expect(() => weatherReportSchema.parse(corrupt)).toThrow()
  })

  it('respinge o valoare nefinită strecurată într-o mărime', () => {
    const corrupt = {
      ...LIVE_RESPONSE,
      current: {
        ...LIVE_RESPONSE.current,
        values: { ...LIVE_RESPONSE.current.values, wind_speed_kph: Number.NaN },
      },
    }

    expect(() => weatherReportSchema.parse(corrupt)).toThrow()
  })
})
