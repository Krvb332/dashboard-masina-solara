import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useErrorStore, type ErrorReport } from '../stores/error-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { ErrorPanel, ErrorPanelToggle } from './ErrorPanel'
import { ErrorToasts } from './ErrorToasts'

const raport: ErrorReport = {
  id: 'alarm:pack-hot',
  source: 'alarm',
  severity: 'critical',
  title: 'Pachet supraîncălzit',
  message: '61 °C peste pragul de 58 °C.',
}

// Confirmarea se trimite și serverului; în teste nu vrem rețea.
const ackAlarm = vi.fn((id: string) => Promise.resolve(id))
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  ackAlarm: (id: string) => ackAlarm(id),
}))

function Ansamblu() {
  return (
    <>
      <ErrorPanelToggle />
      <ErrorPanel />
      <ErrorToasts />
    </>
  )
}

describe('panoul de erori', () => {
  beforeEach(() => {
    useErrorStore.getState().clearAll()
    useErrorStore.getState().setPanelOpen(false)
    useTelemetryStore.setState({ acknowledged: [] })
    ackAlarm.mockClear()
  })

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
