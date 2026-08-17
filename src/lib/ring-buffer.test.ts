import { describe, expect, it } from 'vitest'
import { decimate, TelemetryRingBuffer } from './ring-buffer'

describe('TelemetryRingBuffer', () => {
  it('păstrează ultima valoare a fiecărui semnal', () => {
    const buffer = new TelemetryRingBuffer(10)
    buffer.push(1000, { speed: 10, soc: 90 })
    buffer.push(2000, { speed: 20, soc: 89 })

    expect(buffer.size).toBe(2)
    expect(buffer.latest('speed')).toBe(20)
    expect(buffer.latest('soc')).toBe(89)
    expect(buffer.latest('inexistent')).toBeNull()
  })

  it('nu confundă valoarea zero cu lipsa unei valori', () => {
    const buffer = new TelemetryRingBuffer(10)
    buffer.push(1000, { speed: 0 })

    expect(buffer.latest('speed')).toBe(0)
    expect(buffer.toSeries('speed')).toEqual([[1000, 0]])
  })

  it('un semnal absent dintr-un eșantion lasă gol, nu repetă valoarea', () => {
    const buffer = new TelemetryRingBuffer(10)
    buffer.push(1000, { speed: 10 })
    buffer.push(2000, { soc: 88 })
    buffer.push(3000, { speed: 30 })

    // Eșantionul de la 2000 nu conținea `speed`, deci nu apare în serie.
    expect(buffer.toSeries('speed')).toEqual([
      [1000, 10],
      [3000, 30],
    ])
    expect(buffer.latest('speed')).toBe(30)
  })

  it('suprascrie cele mai vechi eșantioane când se umple', () => {
    const buffer = new TelemetryRingBuffer(3)
    for (let index = 1; index <= 5; index += 1) {
      buffer.push(index * 1000, { speed: index })
    }

    expect(buffer.size).toBe(3)
    expect(buffer.toSeries('speed')).toEqual([
      [3000, 3],
      [4000, 4],
      [5000, 5],
    ])
  })

  it('filtrează seria după fereastra de timp', () => {
    const buffer = new TelemetryRingBuffer(10)
    buffer.push(1000, { speed: 1 })
    buffer.push(5000, { speed: 2 })
    buffer.push(9000, { speed: 3 })

    expect(buffer.toSeries('speed', 5000)).toEqual([
      [5000, 2],
      [9000, 3],
    ])
  })

  it('găsește valoarea de acum N milisecunde pentru calculul tendinței', () => {
    const buffer = new TelemetryRingBuffer(100)
    for (let index = 0; index <= 60; index += 1) {
      buffer.push(index * 1000, { speed: index })
    }

    expect(buffer.valueAgo('speed', 60_000)).toBe(0)
    expect(buffer.valueAgo('speed', 10_000)).toBe(50)
    expect(buffer.valueAgo('speed', 999_000)).toBeNull()
  })

  it('golirea șterge și seriile', () => {
    const buffer = new TelemetryRingBuffer(5)
    buffer.push(1000, { speed: 10 })
    buffer.clear()

    expect(buffer.size).toBe(0)
    expect(buffer.latest('speed')).toBeNull()
    expect(buffer.lastTime).toBeNull()
  })

  it('snapshot întoarce eșantioanele în ordine cronologică', () => {
    const buffer = new TelemetryRingBuffer(3)
    buffer.push(1000, { a: 1 })
    buffer.push(2000, { a: 2, b: 5 })

    expect(buffer.snapshot()).toEqual([
      { time: 1000, signals: { a: 1 } },
      { time: 2000, signals: { a: 2, b: 5 } },
    ])
  })
})

describe('decimate', () => {
  it('nu modifică seriile mai scurte decât limita', () => {
    const points: [number, number][] = [
      [1, 1],
      [2, 2],
    ]
    expect(decimate(points, 100)).toBe(points)
  })

  it('reduce numărul de puncte sub limită', () => {
    const points: [number, number][] = Array.from({ length: 1000 }, (_, i) => [
      i,
      Math.sin(i / 10),
    ])

    const reduced = decimate(points, 100)
    expect(reduced.length).toBeLessThanOrEqual(100)
    expect(reduced.length).toBeGreaterThan(0)
  })

  it('păstrează vârfurile scurte', () => {
    const points: [number, number][] = Array.from({ length: 500 }, (_, i) => [
      i,
      i === 250 ? 999 : 1,
    ])

    const reduced = decimate(points, 50)
    expect(reduced.some(([, value]) => value === 999)).toBe(true)
  })

  it('păstrează ordinea cronologică', () => {
    const points: [number, number][] = Array.from({ length: 300 }, (_, i) => [
      i,
      (i * 37) % 11,
    ])

    const reduced = decimate(points, 40)
    for (let index = 1; index < reduced.length; index += 1) {
      expect(reduced[index][0]).toBeGreaterThanOrEqual(reduced[index - 1][0])
    }
  })
})
