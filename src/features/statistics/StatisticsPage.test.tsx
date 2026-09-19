import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelemetryAnalytics } from '../../lib/analytics'
import { useAnalyticsStore } from '../../stores/analytics-store'
import { resetDriverStore, useDriverStore } from '../../stores/driver-store'
import { publishSimulatedRun, resetTelemetryStore } from '../../test/fixtures'
import { StatisticsPage } from './StatisticsPage'

// Canvas și ECharts nu au sens în jsdom; verificăm compoziția paginii și
// cifrele, nu desenul.
vi.mock('../../components/TelemetryChart', () => ({
  TelemetryChart: ({ ariaLabel }: { ariaLabel?: string }) => (
    <div data-testid="telemetry-chart" data-label={ariaLabel} />
  ),
}))
vi.mock('../../components/ElevationProfile', () => ({
  ElevationProfileChart: () => <div data-testid="elevation-profile" />,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <StatisticsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  resetTelemetryStore()
  resetDriverStore()
  useAnalyticsStore.getState().clear()
  useAnalyticsStore.getState().setStrategy({
    targetWhPerKm: null,
    remainingDistanceKm: null,
  })
})

afterEach(() => {
  useAnalyticsStore.getState().clear()
})

describe('fără date de la mașină', () => {
  it('nu afișează cifre derivate inventate', () => {
    renderPage()

    const consumption = screen.getByTitle(/Reacționează la stilul de condus/i)
    expect(consumption).toHaveAttribute('data-missing', 'true')
    expect(within(consumption).getByText('—')).toBeInTheDocument()
  })

  it('contoarele cumulate arată zero, fiindcă zero s-a acumulat', () => {
    renderPage()

    const distance = screen
      .getAllByText('Distanță')
      .map((node) => node.closest('[data-stat]'))
      .find(Boolean) as HTMLElement

    expect(distance).toHaveAttribute('data-missing', 'false')
    expect(within(distance).getByText('0,00')).toBeInTheDocument()
  })
})

describe('cu flux activ', () => {
  beforeEach(() => {
    publishSimulatedRun()
  })

  it('arată consumul instantaneu și recuperarea regenerativă', () => {
    renderPage()

    const regen = screen
      .getAllByText('Recuperare regenerativă')
      .map((node) => node.closest('[data-stat]'))
      .find(Boolean) as HTMLElement

    expect(regen).toHaveAttribute('data-missing', 'false')
    expect(within(regen).getByText('300')).toBeInTheDocument()
  })

  it('calculează consumul specific din energie și distanță', () => {
    renderPage()

    // 5 Wh pe 0,125 km înseamnă 40 Wh/km.
    const specific = screen
      .getAllByText('Consum din pachet (sesiune)')
      .map((node) => node.closest('[data-stat]'))
      .find(Boolean) as HTMLElement

    expect(within(specific).getByText('40,0')).toBeInTheDocument()
  })

  it('afișează aportul solar pe kilometru', () => {
    renderPage()

    // 900 W la 45 km/h aduc 20 Wh/km.
    const threshold = screen
      .getAllByText('Aport solar pe km')
      .map((node) => node.closest('[data-stat]'))
      .find(Boolean) as HTMLElement

    expect(within(threshold).getByText('20,0')).toBeInTheDocument()
  })

  it('randează graficele de consum, recuperare și bilanț', () => {
    renderPage()

    const labels = screen
      .getAllByTestId('telemetry-chart')
      .map((node) => node.getAttribute('data-label'))

    expect(labels.join(' | ')).toMatch(/puterea recuperată/i)
    expect(labels.join(' | ')).toMatch(/consumul specific/i)
    expect(labels.join(' | ')).toMatch(/rezistența la înaintare/i)
    expect(screen.getByTestId('elevation-profile')).toBeInTheDocument()
  })

  it('arată panoul complet de formule', () => {
    renderPage()

    expect(screen.getAllByText(/Viteză economică/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rezistență internă').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Randament lanț electric').length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Bilanț pachet').length).toBeGreaterThan(0)
  })
})

describe('rezumatul piloților', () => {
  it('apare după primul stint încheiat', () => {
    const store = useDriverStore.getState()
    const [first, second] = store.importRoster(['Andrei Pop', 'Maria Ionescu'])

    const totals = (distanceKm: number, energyConsumedWh: number) => ({
      totals: {
        ...new TelemetryAnalytics().totals,
        distanceKm,
        energyConsumedWh,
        activeSeconds: 600,
      },
      now: 1000,
    })

    store.selectDriver(first.id, totals(0, 0))
    store.selectDriver(second.id, totals(10, 200))

    renderPage()

    const row = screen.getByText('Andrei Pop').closest('tr') as HTMLElement
    expect(row).not.toBeNull()
    // 200 Wh pe 10 km înseamnă 20 Wh/km, atât ca medie cât și ca record.
    expect(within(row).getAllByText('20,0 Wh/km')).toHaveLength(2)
    expect(within(row).getByText('10,0 km')).toBeInTheDocument()
  })
})
