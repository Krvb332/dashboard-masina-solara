import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useErrorStore, type ErrorReport } from '../stores/error-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import {
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../test/fixtures'
import { ErrorPanel, ErrorPanelToggle } from './ErrorPanel'
import { ErrorToasts } from './ErrorToasts'

const raport: ErrorReport = {
  id: 'alarm:pack-hot',
  source: 'alarm',
  severity: 'critical',
  title: 'Pachet supraîncălzit',
  message: '61 °C peste pragul de 58 °C.',
  signalKey: 'battery_temp_max_c',
}

// Confirmarea se trimite și serverului; în teste nu vrem rețea.
const ackAlarm = vi.fn((id: string) => Promise.resolve(id))
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  ackAlarm: (id: string) => ackAlarm(id),
}))

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

/** Ca în aplicație: panoul și notificările stau sub router, ca să poată naviga. */
function Ansamblu({ initialPath = '/' }: { initialPath?: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <ErrorPanelToggle />
      <ErrorPanel />
      <ErrorToasts />
      <LocationProbe />
    </MemoryRouter>
  )
}

describe('panoul de erori', () => {
  beforeEach(() => {
    useErrorStore.getState().clearAll()
    useErrorStore.getState().setPanelOpen(false)
    useErrorStore.setState({ focusRequest: null })
    useTelemetryStore.setState({ acknowledged: [] })
    seedTelemetry([makeSignal({ key: 'battery_temp_max_c', group: 'thermal' })])
    ackAlarm.mockClear()
  })

  afterEach(resetTelemetryStore)

  it('afișează o notificare la apariția unei erori', () => {
    useErrorStore.getState().sync([raport])
    render(<Ansamblu />)

    expect(screen.getByRole('alert')).toHaveTextContent('Pachet supraîncălzit')
  })

  it('închide notificarea, dar păstrează eroarea în panou', async () => {
    const user = userEvent.setup()
    useErrorStore.getState().sync([raport])
    render(<Ansamblu />)

    await user.click(
      screen.getByRole('button', { name: /Închide notificarea/ }),
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useErrorStore.getState().entries[0].active).toBe(true)
  })

  it('deschide și închide panoul de la buton', async () => {
    const user = userEvent.setup()
    useErrorStore.getState().sync([raport])
    render(<Ansamblu />)

    const toggle = screen.getByTestId('error-panel-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(useErrorStore.getState().panelOpen).toBe(true)
    expect(screen.getByTestId('error-list')).toHaveTextContent(
      'Pachet supraîncălzit',
    )

    await user.click(
      screen.getAllByRole('button', { name: 'Închide panoul de erori' })[0],
    )
    expect(useErrorStore.getState().panelOpen).toBe(false)
  })

  it('numără erorile active pe buton', () => {
    useErrorStore.getState().sync([raport, { ...raport, id: 'alarm:b' }])
    render(<Ansamblu />)

    expect(screen.getByTestId('error-panel-toggle')).toHaveTextContent('2')
  })

  it('marchează eroarea ca rezolvată, fără să o scoată din listă', async () => {
    const user = userEvent.setup()
    useErrorStore.getState().sync([raport], 1000)
    useErrorStore.getState().sync([], 2000)
    render(<Ansamblu />)

    await user.click(screen.getByTestId('error-panel-toggle'))

    const rand = screen.getByTestId('error-list').firstElementChild
    expect(rand).toHaveAttribute('data-active', 'false')
    expect(rand).toHaveTextContent('Pachet supraîncălzit')
    // Rezolvată: nu mai are ce notifica.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('confirmă alarmele din panou, local și pe server', async () => {
    const user = userEvent.setup()
    useErrorStore.getState().sync([raport])
    render(<Ansamblu />)

    await user.click(screen.getByTestId('error-panel-toggle'))
    await user.click(screen.getByRole('button', { name: /Confirmă alarma/ }))

    expect(useTelemetryStore.getState().acknowledged).toEqual(['pack-hot'])
    expect(ackAlarm).toHaveBeenCalledWith('pack-hot')
    // Confirmarea estompează alarma, nu o ascunde: condiția e încă prezentă.
    expect(screen.getByTestId('error-list')).toHaveTextContent(
      'Pachet supraîncălzit',
    )
  })

  it('nu oferă confirmare pentru erorile care nu vin din alarme', async () => {
    const user = userEvent.setup()
    useErrorStore
      .getState()
      .sync([{ ...raport, id: 'fault:17', source: 'fault' }])
    render(<Ansamblu />)

    await user.click(screen.getByTestId('error-panel-toggle'))

    expect(
      screen.queryByRole('button', { name: /Confirmă alarma/ }),
    ).not.toBeInTheDocument()
  })
})

describe('drumul de la eroare la sursa ei', () => {
  beforeEach(() => {
    useErrorStore.getState().clearAll()
    useErrorStore.getState().setPanelOpen(false)
    useErrorStore.setState({ focusRequest: null })
    seedTelemetry([makeSignal({ key: 'battery_temp_max_c', group: 'thermal' })])
  })

  afterEach(resetTelemetryStore)

  it('un click pe eroarea din panou închide panoul și duce la pagina semnalului', async () => {
    const user = userEvent.setup()
    useErrorStore.getState().sync([raport])
    render(<Ansamblu initialPath="/" />)

    await user.click(screen.getByTestId('error-panel-toggle'))
    await user.click(
      within(screen.getByTestId('error-list')).getByTestId('error-locate'),
    )

    expect(useErrorStore.getState().panelOpen).toBe(false)
    expect(screen.getByTestId('location')).toHaveTextContent('/sistem')
    expect(useErrorStore.getState().focusRequest?.selectors).toEqual([
      '[data-signal="battery_temp_max_c"]',
    ])
  })

  it('un click pe notificare o închide și duce la sursă', async () => {
    const user = userEvent.setup()
    useErrorStore
      .getState()
      .sync([{ ...raport, id: 'fault:17', source: 'fault' }])
    render(<Ansamblu initialPath="/energie" />)

    await user.click(
      within(screen.getByRole('alert')).getByTestId('error-toast-locate'),
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useErrorStore.getState().entries[0]).toMatchObject({
      dismissed: true,
      active: true,
    })
    expect(screen.getByTestId('location')).toHaveTextContent('/sistem')
    expect(useErrorStore.getState().focusRequest?.selectors).toEqual([
      '[data-fault-bit="17"]',
      '[data-error-anchor="faults"]',
    ])
  })

  it('o eroare rezolvată duce tot la locul ei', async () => {
    const user = userEvent.setup()
    useErrorStore.getState().sync([raport], 1000)
    useErrorStore.getState().sync([], 2000)
    render(<Ansamblu initialPath="/" />)

    await user.click(screen.getByTestId('error-panel-toggle'))
    await user.click(screen.getByTestId('error-locate'))

    expect(screen.getByTestId('location')).toHaveTextContent('/sistem')
  })

  it('o alarmă fără semnal atașat rămâne text, nu buton', async () => {
    const user = userEvent.setup()
    useErrorStore
      .getState()
      .sync([{ ...raport, id: 'alarm:generic', signalKey: undefined }])
    render(<Ansamblu />)

    expect(screen.queryByTestId('error-toast-locate')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('error-panel-toggle'))
    expect(screen.queryByTestId('error-locate')).not.toBeInTheDocument()
    expect(screen.getByTestId('error-list')).toHaveTextContent(
      'Pachet supraîncălzit',
    )
  })

  it('butonul de confirmare rămâne apăsabil peste zona de click a rândului', async () => {
    const user = userEvent.setup()
    useErrorStore.getState().sync([raport])
    render(<Ansamblu />)

    await user.click(screen.getByTestId('error-panel-toggle'))
    await user.click(screen.getByRole('button', { name: /Confirmă alarma/ }))

    expect(useTelemetryStore.getState().acknowledged).toEqual(['pack-hot'])
    // Confirmarea nu a declanșat și navigarea.
    expect(useErrorStore.getState().panelOpen).toBe(true)
    expect(useErrorStore.getState().focusRequest).toBeNull()
  })
})
