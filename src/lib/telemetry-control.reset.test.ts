import { beforeEach, describe, expect, it, vi } from 'vitest'

const resetCountersMock = vi.fn(() => Promise.resolve({}))

vi.mock('./api', async () => {
  const real = await vi.importActual<typeof import('./api')>('./api')
  return { ...real, resetCounters: () => resetCountersMock() }
})
import { ApiError } from './api'
import {
  consumeSnapshotHistoryDiscard,
  registerTelemetryControl,
  resetTelemetry,
} from './telemetry-control'

/**
 * Regresie: butonul "Resetează sistemul" parea ca nu face nimic.
 *
 * Golea bufferul si reconecta, iar serverul trimite la fiecare conectare un
 * snapshot cu pana la 600 de esantioane. Graficul se umplea la loc in cateva
 * sute de milisecunde, deci pe ecran nu se vedea nicio schimbare.
 */
describe('resetTelemetry si istoricul din snapshot', () => {
  beforeEach(() => {
    // golim un eventual steag ramas de la un test anterior
    consumeSnapshotHistoryDiscard()
  })

  it('cere ignorarea istoricului din snapshotul de dupa reset', () => {
    registerTelemetryControl({ reconnect: vi.fn() })

    resetTelemetry()

    expect(consumeSnapshotHistoryDiscard()).toBe(true)
  })

  it('ridica steagul INAINTE de reconectare, fiindca snapshotul poate sosi imediat', () => {
    let steagLaReconectare: boolean | null = null
    registerTelemetryControl({
      reconnect: () => {
        // citim fara sa consumam: reconnect ruleaza inaintea snapshotului
        steagLaReconectare = consumeSnapshotHistoryDiscard()
      },
    })

    resetTelemetry()

    expect(steagLaReconectare).toBe(true)
  })

  it('nu ignora istoricul la o conectare obisnuita', () => {
    expect(consumeSnapshotHistoryDiscard()).toBe(false)
  })

  it('ignora istoricul o SINGURA data, nu la fiecare reconectare ulterioara', () => {
    registerTelemetryControl({ reconnect: vi.fn() })

    resetTelemetry()

    expect(consumeSnapshotHistoryDiscard()).toBe(true)
    // o reconectare provocata de o cadere de retea trebuie sa aduca istoricul
    expect(consumeSnapshotHistoryDiscard()).toBe(false)
  })
})

/**
 * Zeroarea contoarelor este o cerere catre server, deci poate esua din motive
 * care nu au nimic de-a face cu ecranul: token de `viewer` (403), server mai
 * vechi fara endpoint (404), retea cazuta. In toate cazurile golirea ecranului
 * trebuie sa se intample oricum -- altfel adaugarea apelului ar fi o regresie
 * fata de butonul de dinainte, care macar golea graficele.
 */
describe('resetTelemetry cand serverul refuza zeroarea contoarelor', () => {
  beforeEach(() => {
    consumeSnapshotHistoryDiscard()
    resetCountersMock.mockReset()
    resetCountersMock.mockResolvedValue({})
  })

  it('goleste ecranul si reconecteaza chiar daca apelul da 403', async () => {
    resetCountersMock.mockRejectedValue(new ApiError('interzis', 403))
    const reconnect = vi.fn()
    registerTelemetryControl({ reconnect })

    resetTelemetry()
    await Promise.resolve()
    await Promise.resolve()

    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(consumeSnapshotHistoryDiscard()).toBe(true)
  })

  it('nu lasa o respingere nelegata, care ar aparea ca unhandled rejection', async () => {
    resetCountersMock.mockRejectedValue(new Error('retea cazuta'))
    registerTelemetryControl({ reconnect: vi.fn() })

    expect(() => resetTelemetry()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('chiar cheama zeroarea contoarelor la un reset reusit', () => {
    registerTelemetryControl({ reconnect: vi.fn() })

    resetTelemetry()

    expect(resetCountersMock).toHaveBeenCalledTimes(1)
  })
})
