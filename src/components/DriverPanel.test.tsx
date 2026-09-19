import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_TOTALS } from '../lib/analytics'
import { safeStorage } from '../lib/safe-storage'
import {
  DRIVER_STORAGE_KEY,
  resetDriverStore,
  useDriverStore,
} from '../stores/driver-store'
import { DriverPanel } from './DriverPanel'

/**
 * Ștergerea stinturilor din tabel: doar cele încheiate, doar cu confirmare.
 * Stintul în curs este o măsurătoare care încă se face; se coboară întâi.
 */

function seed() {
  const store = useDriverStore.getState()
  const andrei = store.createProfile('Andrei Pop')
  const maria = store.createProfile('Maria Ionescu')
  store.selectDriver(andrei.id, { totals: EMPTY_TOTALS, now: 1000 })
  store.selectDriver(maria.id, {
    totals: { ...EMPTY_TOTALS, distanceKm: 12, energyConsumedWh: 600 },
    now: 2000,
  })
  const closed = useDriverStore
    .getState()
    .stints.find((stint) => stint.driverId === andrei.id)
  if (closed === undefined) throw new Error('stintul închis lipsește')
  return { andrei, maria, closed }
}

function row(stintId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-stint="${stintId}"]`,
  )
  if (element === null) throw new Error(`rândul ${stintId} lipsește`)
  return element
}

beforeEach(() => {
  safeStorage().removeItem(DRIVER_STORAGE_KEY)
  resetDriverStore()
})

describe('DriverPanel — ștergerea stinturilor', () => {
  it('oferă ștergere doar pentru stinturile încheiate', () => {
    seed()
    render(<DriverPanel />)

    const buttons = screen.getAllByRole('button', { name: /Șterge stintul/ })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName(/Andrei Pop/)
  })

  it('nu șterge la prima apăsare, ci cere confirmare', async () => {
    const user = userEvent.setup()
    const { closed } = seed()
    render(<DriverPanel />)

    await user.click(screen.getByRole('button', { name: /Șterge stintul/ }))

    expect(useDriverStore.getState().stints).toHaveLength(2)
    expect(
      within(row(closed.id)).getByRole('button', { name: 'Șterge' }),
    ).toBeInTheDocument()
  })

  it('după confirmare, stintul dispare din tabel și din totalul pilotului', async () => {
    const user = userEvent.setup()
    const { andrei, closed } = seed()
    render(<DriverPanel />)

    await user.click(screen.getByRole('button', { name: /Șterge stintul/ }))
    await user.click(
      within(row(closed.id)).getByRole('button', { name: 'Șterge' }),
    )

    expect(useDriverStore.getState().stints).toHaveLength(1)
    expect(document.querySelector(`[data-stint="${closed.id}"]`)).toBeNull()
    expect(useDriverStore.getState().aggregate(andrei.id).distanceKm).toBe(0)
  })

  it('se poate renunța la ștergere', async () => {
    const user = userEvent.setup()
    const { closed } = seed()
    render(<DriverPanel />)

    await user.click(screen.getByRole('button', { name: /Șterge stintul/ }))
    await user.click(within(row(closed.id)).getByRole('button', { name: 'Nu' }))

    expect(useDriverStore.getState().stints).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: /Șterge stintul/ }),
    ).toBeInTheDocument()
  })

  it('golirea istoricului cere confirmare și păstrează stintul în curs', async () => {
    const user = userEvent.setup()
    const { maria } = seed()
    render(<DriverPanel />)

    await user.click(screen.getByTestId('stints-clear'))
    expect(useDriverStore.getState().stints).toHaveLength(2)

    await user.click(screen.getByTestId('stints-clear-confirm'))

    const { stints, activeStintId, activeDriverId } = useDriverStore.getState()
    expect(stints).toHaveLength(1)
    expect(stints[0]?.id).toBe(activeStintId)
    expect(activeDriverId).toBe(maria.id)
    // Fără stinturi încheiate nu mai e nimic de golit.
    expect(screen.queryByTestId('stints-clear')).not.toBeInTheDocument()
  })
})
