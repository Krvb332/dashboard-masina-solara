import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TelemetryChart } from './TelemetryChart'
import { TrackMap } from './TrackMap'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Restul testelor înlocuiesc graficele cu un dublu, pentru că `echarts` are
 * nevoie de canvas. Aici le randăm pe cele reale: un import greșit al
 * componentei ECharts nu produce nicio eroare de tipuri, dar face aplicația să
 * cadă la rulare cu „Element type is invalid".
 */
describe('componentele de grafic', () => {
  beforeEach(() => {
    useTelemetryStore.getState().reset()
  })

  it('TelemetryChart se randează fără date', () => {
    const { container } = render(
      <TelemetryChart
        series={[{ signal: 'solar_power_w', label: 'Solar', color: '#fbbf24' }]}
        ariaLabel="Test"
      />,
    )

    expect(container.querySelector('.echarts-for-react')).not.toBeNull()
  })

  it('TrackMap arată un marcaj explicit când nu există poziție GPS', () => {
    const { getByText } = render(<TrackMap />)

    expect(getByText('Fără poziție GPS')).toBeInTheDocument()
  })
})
