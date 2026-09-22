import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../lib/analytics'
import { derivedBuffer } from '../lib/derived-buffer'
import { resetDriverStore, useDriverStore } from '../stores/driver-store'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { makeFrame } from '../test/synthetic'
import { useAnalyticsEngine } from './useAnalyticsEngine'

/**
 * În replay, motorul live stă. Acumulatorul sesiunii redate este al driverului
 * de replay și merge pe timpul virtual; dacă motorul live ar continua să
 * integreze pe `Date.now()`, o pauză de un minut ar aduna un minut de energie,
 * iar seriile derivate ar primi puncte pe ceasul browserului.
 */

describe('motorul de statistici în timpul redării', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    analytics.reset()
    derivedBuffer.clear()
    resetDriverStore()
    useTelemetryStore.getState().reset()
    useTelemetryStore.setState({ vehicleId: null, sessionId: null })
    useSessionStore.getState().exitReplay()
  })

  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().exitReplay()
  })

  it('nu acumulează, nu scrie serii derivate și nu atinge stintul pilotului', () => {
    renderHook(() => useAnalyticsEngine())
    act(() => useSessionStore.getState().setMode('replay'))

    const frame = makeFrame(0)
    frame.session_id = 'sesiune-redata'
    act(() => useTelemetryStore.getState().applyFrame(frame))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(analytics.totals.samples).toBe(0)
    expect(analytics.totals.energyConsumedWh).toBe(0)
    expect(derivedBuffer.size).toBe(0)
    expect(useDriverStore.getState().profiles).toHaveLength(0)
  })

  it('nu taie stintul și nu pune contoarele pe zero la intrarea și ieșirea din replay', () => {
    renderHook(() => useAnalyticsEngine())

    // Sesiunea live, cu ceva acumulat.
    act(() => useTelemetryStore.getState().applyFrame(makeFrame(0)))
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    const liveSamples = analytics.totals.samples
    expect(liveSamples).toBeGreaterThan(0)
    const splitStint = vi.spyOn(useDriverStore.getState(), 'splitStint')

    // Intrare în replay: store-ul poartă id-ul sesiunii redate.
    act(() => useSessionStore.getState().setMode('replay'))
    const replayed = makeFrame(1)
    replayed.session_id = 'sesiune-redata'
    act(() => useTelemetryStore.getState().applyFrame(replayed))

    // Ieșire: revine id-ul sesiunii live de dinainte.
    act(() => useSessionStore.getState().exitReplay())
    act(() => useTelemetryStore.getState().applyFrame(makeFrame(2)))

    expect(analytics.totals.samples).toBe(liveSamples)
    expect(splitStint).not.toHaveBeenCalled()
  })
})
