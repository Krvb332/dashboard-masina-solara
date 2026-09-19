import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { anchorSelector, signalSelector } from '../../lib/error-locator'
import { useTelemetryStore } from '../../stores/telemetry-store'
import {
  makeQuality,
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../../test/fixtures'
import { SystemPage } from './SystemPage'

// Starea serviciului vine prin HTTP; în teste nu vrem rețea.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  fetchHealth: () => Promise.reject(new Error('fără rețea în teste')),
}))

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={['/sistem']}>
        <SystemPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ancorele pentru jurnalul de erori', () => {
  beforeEach(() => {
    seedTelemetry(
      [
        makeSignal({ key: 'battery_temp_max_c', group: 'thermal' }),
        makeSignal({ key: 'motor_fault_code', group: 'motor', decimals: 0 }),
        makeSignal({ key: 'lap_number', group: 'status', decimals: 0 }),
      ],
      {
        battery_temp_max_c: makeQuality('valid', 41),
        // Bitul 17 (supracurent) ridicat.
        motor_fault_code: makeQuality('valid', 1 << 17),
      },
    )
    useTelemetryStore.setState({ connection: 'disconnected', invalidFrames: 5 })
  })

  afterEach(resetTelemetryStore)

  it('legătura și cadrele invalide au rând propriu în sănătatea fluxului', () => {
    renderPage()

    expect(
      document.querySelector(anchorSelector('connection')),
    ).toHaveTextContent('deconectată')
    expect(
      document.querySelector(anchorSelector('stream-invalid')),
    ).toHaveTextContent('5')
  })

  it('bitul activ al controllerului are rând, iar panoul este rezerva lui', () => {
    renderPage()

    const row = document.querySelector('[data-fault-bit="17"]')
    expect(row).toHaveTextContent('Supracurent')
    expect(
      document.querySelector(anchorSelector('faults'))?.contains(row),
    ).toBe(true)
  })

  it('un semnal cu rând în panouri se găsește acolo, nu în tabelul de calitate', () => {
    renderPage()

    const found = document.querySelector(signalSelector('battery_temp_max_c'))
    expect(found?.tagName).toBe('LI')
  })

  it('tabelul de calitate este rezerva oricărui semnal din catalog', () => {
    renderPage()

    const cells = document.querySelectorAll(signalSelector('lap_number'))
    expect(cells).toHaveLength(1)
    expect(cells[0].tagName).toBe('TD')
    expect(cells[0]).toHaveTextContent('lap_number')
  })
})
