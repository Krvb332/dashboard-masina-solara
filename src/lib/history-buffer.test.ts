import { describe, expect, it } from 'vitest'
import { HistoryBuffer } from './history-buffer'
import type { NormalizedSignals } from '../schemas/telemetry'

function signals(values: Record<string, number | null>): NormalizedSignals {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { value, quality: value === null ? 'unavailable' : 'valid' },
    ]),
  ) as NormalizedSignals
}

describe('HistoryBuffer', () => {
  it('păstrează coloanele aliniate când un semnal apare mai târziu', () => {
    const buffer = new HistoryBuffer(100)
    buffer.push(1_000, signals({ a: 1 }))
    buffer.push(2_000, signals({ a: 2, b: 20 }))

    const window = buffer.window(['a', 'b'], 60, 2_000)

    expect(window.timestamps).toEqual([1_000, 2_000])
    expect(window.series.a).toEqual([1, 2])
    // `b` nu exista la primul eșantion, deci are un gol acolo.
    expect(window.series.b).toEqual([null, 20])
  })

  it('taie istoricul la capacitate', () => {
    const buffer = new HistoryBuffer(10)
    for (let index = 0; index < 60; index += 1) {
      buffer.push(index * 100, signals({ a: index }))
    }

    expect(buffer.length).toBeLessThanOrEqual(11)
    expect(buffer.lastValue('a')).toBe(59)
  })

  it('ignoră golurile când caută ultima valoare', () => {
    const buffer = new HistoryBuffer(100)
    buffer.push(1_000, signals({ a: 5 }))
    buffer.push(2_000, signals({ a: null }))

    expect(buffer.lastValue('a')).toBe(5)
  })

  it('calculează variația față de un moment anterior', () => {
    const buffer = new HistoryBuffer(100)
    buffer.push(0, signals({ a: 10 }))
    buffer.push(60_000, signals({ a: 25 }))

    expect(buffer.delta('a', 60, 60_000)).toBe(15)
  })

  it('nu raportează variație fără istoric suficient', () => {
    const buffer = new HistoryBuffer(100)
    buffer.push(60_000, signals({ a: 10 }))

    expect(buffer.delta('a', 60, 60_000)).toBeNull()
  })

  it('integrează puterea în energie', () => {
    const buffer = new HistoryBuffer(100)
    // 3600 W constant timp de 10 s = 36000 Ws = 10 Wh.
    for (let second = 0; second <= 10; second += 1) {
      buffer.push(second * 1_000, signals({ p: 3_600 }))
    }

    expect(buffer.integrate('p')).toBeCloseTo(10, 6)
  })

  it('sare peste golurile de comunicație la integrare', () => {
    const buffer = new HistoryBuffer(100)
    buffer.push(0, signals({ p: 3_600 }))
    // Pauză de 10 s: intervalul este ignorat, nu extrapolat.
    buffer.push(10_000, signals({ p: 3_600 }))

    expect(buffer.integrate('p')).toBe(0)
  })
})
