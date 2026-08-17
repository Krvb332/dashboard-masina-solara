/**
 * Buffer circular pentru seriile temporale.
 *
 * Trăiește în afara React: la 10 Hz și ~30 de semnale, trecerea fiecărui
 * eșantion prin state React ar re-randa tot arborele de 10 ori pe secundă.
 * Componentele care au nevoie de text citesc din store la un ritm redus, iar
 * graficele citesc direct de aici.
 *
 * Datele sunt ținute în `Float64Array`-uri paralele - una pentru timp și una
 * pentru fiecare semnal - ca extragerea unei serii să nu aloce obiecte.
 * Un semnal absent dintr-un eșantion primește `NaN`, ceea ce înseamnă „nicio
 * valoare" și este diferit de `0`.
 */

export type SeriesPoint = [number, number]

export class TelemetryRingBuffer {
  private readonly times: Float64Array
  private readonly series = new Map<string, Float64Array>()
  private head = 0
  private length = 0

  readonly capacity: number

  constructor(capacity = 6000) {
    this.capacity = capacity
    this.times = new Float64Array(capacity)
  }

  get size(): number {
    return this.length
  }

  get lastTime(): number | null {
    if (this.length === 0) return null
    return this.times[this.indexAt(this.length - 1)]
  }

  clear(): void {
    this.head = 0
    this.length = 0
    this.series.clear()
  }

  /** Adaugă un eșantion. `timeMs` este timpul epocii în milisecunde. */
  push(timeMs: number, signals: Record<string, number>): void {
    const slot = this.head
    this.times[slot] = timeMs

    // Semnalele deja cunoscute primesc NaN implicit, ca lipsa unei valori într-un
    // eșantion să nu fie interpretată drept continuarea celei anterioare.
    for (const values of this.series.values()) {
      values[slot] = Number.NaN
    }

    for (const [key, value] of Object.entries(signals)) {
      let values = this.series.get(key)
      if (values === undefined) {
        values = new Float64Array(this.capacity).fill(Number.NaN)
        this.series.set(key, values)
      }
      values[slot] = value
    }

    this.head = (this.head + 1) % this.capacity
    if (this.length < this.capacity) {
      this.length += 1
    }
  }

  /** Ultima valoare cunoscută a unui semnal, sau `null` dacă nu există. */
  latest(key: string): number | null {
    const values = this.series.get(key)
    if (values === undefined) return null

    for (let offset = this.length - 1; offset >= 0; offset -= 1) {
      const value = values[this.indexAt(offset)]
      if (!Number.isNaN(value)) return value
    }
    return null
  }

  /** Valoarea de acum `ms` milisecunde, folosită pentru calculul tendinței. */
  valueAgo(key: string, ms: number): number | null {
    const values = this.series.get(key)
    const last = this.lastTime
    if (values === undefined || last === null) return null

    const target = last - ms
    for (let offset = this.length - 1; offset >= 0; offset -= 1) {
      const index = this.indexAt(offset)
      if (this.times[index] <= target && !Number.isNaN(values[index])) {
        return values[index]
      }
    }
    return null
  }

  keys(): string[] {
    return [...this.series.keys()]
  }

  /**
   * Extrage o serie pentru grafic.
   *
   * `windowMs` limitează fereastra la ultimele N milisecunde, iar `maxPoints`
   * reduce numărul de puncte: nu are sens să desenăm 6000 de puncte pe 800 de
   * pixeli. Reducerea păstrează minimul și maximul din fiecare interval, ca
   * vârfurile scurte să nu dispară.
   */
  toSeries(key: string, windowMs?: number, maxPoints = 900): SeriesPoint[] {
    const values = this.series.get(key)
    if (values === undefined || this.length === 0) return []

    const cutoff =
      windowMs === undefined ? -Infinity : (this.lastTime ?? 0) - windowMs

    const raw: SeriesPoint[] = []
    for (let offset = 0; offset < this.length; offset += 1) {
      const index = this.indexAt(offset)
      const time = this.times[index]
      if (time < cutoff) continue

      const value = values[index]
      if (Number.isNaN(value)) continue
      raw.push([time, value])
    }

    return raw.length > maxPoints ? decimate(raw, maxPoints) : raw
  }

  /** Toate eșantioanele, în ordine cronologică. Folosit la export sau depanare. */
  snapshot(): { time: number; signals: Record<string, number> }[] {
    const result: { time: number; signals: Record<string, number> }[] = []

    for (let offset = 0; offset < this.length; offset += 1) {
      const index = this.indexAt(offset)
      const signals: Record<string, number> = {}
      for (const [key, values] of this.series) {
        const value = values[index]
        if (!Number.isNaN(value)) signals[key] = value
      }
      result.push({ time: this.times[index], signals })
    }

    return result
  }

  private indexAt(offset: number): number {
    const start = (this.head - this.length + this.capacity) % this.capacity
    return (start + offset) % this.capacity
  }
}

/** Reducere care păstrează minimul și maximul fiecărui interval. */
export function decimate(
  points: SeriesPoint[],
  maxPoints: number,
): SeriesPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) return points

  const buckets = Math.max(1, Math.floor(maxPoints / 2))
  const size = points.length / buckets
  const result: SeriesPoint[] = []

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor(bucket * size)
    const to = Math.min(points.length, Math.floor((bucket + 1) * size))
    if (from >= to) continue

    let min = points[from]
    let max = points[from]
    for (let index = from + 1; index < to; index += 1) {
      if (points[index][1] < min[1]) min = points[index]
      if (points[index][1] > max[1]) max = points[index]
    }

    if (min[0] <= max[0]) {
      result.push(min)
      if (max !== min) result.push(max)
    } else {
      result.push(max)
      result.push(min)
    }
  }

  return result
}
