import { beforeEach, describe, expect, it } from 'vitest'
import { historyBuffer, useTelemetryStore } from './telemetry-store'
import type { TelemetryFrame } from '../schemas/telemetry'

function frame(overrides: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    schema_version: 1,
    vehicle_id: 'tucn-solar-01',
    session_id: 'test',
    timestamp: '2026-07-27T10:00:00.000Z',
    sequence: 1,
    signals: { battery_soc_pct: 76.2 },
    ...overrides,
  }
}

describe('telemetry store', () => {
  beforeEach(() => {
    useTelemetryStore.getState().reset()
  })

  it('nu publică în React înainte de commit', () => {
    useTelemetryStore.getState().ingestFrame(frame())

    expect(useTelemetryStore.getState().signals).toBeNull()

    useTelemetryStore.getState().commit()

    expect(useTelemetryStore.getState().signals).toEqual({
      battery_soc_pct: { value: 76.2, quality: 'valid' },
    })
  })

  it('înregistrează istoricul la rata plină, nu la rata de afișare', () => {
    const store = useTelemetryStore.getState()
    for (let index = 1; index <= 5; index += 1) {
      store.ingestFrame(frame({ sequence: index }))
    }
    store.commit()

    // Cinci cadre înregistrate, o singură publicare către React.
    expect(historyBuffer.length).toBe(5)
    expect(useTelemetryStore.getState().stats.received).toBe(5)
  })

  it('numără mesajele lipsă din discontinuitățile de secvență', () => {
    const store = useTelemetryStore.getState()
    store.ingestFrame(frame({ sequence: 1 }))
    store.ingestFrame(frame({ sequence: 5 }))
    store.commit()

    expect(useTelemetryStore.getState().stats.gaps).toBe(3)
  })

  it('numără mesajele sosite în ordine greșită', () => {
    const store = useTelemetryStore.getState()
    store.ingestFrame(frame({ sequence: 10 }))
    store.ingestFrame(frame({ sequence: 9 }))
    store.commit()

    expect(useTelemetryStore.getState().stats.outOfOrder).toBe(1)
    expect(useTelemetryStore.getState().stats.gaps).toBe(0)
  })

  it('păstrează zero ca valoare reală, distinctă de lipsa datelor', () => {
    const store = useTelemetryStore.getState()
    store.ingestFrame(
      frame({ signals: { battery_current_a: 0, motor_power_w: null } }),
    )
    store.commit()

    const signals = useTelemetryStore.getState().signals
    expect(signals?.battery_current_a).toEqual({ value: 0, quality: 'valid' })
    expect(signals?.motor_power_w).toEqual({
      value: null,
      quality: 'unavailable',
    })
  })

  it('calculează decalajul dintre ceasul mașinii și cel al browserului', () => {
    const receivedAt = Date.parse('2026-07-27T10:00:01.500Z')
    const store = useTelemetryStore.getState()
    store.ingestFrame(frame(), receivedAt)
    store.commit()

    expect(useTelemetryStore.getState().stats.clockSkewMs).toBe(1_500)
  })

  it('golește istoricul și statisticile la reset', () => {
    const store = useTelemetryStore.getState()
    store.ingestFrame(frame())
    store.commit()
    store.reset()

    expect(historyBuffer.length).toBe(0)
    expect(useTelemetryStore.getState().stats.received).toBe(0)
    expect(useTelemetryStore.getState().signals).toBeNull()
  })

  it('contorizează mesajele respinse de validare', () => {
    const store = useTelemetryStore.getState()
    store.reportInvalid('JSON invalid.')
    store.commit()

    const stats = useTelemetryStore.getState().stats
    expect(stats.invalid).toBe(1)
    expect(stats.lastInvalidReason).toBe('JSON invalid.')
  })
})
