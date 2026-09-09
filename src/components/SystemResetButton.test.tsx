import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemResetButton } from './SystemResetButton'

const resetTelemetry = vi.fn()
vi.mock('../lib/telemetry-control', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/telemetry-control')>()),
  resetTelemetry: () => resetTelemetry(),
}))

describe('SystemResetButton', () => {
  beforeEach(() => resetTelemetry.mockClear())

  it('nu resetează la prima apăsare', async () => {
    const user = userEvent.setup()
    render(<SystemResetButton />)

    await user.click(screen.getByTestId('system-reset'))

    expect(resetTelemetry).not.toHaveBeenCalled()
    expect(screen.getByTestId('system-reset-confirm')).toBeInTheDocument()
  })

  it('resetează după confirmare și anunță rezultatul', async () => {
    const user = userEvent.setup()
    render(<SystemResetButton />)

    await user.click(screen.getByTestId('system-reset'))
    await user.click(screen.getByTestId('system-reset-confirm'))

    expect(resetTelemetry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Date golite, legătura repornită',
    )
  })

  it('se poate renunța la confirmare', async () => {
    const user = userEvent.setup()
    render(<SystemResetButton />)

    await user.click(screen.getByTestId('system-reset'))
    await user.click(
      screen.getByRole('button', { name: 'Renunță la resetare' }),
    )

    expect(resetTelemetry).not.toHaveBeenCalled()
    expect(screen.getByTestId('system-reset')).toBeInTheDocument()
  })

  it('dezarmează confirmarea singură după câteva secunde', () => {
    vi.useFakeTimers()

    try {
      render(<SystemResetButton />)
      // `fireEvent`, nu `userEvent`: al doilea își programează propriile
      // așteptări și se blochează sub ceasuri false.
      fireEvent.click(screen.getByTestId('system-reset'))
      expect(screen.getByTestId('system-reset-confirm')).toBeInTheDocument()

      // Un buton rămas „armat" pe un ecran din pitlane e o apăsare accidentală
      // care așteaptă să se întâmple.
      act(() => vi.advanceTimersByTime(5000))
      expect(screen.getByTestId('system-reset')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
