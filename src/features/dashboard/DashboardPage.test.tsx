import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeQuality,
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../../test/fixtures'
import { useTelemetryStore } from '../../stores/telemetry-store'
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

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
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
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByText(/Ultima valoare acum/)).toBeInTheDocument()
    expect(screen.getByText('Fără date de la mașină')).toBeInTheDocument()
  })

  it('include graficul, harta și panoul de alarme', () => {
    seedTelemetry(catalog)

    renderPage()

    expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(2)
    expect(screen.getByTestId('track-map')).toBeInTheDocument()
    expect(screen.getByText('Nicio alarmă activă.')).toBeInTheDocument()
  })

  it('listează alarmele active, cele critice primele', () => {
    seedTelemetry(catalog)
    useTelemetryStore.setState({
      alarms: [
        {
          id: 'a1',
          key: 'motor_temp_c:warn_high',
          label: 'Temp. motor',
          severity: 'warning',
          message: 'Temperatura motorului este ridicată.',
          signal_key: 'motor_temp_c',
          value: 95,
          threshold: 90,
          raised_at: '2026-07-24T10:00:00Z',
          cleared_at: null,
          active: true,
        },
        {
          id: 'a2',
          key: 'link_lost',
          label: 'Legătură pierdută',
          severity: 'critical',
          message: 'Nu s-au mai primit mesaje de la mașină.',
          signal_key: null,
          value: null,
          threshold: 2,
          raised_at: '2026-07-24T10:00:05Z',
          cleared_at: null,
          active: true,
        },
      ],
    })

    renderPage()

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Legătură pierdută')
    expect(items[1]).toHaveTextContent('Temp. motor')
  })
})
