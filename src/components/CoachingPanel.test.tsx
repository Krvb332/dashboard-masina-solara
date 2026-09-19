import { render } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAnalyticsStore } from '../stores/analytics-store'
import { publishSimulatedRun, resetTelemetryStore } from '../test/fixtures'
import { CoachingPanel } from './CoachingPanel'

/**
 * Testele astea au stat pe pagina de statistici, de unde panoul a fost scos.
 * Comportamentul a rămas, așa că au venit lângă componentă: recomandarea se
 * calculează din instantaneul publicat și din ținta de strategie, indiferent pe
 * ce ecran este pus panoul.
 */

beforeEach(() => {
  resetTelemetryStore()
  useAnalyticsStore.getState().clear()
  useAnalyticsStore.getState().setStrategy({
    targetWhPerKm: null,
    remainingDistanceKm: null,
  })
})

afterEach(() => {
  useAnalyticsStore.getState().clear()
})

describe('fără date de la mașină', () => {
  it('spune explicit că nu are ce recomanda', () => {
    render(<CoachingPanel />)

    expect(screen.getByText(/Fără date de la mașină/i)).toBeInTheDocument()
  })
})

describe('cu flux activ', () => {
  beforeEach(() => {
    publishSimulatedRun()
  })

  it('transmite pilotului o recomandare cu acțiune concretă', () => {
    render(<CoachingPanel />)

    // 40 Wh/km față de 20 susținuți: dublu față de echilibru.
    const advice = document.querySelector('[data-advice="energy-deficit"]')
    expect(advice).not.toBeNull()
    expect(advice?.textContent).toMatch(/condu mai economic/i)
  })

  it('reacționează imediat la o țintă de strategie nouă', () => {
    render(<CoachingPanel />)
    expect(document.querySelector('[data-advice="range-short"]')).toBeNull()

    useAnalyticsStore.getState().setStrategy({ remainingDistanceKm: 5000 })

    render(<CoachingPanel />)
    expect(document.querySelector('[data-advice="range-short"]')).not.toBeNull()
  })
})
