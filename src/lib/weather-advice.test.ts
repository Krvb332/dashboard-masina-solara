import { describe, expect, it } from 'vitest'
import {
  EMPTY_MEASUREMENTS,
  EMPTY_WEATHER,
  type WeatherMeasurements,
  type WeatherReport,
} from '../schemas/weather'
import { primaryAdvice } from './coaching'
import { weatherAdvice } from './weather-advice'
import { EMPTY_IMPACT, computeWeatherImpact } from './weather-impact'

/**
 * Testele de mai jos verifică două lucruri diferite și le țin separate:
 * compunerea cifrelor (`computeWeatherImpact`) și traducerea lor în propoziții
 * (`weatherAdvice`). Un sfat corect scos din cifre greșite tot greșit rămâne.
 */

const CLUJ = { latitude: 46.7712, longitude: 23.6236 }
/** Un moment de după-amiază senină, cu soarele sus. */
const NOON = new Date('2026-06-21T09:30:00Z')

function report(
  values: Partial<WeatherMeasurements>,
  overrides: Partial<WeatherReport> = {},
): WeatherReport {
  return {
    ...EMPTY_WEATHER,
    status: 'ok',
    location: { ...CLUJ, source: 'gps' },
    fetched_at: '2026-06-21T09:30:00Z',
    age_s: 0,
    current: {
      observed_at: '2026-06-21T09:30:00Z',
      time_zone: 'Europe/Bucharest',
      condition: { type: 'CLEAR', description: 'Senin', icon_uri: null },
      values: { ...EMPTY_MEASUREMENTS, ...values },
      history: {
        max_temperature_c: null,
        min_temperature_c: null,
        temperature_change_c: null,
        precipitation_mm: null,
      },
    },
    ...overrides,
  }
}

/** Condiții blânde: nimic de raportat, ca fiecare test să adauge o singură cauză. */
const CALM: Partial<WeatherMeasurements> = {
  temperature_c: 20,
  relative_humidity_pct: 45,
  pressure_hpa: 1013.25,
  cloud_cover_pct: 10,
  wind_speed_kph: 3,
  wind_gust_kph: 4,
  wind_from_deg: 0,
  uv_index: 4,
  visibility_km: 16,
  precipitation_probability_pct: 0,
  precipitation_mm: 0,
  thunderstorm_probability_pct: 0,
  heat_index_c: 20,
  is_daytime: true,
}

function adviceFor(
  values: Partial<WeatherMeasurements>,
  options: { speedKph?: number | null; headingDeg?: number | null } = {},
) {
  const built = report({ ...CALM, ...values })
  const impact = computeWeatherImpact({
    report: built,
    speedKph: options.speedKph ?? 60,
    headingDeg: options.headingDeg ?? 0,
    altitudeM: 400,
    solarPowerW: 900,
    now: NOON,
  })
  return weatherAdvice({
    report: built,
    impact,
    speedKph: options.speedKph ?? 60,
  })
}

function ids(values: Partial<WeatherMeasurements>, options = {}) {
  return adviceFor(values, options).map((entry) => entry.id)
}

describe('compunerea efectului meteo', () => {
  it('fără raport nu produce nicio cifră', () => {
    const impact = computeWeatherImpact({
      report: EMPTY_WEATHER,
      speedKph: 60,
      headingDeg: 90,
      altitudeM: 400,
      solarPowerW: 800,
      now: NOON,
    })

    expect(impact).toEqual(EMPTY_IMPACT)
    // Exhaustiv: un câmp nou adăugat cu implicit `0` pică aici.
    for (const [name, value] of Object.entries(impact)) {
      expect(value, name).toBeNull()
    }
  })

  it('folosește și o observație învechită — o presiune de acum 15 minute e bună', () => {
    const stale = report({ ...CALM }, { status: 'stale', age_s: 900 })
    const impact = computeWeatherImpact({
      report: stale,
      speedKph: 50,
      headingDeg: 0,
      altitudeM: 400,
      solarPowerW: 800,
      now: NOON,
    })

    expect(impact.airDensityKgM3).not.toBeNull()
  })

  it('corectează presiunea cu altitudinea GPS înainte de densitate', () => {
    const base = report({ ...CALM })
    const jos = computeWeatherImpact({
      report: base,
      speedKph: 50,
      headingDeg: 0,
      altitudeM: 0,
      solarPowerW: 0,
      now: NOON,
    })
    const sus = computeWeatherImpact({
      report: base,
      speedKph: 50,
      headingDeg: 0,
      altitudeM: 1200,
      solarPowerW: 0,
      now: NOON,
    })

    expect(sus.pressureHpa as number).toBeLessThan(jos.pressureHpa as number)
    expect(sus.airDensityKgM3 as number).toBeLessThan(
      jos.airDensityKgM3 as number,
    )
    // Aer mai rar înseamnă viteză economică mai mare.
    expect(sus.economicSpeedKph as number).toBeGreaterThan(
      jos.economicSpeedKph as number,
    )
  })

  it('descompune vântul după direcția reală de mers', () => {
    const built = report({ ...CALM, wind_speed_kph: 20, wind_from_deg: 90 })

    const spreNord = computeWeatherImpact({
      report: built,
      speedKph: 60,
      headingDeg: 0,
      altitudeM: 400,
      solarPowerW: 0,
      now: NOON,
    })
    const spreEst = computeWeatherImpact({
      report: built,
      speedKph: 60,
      headingDeg: 90,
      altitudeM: 400,
      solarPowerW: 0,
      now: NOON,
    })

    expect(spreNord.headwindKph as number).toBeCloseTo(0, 6)
    expect(spreNord.crosswindKph as number).toBeCloseTo(20, 6)
    expect(spreEst.headwindKph as number).toBeCloseTo(20, 6)
    expect(spreEst.apparentAirSpeedKph as number).toBeCloseTo(80, 6)
    expect(spreEst.windPenaltyW as number).toBeGreaterThan(0)
  })

  it('fără direcție de mers nu ghicește componenta de vânt', () => {
    const impact = computeWeatherImpact({
      report: report({ ...CALM, wind_speed_kph: 25, wind_from_deg: 210 }),
      speedKph: 60,
      headingDeg: null,
      altitudeM: 400,
      solarPowerW: 0,
      now: NOON,
    })

    expect(impact.headwindKph).toBeNull()
    expect(impact.windPenaltyW).toBeNull()
    // Dar densitatea aerului nu depinde de direcție și rămâne disponibilă.
    expect(impact.airDensityKgM3).not.toBeNull()
  })

  it('raportează randamentul array-ului doar dacă i se dă suprafața', () => {
    const common = {
      report: report({ ...CALM }),
      speedKph: 50,
      headingDeg: 0,
      altitudeM: 400,
      solarPowerW: 900,
      now: NOON,
    }

    expect(computeWeatherImpact(common).solarYieldPct).toBeNull()
    expect(
      computeWeatherImpact({ ...common, arrayAreaM2: 4 }).solarYieldPct,
    ).not.toBeNull()
    // Aria efectivă nu presupune nimic, deci există oricum.
    expect(computeWeatherImpact(common).effectiveApertureM2).not.toBeNull()
  })

  it('pune soarele sus la amiaza de vară și jos noaptea', () => {
    const zi = computeWeatherImpact({
      report: report({ ...CALM }),
      speedKph: 0,
      headingDeg: 0,
      altitudeM: 400,
      solarPowerW: 0,
      now: NOON,
    })
    const noapte = computeWeatherImpact({
      report: report({ ...CALM }),
      speedKph: 0,
      headingDeg: 0,
      altitudeM: 400,
      solarPowerW: 0,
      now: new Date('2026-06-21T22:30:00Z'),
    })

    expect(zi.solarElevationDeg as number).toBeGreaterThan(50)
    expect(noapte.solarElevationDeg as number).toBeLessThan(0)
    expect(noapte.estimatedGhiWM2).toBe(0)
  })
})

describe('recomandările meteo', () => {
  it('fără date nu spune nimic', () => {
    expect(
      weatherAdvice({
        report: EMPTY_WEATHER,
        impact: EMPTY_IMPACT,
        speedKph: 60,
      }),
    ).toEqual([])
  })

  it('pe vreme blândă nu inventează probleme', () => {
    // Controlul pozitiv al tuturor testelor negative de mai jos: dacă lista ar
    // fi mereu goală, niciunul dintre ele nu ar dovedi nimic.
    expect(ids({})).not.toContain('weather-rain')
    expect(ids({ precipitation_probability_pct: 80 })).toContain('weather-rain')
  })

  it('anunță vântul de față cu cifra în wați și cere ridicarea piciorului', () => {
    const advice = adviceFor({ wind_speed_kph: 25, wind_from_deg: 0 })
    const wind = advice.find((entry) => entry.id === 'weather-headwind')

    expect(wind).toBeDefined()
    expect(wind?.level).toBe('warning')
    expect(wind?.detail).toMatch(/W/)
    expect(wind?.action).toMatch(/viteza/i)
  })

  it('tratează vântul din spate ca pe o ocazie, nu ca pe o problemă', () => {
    const advice = adviceFor({ wind_speed_kph: 25, wind_from_deg: 180 })
    const wind = advice.find((entry) => entry.id === 'weather-tailwind')

    expect(wind?.level).toBe('good')
    expect(wind?.action).toMatch(/urcă/i)
  })

  it('tace despre vânt când mașina stă pe loc', () => {
    expect(
      ids({ wind_speed_kph: 30, wind_from_deg: 0 }, { speedKph: 0 }),
    ).not.toContain('weather-headwind')
    expect(
      ids({ wind_speed_kph: 30, wind_from_deg: 0 }, { speedKph: 60 }),
    ).toContain('weather-headwind')
  })

  it('avertizează la vânt lateral puternic', () => {
    expect(ids({ wind_speed_kph: 35, wind_from_deg: 90 })).toContain(
      'weather-crosswind',
    )
  })

  it('semnalează rafalele neregulate când vântul constant este blând', () => {
    expect(
      ids({ wind_speed_kph: 10, wind_gust_kph: 32, wind_from_deg: 90 }),
    ).toContain('weather-gusts')
  })

  it('cere condus economic pe cer acoperit și arată cât iau norii', () => {
    const advice = adviceFor({ cloud_cover_pct: 95 })
    const clouds = advice.find((entry) => entry.id === 'weather-clouds')

    expect(clouds?.level).toBe('warning')
    expect(clouds?.detail).toMatch(/W\/m²/)
    expect(clouds?.action).toMatch(/economic/i)
  })

  it('anunță stingerea aportului solar când soarele coboară', () => {
    const built = report({ ...CALM })
    const seara = new Date('2026-06-21T17:45:00Z')
    const impact = computeWeatherImpact({
      report: built,
      speedKph: 50,
      headingDeg: 0,
      altitudeM: 400,
      solarPowerW: 120,
      now: seara,
    })

    expect(impact.solarElevationDeg as number).toBeGreaterThan(0)
    expect(impact.solarElevationDeg as number).toBeLessThan(10)
    expect(
      weatherAdvice({ report: built, impact, speedKph: 50 }).map((e) => e.id),
    ).toContain('weather-sun-low')
  })

  it('ridică furtuna la nivel critic, peste orice altceva', () => {
    const advice = adviceFor({
      thunderstorm_probability_pct: 60,
      wind_speed_kph: 30,
      wind_from_deg: 0,
    })

    expect(primaryAdvice(advice)?.id).toBe('weather-thunderstorm')
    expect(primaryAdvice(advice)?.level).toBe('critical')
  })

  it('avertizează despre condens când punctul de rouă este aproape', () => {
    expect(ids({ temperature_c: 9, relative_humidity_pct: 97 })).toContain(
      'weather-fog',
    )
    expect(ids({ temperature_c: 9, relative_humidity_pct: 40 })).not.toContain(
      'weather-fog',
    )
  })

  it('cere schimbul de pilot la stres termic sever', () => {
    const advice = adviceFor({ temperature_c: 38, heat_index_c: 41 })
    const heat = advice.find((entry) => entry.id === 'weather-heat')

    expect(heat?.level).toBe('critical')
    expect(heat?.action).toMatch(/schimbul de pilot/i)
  })

  it('tratează ploaia ca problemă de frânare, nu doar ca informație', () => {
    const advice = adviceFor({ precipitation_mm: 1.4 })
    const rain = advice.find((entry) => entry.id === 'weather-rain')

    expect(rain?.level).toBe('warning')
    expect(rain?.action).toMatch(/regenerativ/i)
  })

  it('raportează aerul rar ca avantaj, cu viteza economică recalculată', () => {
    const advice = adviceFor({ temperature_c: 35, pressure_hpa: 1000 })
    const thin = advice.find((entry) => entry.id === 'weather-thin-air')

    expect(thin?.level).toBe('good')
    expect(thin?.action).toMatch(/km\/h/)
  })

  it('fiecare sfat poartă o cifră verificabilă', () => {
    const advice = adviceFor({
      wind_speed_kph: 28,
      wind_from_deg: 0,
      cloud_cover_pct: 92,
      precipitation_probability_pct: 70,
      uv_index: 9,
    })

    expect(advice.length).toBeGreaterThan(2)
    for (const entry of advice) {
      expect(entry.detail, entry.id).toMatch(/\d/)
      expect(entry.action.length, entry.id).toBeGreaterThan(10)
    }
  })
})
