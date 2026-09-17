import { beforeEach, describe, expect, it, vi } from 'vitest'
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
