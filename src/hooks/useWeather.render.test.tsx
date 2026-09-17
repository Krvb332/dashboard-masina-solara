import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as weatherImpact from '../lib/weather-impact'
import { useTelemetryStore } from '../stores/telemetry-store'
import { useWeatherImpact } from './useWeather'
import { makeFrame } from '../test/synthetic'

/**
 * Audit P2: cât de des se recalculează efectul vremii.
 *
 * Comentariul din `useWeatherImpact` promite „de câteva ori pe minut". Hookul
 * depinde însă de `useVehicleContext`, care depinde de `quality` — un obiect
 * nou la fiecare cadru aplicat în store (5 Hz).
 */

vi.mock('../lib/weather-impact', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/weather-impact')>()
  return { ...actual, computeWeatherImpact: vi.fn(actual.computeWeatherImpact) }
})

describe('recalcularea efectului vremii (P2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTelemetryStore.getState().reset()
    vi.mocked(weatherImpact.computeWeatherImpact).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function applyFrames(count: number): void {
    for (let index = 0; index < count; index += 1) {
      act(() => {
        useTelemetryStore.getState().applyFrame(makeFrame(index))
        vi.advanceTimersByTime(200)
      })
    }
  }

  it.fails(
    'P2 (defect confirmat): zece cadre în două secunde nu recalculează efectul vremii de zece ori',
    () => {
      renderHook(() => useWeatherImpact())
      vi.mocked(weatherImpact.computeWeatherImpact).mockClear()
      applyFrames(10)
      // Ceasul hookului bate la 2 s: într-o fereastră de 2 s ne așteptăm la cel
      // mult două recalculări, nu la una per cadru.
      expect(
        vi.mocked(weatherImpact.computeWeatherImpact).mock.calls.length,
      ).toBeLessThanOrEqual(2)
    },
  )

  it('măsurătoare: recalculări per cadru aplicat', () => {
    renderHook(() => useWeatherImpact())
    vi.mocked(weatherImpact.computeWeatherImpact).mockClear()
    applyFrames(50)
    const calls = vi.mocked(weatherImpact.computeWeatherImpact).mock.calls
      .length
    console.info(
      `[audit P2] 50 de cadre în 10 s → computeWeatherImpact apelat de ${calls} ori (≈${(calls / 10).toFixed(1)} Hz; promis: de câteva ori pe minut)`,
    )
    expect(calls).toBeGreaterThan(0)
  })
})
