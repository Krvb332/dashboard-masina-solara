import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'
import type { TelemetryFrame } from '../../schemas/telemetry'
import { useTelemetryStore } from '../../stores/telemetry-store'

vi.mock('../../components/TelemetryChart', () => ({
  TelemetryChart: () => <div data-testid="telemetry-chart" />,
}))

function publish(signals: TelemetryFrame['signals'], sequence = 1) {
  const store = useTelemetryStore.getState()
  store.ingestFrame(
    {
      schema_version: 1,
      vehicle_id: 'tucn-solar-01',
      session_id: 'test',
      timestamp: new Date().toISOString(),
      sequence,
      signals,
    },
    Date.now(),
  )
  store.commit()
}

describe('DashboardPage', () => {
  beforeEach(() => {
    useTelemetryStore.getState().reset()
  })

  it('afișează valorile primite de la telemetrie', () => {
    publish({
      vehicle_speed_kph: 63.8,
      battery_soc_pct: 76.2,
      solar_power_w: 1_040,
      cell_temp_max_c: 41.7,
    })

    render(<DashboardPage />)

    expect(screen.getByText('63,8 km/h')).toBeInTheDocument()
    expect(screen.getByText('76,2 %')).toBeInTheDocument()
    expect(screen.getByTestId('telemetry-chart')).toBeInTheDocument()
  })

  it('afișează un marcaj de „fără date" înainte de primul mesaj', () => {
    render(<DashboardPage />)

    // Toate cele patru carduri sunt goale — niciunul nu trebuie să arate zero.
    expect(screen.getAllByText('—')).toHaveLength(4)
    expect(screen.queryByText('0 W')).not.toBeInTheDocument()
  })

  it('distinge zero de lipsa datelor', () => {
    publish({ solar_power_w: 0 })

    render(<DashboardPage />)

    expect(screen.getByText('0 W')).toBeInTheDocument()
  })

  it('ridică alarmă când o valoare depășește pragul critic', () => {
    publish({ battery_soc_pct: 8 })

    render(<DashboardPage />)

    expect(screen.getByText(/Baterie sub prag/)).toBeInTheDocument()
  })

  it('anunță că nu există alarme când totul este în limite', () => {
    publish({ battery_soc_pct: 76.2, motor_temp_c: 45 })

    render(<DashboardPage />)

    expect(screen.getByText('Nicio alarmă activă')).toBeInTheDocument()
  })
})
