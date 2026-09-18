import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import type { Advice } from '../lib/coaching'
import { fetchWeather } from '../lib/api'
import { collectFixes } from '../lib/gps-buffer'
import { isUsableFix } from '../lib/gps'
import { speedKphFromRpm } from '../lib/telemetry-math'
import { weatherAdvice } from '../lib/weather-advice'
import { computeWeatherImpact, type WeatherImpact } from '../lib/weather-impact'
import { useWeatherStore } from '../stores/weather-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { useTick } from './useTick'

/**
 * Aduce vremea de la server și o ține proaspătă.
 *
 * Se montează o singură dată, în shell, lângă celelalte motoare: patru pagini
 * citesc raportul, iar montarea lui într-una singură ar reporni ciclul de
 * interogare la fiecare navigare și ar consuma apeluri facturate degeaba.
 *
 * ## Ritmuri
 *
 * Interogăm la cinci minute, iar serverul ține observația zece. Cele două nu
 * trebuie să fie egale: majoritatea cererilor cad pe memoria cache a serverului
 * și nu costă nimic, dar imediat după expirarea ei prima cerere aduce date noi
 * fără să fie nevoie de un ceas sincronizat între browser și server.
 *
 * ## Poziția
 *
 * Trimitem poziția doar când avem un fix propriu bun — în replay, de exemplu,
 * unde serverul nu are de unde ști unde era mașina. Altfel lăsăm serverul să
 * folosească fixul lui, care este sursa de adevăr în direct. Coordonatele sunt
 * rotunjite la ~1 km, ca mișcarea mașinii pe circuit să nu schimbe cheia
 * cererii de zece ori pe secundă.
 */

/** Cât de des cerem vremea de la server, în milisecunde. */
export const WEATHER_REFRESH_MS = 300_000
/** Cât de des ne uităm dacă mașina s-a mutat destul cât să conteze. */
const POSITION_TICK_MS = 60_000

/** Poziția curentă, rotunjită la două zecimale (~1 km). */
function currentPosition(): { lat: number; lon: number } | null {
  const fixes = collectFixes(120)
  for (let index = fixes.length - 1; index >= 0; index -= 1) {
    const fix = fixes[index]
    if (!isUsableFix(fix)) continue
    return {
      lat: Math.round(fix.latitude * 100) / 100,
      lon: Math.round(fix.longitude * 100) / 100,
    }
  }
  return null
}

export function useWeather(): void {
  const setReport = useWeatherStore((state) => state.setReport)
  const setError = useWeatherStore((state) => state.setError)
  const setLoading = useWeatherStore((state) => state.setLoading)

  // Recitim poziția rar: o cheie de cerere care se schimbă odată cu fiecare
  // eșantion GPS ar anula și ar relansa interogarea la nesfârșit.
  const tick = useTick(POSITION_TICK_MS)
  const position = useMemo(() => {
    // `tick` este dependența care declanșează recitirea; bufferul de fixuri nu
    // emite evenimente, deci ceasul este singurul semnal de „mai uită-te o dată”.
    void tick
    return currentPosition()
  }, [tick])

  const query = useQuery({
    queryKey: ['weather', position?.lat ?? null, position?.lon ?? null],
    queryFn: () => fetchWeather(position?.lat, position?.lon),
    refetchInterval: WEATHER_REFRESH_MS,
    staleTime: WEATHER_REFRESH_MS,
    // O singură reîncercare: fără internet, insistența doar întârzie afișarea
    // stării „indisponibil", care este informația utilă în pitlane.
    retry: 1,
    // Dashboardul stă ore întregi pe același ecran; oprirea la fereastră
    // inactivă ar însemna date vechi exact când cineva se uită iar la el.
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    setLoading(query.isFetching)
  }, [query.isFetching, setLoading])

  useEffect(() => {
    if (query.data !== undefined) setReport(query.data)
  }, [query.data, setReport])

  useEffect(() => {
    if (query.error === null) return
    setError(
      query.error instanceof Error
        ? query.error.message
        : 'Serviciul de vreme nu a răspuns.',
    )
  }, [query.error, setError])
}

/**
 * Starea și contextul mașinii de care are nevoie secțiunea meteo.
 *
 * Direcția de mers nu este un semnal raportat de mașină: o deducem din ultimele
 * două fixuri GPS, dar numai dacă mașina chiar s-a deplasat între ele. Fără
 * deplasare, direcția dintre două fixuri este zgomotul receptorului, iar un
 * „vânt de față" calculat din ea ar fi pură invenție.
 */
export function useVehicleContext(): {
  speedKph: number | null
  headingDeg: number | null
  altitudeM: number | null
  solarPowerW: number | null
} {
  const quality = useTelemetryStore((state) => state.quality)
  const tick = useTick(1000)

  return useMemo(() => {
    // Direcția de mers se citește din bufferul de fixuri, care nu trece prin
    // store; `tick` este singurul lucru care spune componentei să se uite iar.
    void tick

    const value = (key: string): number | null => {
      const entry = quality[key]
      if (entry === undefined || entry.state !== 'valid') return null
      return entry.value !== null && Number.isFinite(entry.value)
        ? entry.value
        : null
    }

    return {
      // Aceeași regulă ca în acumulator: viteza raportată sau, fără ea,
      // turația trecută prin roata de 548 mm.
      speedKph: value('vehicle_speed_kph') ?? speedKphFromRpm(value('motor_rpm')),
      headingDeg: headingFromFixes(),
      altitudeM: value('gps_altitude_m'),
      solarPowerW: value('solar_power_w'),
    }
  }, [quality, tick])
}

/** Câți metri trebuie parcurși ca direcția dintre două fixuri să fie reală. */
const HEADING_MIN_METERS = 10

function headingFromFixes(): number | null {
  const fixes = collectFixes(600).filter(isUsableFix)
  if (fixes.length < 2) return null

  const last = fixes[fixes.length - 1]

  // Mergem înapoi până găsim un fix destul de departe: între două eșantioane
  // consecutive la 10 Hz mașina face 1,7 m la 60 km/h, sub precizia receptorului.
  for (let index = fixes.length - 2; index >= 0; index -= 1) {
    const earlier = fixes[index]
    const bearing = bearingBetween(earlier, last)
    if (bearing !== null) return bearing
  }
  return null
}

function bearingBetween(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number | null {
  const toRad = Math.PI / 180
  const meanLat = ((from.latitude + to.latitude) / 2) * toRad
  const north = (to.latitude - from.latitude) * 111_320
  const east = (to.longitude - from.longitude) * 111_320 * Math.cos(meanLat)

  if (Math.hypot(north, east) < HEADING_MIN_METERS) return null
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
}

/**
 * Efectul vremii asupra mașinii, recalculat de câteva ori pe minut.
 *
 * Poziția soarelui se schimbă cu un sfert de grad pe minut, iar viteza și
 * direcția mașinii se schimbă continuu — dar niciuna nu cere recalculare la
 * fiecare cadru. `useTick` dă ritmul, nu fluxul de telemetrie.
 */
export function useWeatherImpact(): WeatherImpact {
  const report = useWeatherStore((state) => state.report)
  const arrayAreaM2 = useWeatherStore((state) => state.arrayAreaM2)
  const context = useVehicleContext()
  const tick = useTick(2000)

  return useMemo(
    () =>
      computeWeatherImpact({
        report,
        speedKph: context.speedKph,
        headingDeg: context.headingDeg,
        altitudeM: context.altitudeM,
        solarPowerW: context.solarPowerW,
        arrayAreaM2,
        now: new Date(tick),
      }),
    [report, context, arrayAreaM2, tick],
  )
}

/** Recomandările meteo pentru pilot, derivate din raport și din efectul lui. */
export function useWeatherAdvice(): Advice[] {
  const report = useWeatherStore((state) => state.report)
  const impact = useWeatherImpact()
  const context = useVehicleContext()

  return useMemo(
    () => weatherAdvice({ report, impact, speedKph: context.speedKph }),
    [report, impact, context.speedKph],
  )
}
