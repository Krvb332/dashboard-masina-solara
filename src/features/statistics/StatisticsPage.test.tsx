import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelemetryAnalytics, type QualityEntry } from '../../lib/analytics'
import { useAnalyticsStore } from '../../stores/analytics-store'
import { resetDriverStore, useDriverStore } from '../../stores/driver-store'
import { resetTelemetryStore } from '../../test/fixtures'
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

const valid = (value: number): QualityEntry => ({ state: 'valid', value })

function renderPage() {
  return render(
    <MemoryRouter>
      <StatisticsPage />
    </MemoryRouter>,
  )
}

/** Publică în store un snapshot obținut dintr-o sesiune simulată reală. */
function publishRun(): void {
  const analytics = new TelemetryAnalytics()

  // Zece secunde la 45 km/h, 1800 W din pachet, 900 W de la panouri,
  // 300 W recuperați, contoare crescătoare.
  for (let step = 0; step <= 50; step += 1) {
    analytics.update({
      timeMs: step * 200,
      quality: {
        vehicle_speed_kph: valid(45),
        battery_power_w: valid(1800),
        solar_power_w: valid(900),
        regen_power_w: valid(300),
        motor_power_w: valid(1600),
        battery_soc_pct: valid(70),
        battery_voltage_v: valid(115),
        battery_current_a: valid(15.65),
        distance_km: valid(step * 0.0025),
        energy_consumed_wh: valid(step * 0.1),
        energy_solar_wh: valid(step * 0.05),
        energy_regen_wh: valid(step * 0.0167),
        gps_altitude_m: valid(340),
        throttle_pct: valid(38),
      },
    })
  }

  useAnalyticsStore.getState().publish(analytics.snapshot())
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
  it('spune explicit că nu are ce recomanda', () => {
    renderPage()

    expect(screen.getByText(/Fără date de la mașină/i)).toBeInTheDocument()
  })

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
    publishRun()
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
      .getAllByText('Consum specific (sesiune)')
      .map((node) => node.closest('[data-stat]'))
      .find(Boolean) as HTMLElement

    expect(within(specific).getByText('40,0')).toBeInTheDocument()
  })

  it('afișează pragul susținut de aportul solar', () => {
    renderPage()

    // 900 W la 45 km/h susțin 20 Wh/km.
    const threshold = screen
      .getAllByText('Prag susținut de soare')
      .map((node) => node.closest('[data-stat]'))
      .find(Boolean) as HTMLElement

    expect(within(threshold).getByText('20,0')).toBeInTheDocument()
  })

  it('transmite pilotului o recomandare cu acțiune concretă', () => {
    renderPage()

    // 40 Wh/km față de 20 susținuți: dublu față de echilibru.
    const advice = document.querySelector('[data-advice="energy-deficit"]')
    expect(advice).not.toBeNull()
    expect(advice?.textContent).toMatch(/condu mai economic/i)
  })

  it('reacționează imediat la o țintă de strategie nouă', () => {
    renderPage()
    expect(document.querySelector('[data-advice="range-short"]')).toBeNull()

    useAnalyticsStore.getState().setStrategy({ remainingDistanceKm: 5000 })

    renderPage()
    expect(document.querySelector('[data-advice="range-short"]')).not.toBeNull()
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

    expect(screen.getAllByText('Viteză economică').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rezistență internă').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Randament lanț electric').length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Bilanț energetic').length).toBeGreaterThan(0)
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
