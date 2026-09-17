import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSignal } from './useSignal'
import { useTelemetryStore } from '../stores/telemetry-store'
import { makeFrame } from '../test/synthetic'

/**
 * Audit P4: câte re-randări produce un cadru care nu schimbă nimic.
 *
 * `applyFrame` publică `quality` ca obiect nou la fiecare cadru (5 Hz). Un
 * selector `state.quality[key]` întoarce atunci o referință nouă chiar dacă
 * starea și valoarea sunt identice, iar fiecare consumator se re-randează.
 * Pe pagina Energie sunt ~70 de asemenea consumatori (32 celule + rânduri).
 */

let renders = 0

function Probe({ signalKey }: { signalKey: string }) {
  const view = useSignal(signalKey)
  const count = useRef(0)
  count.current += 1
  renders += 1
  return <span data-testid="value">{view.value}</span>
}

describe('re-randări per cadru (P4)', () => {
  beforeEach(() => {
    renders = 0
    useTelemetryStore.getState().reset()
  })

  it.fails(
    'P4 (defect confirmat): zece cadre cu aceeași valoare nu re-randează consumatorul de zece ori',
    () => {
      render(<Probe signalKey="battery_voltage_v" />)
      const frame = makeFrame(0)
      act(() => useTelemetryStore.getState().applyFrame(frame))
      const afterFirst = renders
      for (let index = 0; index < 10; index += 1) {
        // Același eșantion, retrimis: nicio valoare nu s-a schimbat.
        act(() => useTelemetryStore.getState().applyFrame(makeFrame(0)))
      }
      expect(renders - afterFirst).toBeLessThanOrEqual(1)
    },
  )

  it('măsurătoare: re-randări la 50 de cadre identice, pentru 40 de consumatori', () => {
    const keys = Array.from(
      { length: 40 },
      (_, index) => `cell_${String((index % 32) + 1).padStart(2, '0')}_v`,
    )
    render(
      <>
        {keys.map((key, index) => (
          <Probe key={`${key}-${index}`} signalKey={key} />
        ))}
      </>,
    )
    act(() => useTelemetryStore.getState().applyFrame(makeFrame(0)))
    const afterFirst = renders
    for (let index = 0; index < 50; index += 1) {
      act(() => useTelemetryStore.getState().applyFrame(makeFrame(0)))
    }
    const extra = renders - afterFirst
    console.info(
      `[audit P4] 50 de cadre identice × 40 consumatori useSignal → ${extra} re-randări (${(extra / 50).toFixed(0)} per cadru; la 5 Hz ≈ ${(extra / 50) * 5} re-randări/s pentru un panou de celule)`,
    )
    expect(extra).toBeGreaterThanOrEqual(0)
  })
})
