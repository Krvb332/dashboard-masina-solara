import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../lib/analytics'
import { resetDriverStore } from '../stores/driver-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { useAnalyticsEngine } from './useAnalyticsEngine'
import { makeFrame } from '../test/synthetic'

/**
 * Audit D4: motorul de statistici integrează pe ceasul browserului.
 *
 * În replay pe pauză, calitatea semnalelor rămâne `valid` (vârsta se calculează
 * la timpul virtual, care stă pe loc). Motorul citește însă `Date.now()`, deci
 * continuă să integreze puterea peste minutele în care nu s-a redat nimic.
 */

describe('motorul de statistici și ceasul real (D4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    analytics.reset()
    resetDriverStore()
    useTelemetryStore.getState().reset()
    useTelemetryStore.setState({ vehicleId: null, sessionId: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function freezeFrameWithoutCounters(): void {
    const frame = makeFrame(0)
    if (frame.latest) {
      // Fără contoare cumulate, energia se integrează din putere.
      delete frame.latest.signals.energy_consumed_wh
      delete frame.latest.signals.distance_km
      delete frame.latest.signals.energy_solar_wh
      delete frame.latest.signals.energy_regen_wh
      frame.latest.signals.battery_power_w = 1000
    }
    delete frame.quality.energy_consumed_wh
    delete frame.quality.distance_km
    delete frame.quality.energy_solar_wh
    delete frame.quality.energy_regen_wh
    frame.quality.battery_power_w = { state: 'valid', age_ms: 0, value: 1000 }
    frame.quality.vehicle_speed_kph = { state: 'valid', age_ms: 0, value: 45 }
    act(() => useTelemetryStore.getState().applyFrame(frame))
  }

  it.fails(
    'D4 (defect confirmat): cu starea înghețată (replay pe pauză), energia nu crește',
    () => {
      renderHook(() => useAnalyticsEngine())
      freezeFrameWithoutCounters()
      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      // 60 s de pauză cu 1000 W „valid" nu înseamnă 16,7 Wh consumați.
      expect(analytics.totals.energyConsumedWh).toBeLessThan(0.5)
    },
  )

  it('măsurătoare: câtă energie și distanță se adună într-un minut de pauză', () => {
    renderHook(() => useAnalyticsEngine())
    freezeFrameWithoutCounters()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    console.info(
      `[audit D4] 60 s cu aceeași stare, fără cadre noi: energyConsumedWh=${analytics.totals.energyConsumedWh.toFixed(2)} Wh, distanceKm=${analytics.totals.distanceKm.toFixed(3)} km, activeSeconds=${analytics.totals.activeSeconds.toFixed(1)} s`,
    )
    expect(analytics.totals.samples).toBeGreaterThan(0)
  })
})
