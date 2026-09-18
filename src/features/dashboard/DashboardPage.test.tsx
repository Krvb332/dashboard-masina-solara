import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeQuality,
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../../test/fixtures'
import { DashboardPage } from './DashboardPage'

// Canvas și ECharts nu au sens în jsdom; testăm compoziția paginii, nu desenul.
vi.mock('../../components/TelemetryChart', () => ({
  TelemetryChart: () => <div data-testid="telemetry-chart" />,
}))
vi.mock('../../components/TrackMap', () => ({
  TrackMap: () => <div data-testid="track-map" />,
}))

const catalog = [
  makeSignal({
    key: 'vehicle_speed_kph',
    label: 'Viteză',
    unit: 'km/h',
    overview: true,
  }),
  makeSignal({
    key: 'battery_soc_pct',
    label: 'Stare baterie',
    unit: '%',
    group: 'energy',
    overview: true,
    warn_below: 25,
    crit_below: 15,
  }),
  makeSignal({
    key: 'motor_temp_c',
    label: 'Temp. motor',
    unit: '°C',
    group: 'thermal',
  }),
]

// Panoul Teensy interoghează `/api/v1/health`; în teste nu vrem rețea, doar
// compoziția paginii.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  fetchHealth: vi.fn(() => new Promise(() => {})),
}))

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(resetTelemetryStore)

describe('DashboardPage', () => {
  it('construiește cardurile din semnalele marcate `overview` în catalog', () => {
    seedTelemetry(catalog, {
      vehicle_speed_kph: makeQuality('valid', 63.8),
      battery_soc_pct: makeQuality('valid', 76.2),
    })

    renderPage()

    expect(screen.getByText('Viteză')).toBeInTheDocument()
    expect(screen.getByText('63,8 km/h')).toBeInTheDocument()
    expect(screen.getByText('76,2%')).toBeInTheDocument()
    // `motor_temp_c` nu este marcat `overview`, deci nu apare printre carduri.
    expect(screen.queryByText('Temp. motor')).not.toBeInTheDocument()
  })

  it('afișează un schelet cât timp catalogul nu a sosit', () => {
    renderPage()

    expect(screen.getAllByText('Se încarcă').length).toBeGreaterThan(0)
    expect(screen.queryByText('Viteză')).not.toBeInTheDocument()
  })

  it('nu afișează valori pentru semnale fără date proaspete', () => {
    seedTelemetry(catalog, {
      vehicle_speed_kph: makeQuality('stale', 63.8, 9000),
      battery_soc_pct: makeQuality('unavailable', null),
    })

    renderPage()

    expect(screen.queryByText('63,8 km/h')).not.toBeInTheDocument()
    // Restrâns la carduri: panoul plăcii are și el „—" pentru ce nu se știe.
    const cards = within(screen.getByLabelText('Indicatori principali'))
    expect(cards.getAllByText('—')).toHaveLength(2)
    expect(screen.getByText(/Ultima valoare acum/)).toBeInTheDocument()
    expect(
      screen.getByText('Semnalul nu a fost primit de la mașină'),
    ).toBeInTheDocument()
  })

  it('include graficul, harta și statisticile plăcii', () => {
    seedTelemetry(catalog)

    renderPage()

    expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(2)
    expect(screen.getByTestId('track-map')).toBeInTheDocument()
    expect(screen.getByText('Placă Teensy')).toBeInTheDocument()
  })

  it('numără sursele care mai trimit date', () => {
    seedTelemetry(catalog, {
      // `vehicle_speed_kph` nu aparține niciunei surse; `motor_temp_c` este la
      // senzorii de temperatură, iar `battery_soc_pct` la BMS.
      motor_temp_c: makeQuality('valid', 61),
      battery_soc_pct: makeQuality('unavailable', null),
    })

    renderPage()

    // O sursă din două răspunde: BMS-ul tace, senzorii de temperatură nu.
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText(/1 din 3 semnale proaspete/)).toBeInTheDocument()
  })

  it('deduce viteza din turație când placa nu trimite viteza', () => {
    const withRpm = [
      ...catalog,
      makeSignal({
        key: 'motor_rpm',
        label: 'Turație motor',
        unit: 'rpm',
        group: 'motor',
      }),
    ]
    seedTelemetry(withRpm, {
      vehicle_speed_kph: makeQuality('unavailable', null),
      motor_rpm: makeQuality('valid', 600),
    })

    renderPage()

    // 600 rpm pe roata de 548 mm: 10 rot/s · 1,7216 m · 3,6 = 61,98 km/h.
    expect(screen.getByText('62,0 km/h')).toBeInTheDocument()
    expect(screen.getByText(/Din turație × Ø 548 mm/)).toBeInTheDocument()
  })

  it('nu inventează temperatura plăcii cât timp firmware-ul nu o trimite', () => {
    seedTelemetry(catalog)

    renderPage()

    expect(
      screen.getByText('se așteaptă semnalul din firmware'),
    ).toBeInTheDocument()
  })
})
