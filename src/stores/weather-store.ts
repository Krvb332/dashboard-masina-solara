import { create } from 'zustand'
import { EMPTY_WEATHER, type WeatherReport } from '../schemas/weather'
import { safeStorage } from '../lib/safe-storage'

/**
 * Starea secțiunii meteo.
 *
 * Raportul stă în store și nu în cache-ul React Query pentru că îl citesc mai
 * multe pagini (prezentare, energie, traseu, vreme) și pentru că panourile
 * trebuie să poată afișa ultima observație bună chiar și cât timp cererea
 * următoare este în curs sau a eșuat.
 *
 * `arrayAreaM2` este singura setare din secțiune și pornește goală în mod
 * deliberat: randamentul array-ului nu se poate calcula fără suprafața lui, iar
 * o suprafață presupusă ar transforma un procent afișat într-o părere. Cât timp
 * nu este completată, panoul arată aria efectivă măsurată, care nu presupune nimic.
 */

const AREA_KEY = 'tucn.weather.arrayArea'

function readStoredArea(): number | null {
  const raw = safeStorage().getItem(AREA_KEY)
  if (raw === null) return null
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

type WeatherStore = {
  report: WeatherReport
  /** Momentul ultimului răspuns primit, indiferent de conținutul lui. */
  updatedAt: number | null
  /** Mesajul ultimei cereri eșuate. Distinct de `report.reason`, care vine de la server. */
  error: string | null
  loading: boolean
  /** Suprafața array-ului fotovoltaic, m². `null` = necunoscută. */
  arrayAreaM2: number | null

  setReport: (report: WeatherReport, now?: number) => void
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
  setArrayArea: (areaM2: number | null) => void
  clear: () => void
}

export const useWeatherStore = create<WeatherStore>((set) => ({
  report: EMPTY_WEATHER,
  updatedAt: null,
  error: null,
  loading: false,
  arrayAreaM2: readStoredArea(),

  setReport: (report, now = Date.now()) =>
    set({ report, updatedAt: now, error: null, loading: false }),

  setError: (error) => set({ error, loading: false }),

  setLoading: (loading) => set({ loading }),

  setArrayArea: (areaM2) => {
    const valid = areaM2 !== null && Number.isFinite(areaM2) && areaM2 > 0
    const value = valid ? areaM2 : null

    if (value === null) safeStorage().removeItem(AREA_KEY)
    else safeStorage().setItem(AREA_KEY, String(value))

    set({ arrayAreaM2: value })
  },

  clear: () =>
    set({
      report: EMPTY_WEATHER,
      updatedAt: null,
      error: null,
      loading: false,
    }),
}))
