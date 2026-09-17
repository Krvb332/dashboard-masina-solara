import { beforeEach, describe, expect, it } from 'vitest'
import { useTelemetryStore } from './telemetry-store'
import { makeFrame } from '../test/synthetic'
import type { TelemetryFrame } from '../schemas/telemetry'

/**
 * Audit D5: închiderea tururilor când `lap_number` scade.
 *
 * Numărătorul de tururi al plăcii repornește de la 1 la o repornire a
 * firmware-ului sau la începutul unei noi sesiuni de rulare. Dashboardul
 * trebuie să reia urmărirea, nu să aștepte ca noul numărător să depășească
 * valoarea veche.
 */

function frameWithLap(index: number, lap: number): TelemetryFrame {
  const frame = makeFrame(index)
  if (frame.latest) frame.latest.signals.lap_number = lap
  return frame
}

describe('urmărirea tururilor (D5)', () => {
  beforeEach(() => {
    useTelemetryStore.getState().reset()
  })

  it('control: tururile crescătoare se închid pe rând', () => {
    const store = useTelemetryStore.getState()
    store.applyFrame(frameWithLap(0, 1))
    store.applyFrame(frameWithLap(600, 2))
    store.applyFrame(frameWithLap(1200, 3))
    expect(useTelemetryStore.getState().laps.map((lap) => lap.lap)).toEqual([
      1, 2,
    ])
  })

  it.fails(
    'D5 (defect confirmat): după ce numărătorul revine la 1, tururile noi se închid din nou',
    () => {
      const store = useTelemetryStore.getState()
      store.applyFrame(frameWithLap(0, 1))
      store.applyFrame(frameWithLap(600, 2))
      store.applyFrame(frameWithLap(1200, 5))
      // Placa repornește: numărătorul o ia de la 1.
      store.applyFrame(frameWithLap(1800, 1))
      store.applyFrame(frameWithLap(2400, 2))
      store.applyFrame(frameWithLap(3000, 3))
      const laps = useTelemetryStore.getState().laps.map((lap) => lap.lap)
      expect(laps).toEqual([1, 2, 1, 2])
    },
  )

  it('măsurătoare: câte tururi rămân neînchise după resetarea numărătorului', () => {
    const store = useTelemetryStore.getState()
    store.applyFrame(frameWithLap(0, 1))
    store.applyFrame(frameWithLap(600, 2))
    store.applyFrame(frameWithLap(1200, 5))
    store.applyFrame(frameWithLap(1800, 1))
    store.applyFrame(frameWithLap(2400, 2))
    store.applyFrame(frameWithLap(3000, 3))
    const laps = useTelemetryStore.getState().laps
    console.info(
      `[audit D5] după resetare 5→1 și tururile 1→2→3: tururi închise=${laps.length} (așteptat 4), lapTracking.lap=${useTelemetryStore.getState().lapTracking.lap}`,
    )
    expect(laps.length).toBeGreaterThan(0)
  })
})
