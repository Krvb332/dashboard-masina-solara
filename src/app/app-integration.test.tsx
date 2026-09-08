import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { SystemPage } from '../features/system/SystemPage'
import { useTelemetryStore } from '../stores/telemetry-store'
import { AppLayout } from './layout/AppLayout'

// Graficele folosesc canvas, care nu este randat în jsdom.
vi.mock('../components/TelemetryChart', () => ({
  TelemetryChart: () => <div data-testid="telemetry-chart" />,
}))
vi.mock('../components/TrackMap', () => ({
  TrackMap: () => <div data-testid="track-map" />,
}))

function renderApp(initialPath = '/') {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'sistem', element: <SystemPage /> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  )

  return render(<RouterProvider router={router} />)
}

/**
 * Verifică lanțul complet: sursa de telemetrie porneşte, cadrele ajung în
 * store, bucla de publicare le trimite în React, iar interfața le afișează.
 * Fără server configurat, sursa implicită este simulatorul.
 */
describe('aplicația pe simulator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTelemetryStore.getState().reset()
    useTelemetryStore.getState().setSource('simulator', '')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('nu afișează valori înainte de primul cadru', () => {
    renderApp()

    expect(screen.getByRole('status')).toHaveTextContent(/Se așteaptă date/)
  })

  it('afișează date reale după ce simulatorul începe să emită', () => {
    renderApp()

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    // Viteza este formatată în română, cu virgulă zecimală.
    expect(screen.getByText(/km\/h$/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Telemetrie conectată')
    expect(useTelemetryStore.getState().stats.received).toBeGreaterThan(0)
  })

  it('raportează statisticile legăturii în pagina de sistem', () => {
    renderApp('/sistem')

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    expect(screen.getByText('Mesaje primite')).toBeInTheDocument()
    // Simulatorul nu pierde mesaje: secvența este continuă.
    expect(useTelemetryStore.getState().stats.gaps).toBe(0)
    expect(useTelemetryStore.getState().stats.invalid).toBe(0)
  })
})
