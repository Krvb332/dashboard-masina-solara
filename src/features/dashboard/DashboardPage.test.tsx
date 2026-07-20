import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

vi.mock('../../components/TelemetryChart', () => ({
  TelemetryChart: () => <div data-testid="telemetry-chart" />,
}))

describe('DashboardPage', () => {
  it('afișează starea principală a telemetriei', () => {
    render(<DashboardPage />)

    expect(
      screen.getByRole('heading', { name: 'Mașina solară 01' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Telemetrie conectată')
    expect(screen.getByText('76,2%')).toBeInTheDocument()
    expect(screen.getByTestId('telemetry-chart')).toBeInTheDocument()
  })
})
