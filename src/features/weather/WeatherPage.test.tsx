import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_VALUE } from '../../lib/format'
import {
  EMPTY_MEASUREMENTS,
  EMPTY_WEATHER,
  type WeatherMeasurements,
  type WeatherReport,
} from '../../schemas/weather'
import { useWeatherStore } from '../../stores/weather-store'
import { resetTelemetryStore } from '../../test/fixtures'
import { router } from '../../app/router'
import { AppShell } from '../../components/AppShell'
import { WeatherPage } from './WeatherPage'

// Shell-ul montează fluxul live, motorul de statistici și interogarea meteo.
// Aici ne interesează doar navigația, iar un WebSocket deschis în jsdom ar
// transforma un test despre un link într-un test despre rețea.
vi.mock('../../hooks/useTelemetryStream', () => ({
  useTelemetryStream: () => {},
}))
vi.mock('../../hooks/useAnalyticsEngine', () => ({
  useAnalyticsEngine: () => {},
}))
vi.mock('../../hooks/useErrorLog', () => ({ useErrorLog: () => {} }))
vi.mock('../../hooks/useWeather', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useWeather')>()),
  useWeather: () => {},
}))

/**
 * Verificarea centrală a paginii este cea negativă: fără date, nicio cifră nu
 * are voie să fie `0`. Un panou meteo care arată „0 km/h vânt, 0 % nori, 0 °C"
 * pentru că nu are internet este mai periculos decât unul gol — arată exact ca
 * o zi calmă și senină.
 *
 * Ca testul negativ să însemne ceva, fiecare grup are și controlul pozitiv:
 * aceleași panouri, cu date, chiar afișează cifrele.
 */

function renderPage() {
  return render(
    <MemoryRouter>
      <WeatherPage />
    </MemoryRouter>,
  )
}

function seed(
  values: Partial<WeatherMeasurements>,
  overrides: Partial<WeatherReport> = {},
) {
  useWeatherStore.getState().setReport({
    ...EMPTY_WEATHER,
    status: 'ok',
    location: { latitude: 46.7712, longitude: 23.6236, source: 'gps' },
    fetched_at: '2026-06-21T09:30:00Z',
    age_s: 12,
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
  })
}

beforeEach(() => {
  useWeatherStore.getState().clear()
  useWeatherStore.getState().setArrayArea(null)
  resetTelemetryStore()
})

afterEach(() => {
  useWeatherStore.getState().clear()
  useWeatherStore.getState().setArrayArea(null)
})

describe('rutarea și navigația', () => {
  it('pagina este înregistrată la /vreme', () => {
    const paths = router.routes[0].children?.map((route) => route.path) ?? []
    expect(paths).toContain('vreme')
  })

  it('apare în navigația principală, cu link către /vreme', () => {
    // Ca în aplicație: shell-ul stă sub furnizorul de interogări (butonul de
    // înregistrare din antet folosește mutații react-query).
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const nav = screen.getByRole('navigation', {
      name: /Navigație principală/i,
    })
    const link = within(nav).getByRole('link', { name: /Vreme/i })
    expect(link).toHaveAttribute('href', '/vreme')
  })
})

describe('fără date meteo', () => {
  it('spune deschis că nu are date, în loc să afișeze zerouri', () => {
    renderPage()

    expect(screen.getByText(/Fără date meteo/i)).toBeInTheDocument()
    expect(
      screen.getByText(/nu se afișează valori presupuse/i),
    ).toBeInTheDocument()
  })

  it('nu afișează niciun `0` în locul unei măsurători lipsă', () => {
    renderPage()

    const readings = document.querySelectorAll('[data-reading]')
    expect(readings.length).toBeGreaterThan(8)
    for (const reading of readings) {
      expect(
        reading.getAttribute('data-missing'),
        reading.textContent ?? '',
      ).toBe('true')
      expect(reading.textContent).toContain(NO_VALUE)
      expect(reading.textContent).not.toMatch(/\d/)
    }
  })

  it('nu afișează nicio cifră derivată în locul unei mărimi necalculabile', () => {
    renderPage()

    const tiles = document.querySelectorAll('[data-stat]')
    expect(tiles.length).toBeGreaterThan(12)
    for (const tile of tiles) {
      expect(
        tile.getAttribute('data-missing'),
        tile.getAttribute('data-stat') ?? '',
      ).toBe('true')
    }
  })

  it('nu transmite pilotului niciun sfat inventat', () => {
    renderPage()

    expect(document.querySelectorAll('[data-advice]')).toHaveLength(0)
    expect(
      screen.getByText(/Nicio observație meteo de transmis/i),
    ).toBeInTheDocument()
  })

  it('anunță lipsa prognozei fără să deseneze ore goale', () => {
    renderPage()

    expect(screen.getByText(/Fără prognoză/i)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-hour]')).toHaveLength(0)
  })
})

describe('cu date meteo — controlul pozitiv', () => {
  it('afișează măsurătorile primite', () => {
    seed({
      temperature_c: 23.9,
      feels_like_c: 24.6,
      wind_speed_kph: 18,
      wind_from_deg: 357,
      wind_cardinal: 'NORTH',
      cloud_cover_pct: 28,
      relative_humidity_pct: 36,
      pressure_hpa: 1020,
      uv_index: 6,
      visibility_km: 16,
      is_daytime: true,
    })
    renderPage()

    expect(screen.getByText('23,9 °C')).toBeInTheDocument()
    expect(screen.getByText(/Senin/)).toBeInTheDocument()

    const wind = document.querySelector('[data-reading="Vânt"]') as HTMLElement
    expect(wind.getAttribute('data-missing')).toBe('false')
    expect(within(wind).getByText('18 km/h')).toBeInTheDocument()

    const direction = document.querySelector(
      '[data-reading="Direcția vântului"]',
    ) as HTMLElement
    expect(direction.textContent).toMatch(/din nord/)
  })

  it('calculează cifrele derivate din măsurători', () => {
    seed({
      temperature_c: 23.9,
      relative_humidity_pct: 36,
      pressure_hpa: 1020,
      cloud_cover_pct: 28,
      wind_speed_kph: 18,
      wind_from_deg: 357,
      is_daytime: true,
    })
    renderPage()

    const density = document.querySelector(
      '[data-stat="Densitatea aerului"]',
    ) as HTMLElement
    expect(density.getAttribute('data-missing')).toBe('false')
    // Aer la ~24 °C și 1020 hPa: în jurul a 1,19 kg/m³.
    expect(density.textContent).toMatch(/1,1\d/)

    // Formula este afișată sub cifră, ca oricine să o poată reface.
    expect(density.textContent).toMatch(/R_d/)
  })

  it('arată vechimea și sursa poziției', () => {
    seed({ temperature_c: 20 })
    renderPage()

    expect(screen.getByText(/de la GPS-ul mașinii/i)).toBeInTheDocument()
    expect(screen.getByText(/Măsurat la/i)).toBeInTheDocument()
  })

  it('marchează vizibil o observație învechită', () => {
    seed(
      { temperature_c: 20 },
      { status: 'stale', age_s: 900, reason: 'Fără internet.' },
    )
    renderPage()

    expect(screen.getByText(/Observație învechită/i)).toBeInTheDocument()
    expect(screen.getByText(/15 min 00 s/)).toBeInTheDocument()
  })

  it('transmite pilotului sfaturi cu cifra din spate', () => {
    seed({
      temperature_c: 20,
      relative_humidity_pct: 40,
      pressure_hpa: 1013,
      cloud_cover_pct: 95,
      wind_speed_kph: 5,
      wind_from_deg: 0,
      thunderstorm_probability_pct: 70,
      is_daytime: true,
    })
    renderPage()

    const advice = document.querySelectorAll('[data-advice]')
    expect(advice.length).toBeGreaterThan(0)
    expect(
      document.querySelector('[data-advice="weather-thunderstorm"]'),
    ).toBeTruthy()
  })

  it('ține randamentul array-ului „—” până când primește suprafața', () => {
    seed({
      temperature_c: 20,
      relative_humidity_pct: 40,
      pressure_hpa: 1013,
      cloud_cover_pct: 10,
      is_daytime: true,
    })
    const { unmount } = renderPage()

    const yieldTile = document.querySelector(
      '[data-stat="Randament array"]',
    ) as HTMLElement
    expect(yieldTile.getAttribute('data-missing')).toBe('true')
    unmount()
  })
})
