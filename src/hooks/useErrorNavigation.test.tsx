import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useErrorStore } from '../stores/error-store'
import {
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../test/fixtures'
import {
  revealErrorTarget,
  useErrorFocus,
  useGoToErrorSource,
} from './useErrorNavigation'

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function Focus() {
  useErrorFocus()
  return null
}

function GoTo({ signalKey }: { signalKey: string }) {
  const goTo = useGoToErrorSource()
  return (
    <button
      type="button"
      onClick={() =>
        goTo({ id: `alarm:${signalKey}`, source: 'alarm', signalKey })
      }
    >
      mergi
    </button>
  )
}

beforeEach(() => {
  useErrorStore.setState({ focusRequest: null })
  seedTelemetry([
    makeSignal({ key: 'battery_voltage_v', group: 'energy' }),
    makeSignal({ key: 'battery_soc_pct', group: 'energy', overview: true }),
  ])
})

afterEach(() => {
  resetTelemetryStore()
  vi.restoreAllMocks()
})

describe('useGoToErrorSource', () => {
  it('schimbă pagina și depune cererea de evidențiere', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/']}>
        <GoTo signalKey="battery_voltage_v" />
        <LocationProbe />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'mergi' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/energie')
    expect(useErrorStore.getState().focusRequest).toEqual({
      selectors: ['[data-signal="battery_voltage_v"]'],
      token: 1,
    })
  })

  it('nu schimbă pagina dacă elementul este deja pe ecran', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/traseu']}>
        <div data-signal="battery_voltage_v">card</div>
        <GoTo signalKey="battery_voltage_v" />
        <LocationProbe />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'mergi' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/traseu')
    expect(useErrorStore.getState().focusRequest?.selectors).toEqual([
      '[data-signal="battery_voltage_v"]',
    ])
  })

  it('al doilea click pe aceeași eroare produce o cerere nouă', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/energie']}>
        <GoTo signalKey="battery_voltage_v" />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'mergi' }))
    await user.click(screen.getByRole('button', { name: 'mergi' }))

    expect(useErrorStore.getState().focusRequest?.token).toBe(2)
  })
})

describe('useErrorFocus', () => {
  it('evidențiază elementul, îl derulează în vedere și deschide <details> închise', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    render(
      <>
        <Focus />
        <details data-testid="details">
          <summary>Diagnostic</summary>
          <ul>
            <li data-signal="mppt1_mode">rând</li>
          </ul>
        </details>
      </>,
    )
    expect(screen.getByTestId('details')).not.toHaveAttribute('open')

    act(() => {
      useErrorStore.getState().requestFocus(['[data-signal="mppt1_mode"]'])
    })

    const row = screen.getByText('rând')
    await waitFor(() => expect(row).toHaveAttribute('data-error-focus'))
    expect(screen.getByTestId('details')).toHaveAttribute('open')
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' }),
    )
    expect(document.activeElement).toBe(row)
  })

  it('așteaptă elementul care apare abia după randarea paginii noi', async () => {
    const { rerender } = render(<Focus />)

    act(() => {
      useErrorStore.getState().requestFocus(['[data-signal="gps_hdop"]'])
    })

    rerender(
      <>
        <Focus />
        <li data-signal="gps_hdop">HDOP</li>
      </>,
    )

    await waitFor(() =>
      expect(screen.getByText('HDOP')).toHaveAttribute('data-error-focus'),
    )
  })
})

describe('revealErrorTarget', () => {
  it('desenează inelul pe rândul care conține valoarea, nu pe cifră', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<li id="rand"><span data-signal="motor_rpm">1 200</span></li>'
    document.body.append(root)

    const value = root.querySelector<HTMLElement>('[data-signal]')!
    const clear = revealErrorTarget(value)

    const row = root.querySelector('#rand')!
    expect(row).toHaveAttribute('data-error-focus')
    expect(value).not.toHaveAttribute('data-error-focus')

    // Ridicarea evidențierii lasă elementul exact cum era.
    clear()
    expect(row).not.toHaveAttribute('data-error-focus')
    expect(row).not.toHaveAttribute('tabindex')
    root.remove()
  })
})
