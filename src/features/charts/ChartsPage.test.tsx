import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTelemetryStore } from '../../test/fixtures'
import { ChartsPage } from './ChartsPage'

// Canvas și ECharts nu au sens în jsdom; ne interesează ce reprezentări compune
// pagina și pe ce semnale, nu desenul propriu-zis.
vi.mock('../../components/TelemetryChart', () => ({
  TelemetryChart: ({
    ariaLabel,
    signalKeys,
  }: {
    ariaLabel?: string
    signalKeys: string[]
  }) => (
    <div
      data-testid="telemetry-chart"
      data-label={ariaLabel}
      data-keys={signalKeys.join(',')}
    />
  ),
}))
vi.mock('../../components/ElevationProfile', () => ({
  ElevationProfileChart: () => <div data-testid="elevation-profile" />,
}))
vi.mock('../../components/TrackMap', () => ({
  TrackMap: () => <div data-testid="track-map" />,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <ChartsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  resetTelemetryStore()
})

describe('pagina de grafice', () => {
  it('compune numai reprezentări grafice', () => {
    renderPage()

    expect(screen.getAllByTestId('telemetry-chart').length).toBeGreaterThan(0)
    expect(screen.getByTestId('track-map')).toBeInTheDocument()
    expect(screen.getByTestId('elevation-profile')).toBeInTheDocument()
  })

  it('nu aduce cifre, formule sau explicații', () => {
    const { container } = renderPage()

    // Cardurile cu valoare și formulă se marchează cu `data-stat`; un tabel sau
    // un paragraf de explicație ar însemna că pagina a început să scrie, nu să
    // deseneze — exact ce nu are voie să facă.
    expect(container.querySelector('[data-stat]')).toBeNull()
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('p')).toBeNull()
  })

  it('desenează semnalele măsurate și pe cele derivate', () => {
    renderPage()

    const keys = screen
      .getAllByTestId('telemetry-chart')
      .flatMap((node) => (node.getAttribute('data-keys') ?? '').split(','))

    // Un semnal de pe fiecare magistrală, ca o pagină golită de jumătate din
    // surse să nu mai treacă testul.
    expect(keys).toContain('vehicle_speed_kph')
    expect(keys).toContain('battery_power_w')
    expect(keys).toContain('motor_temp_c')
    expect(keys).toContain('mppt1_power_w')
    expect(keys).toContain('cell_voltage_delta_v')
    // Derivatele nu vin de la mașină, ci din bufferul calculat local.
    expect(keys).toContain('calc_wh_per_km')
  })

  it('fiecare grafic are o descriere pentru cititorul de ecran', () => {
    renderPage()

    for (const chart of screen.getAllByTestId('telemetry-chart')) {
      expect(chart.getAttribute('data-label')).toBeTruthy()
    }
  })
})
