import type { NormalizedSignals } from '../schemas/telemetry'

/**
 * Buffer de istoric orientat pe coloane.
 *
 * Este ținut în afara store-ului React în mod deliberat: la 10 Hz și câteva mii
 * de eșantioane, copierea unor tablouri noi la fiecare cadru doar ca să
 * satisfacem egalitatea referențială ar domina timpul de execuție. În schimb,
 * bufferul este mutabil și expune un `version` care crește la fiecare inserare;
 * componentele se abonează la versiune și citesc datele direct.
 */

export type HistoryWindow = {
  timestamps: number[]
  series: Record<string, (number | null)[]>
}

export class HistoryBuffer {
  private timestamps: number[] = []
  private columns = new Map<string, (number | null)[]>()
  private readonly capacity: number
  private readonly trimThreshold: number

  /** Crește la fiecare inserare; folosit ca semnal de reîmprospătare în UI. */
  version = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.trimThreshold = Math.ceil(capacity * 1.1)
  }

  push(timestamp: number, signals: NormalizedSignals): void {
    this.timestamps.push(timestamp)

    for (const [key, signal] of Object.entries(signals)) {
      let column = this.columns.get(key)
      if (!column) {
        // Semnal apărut mai târziu: îl aliniem cu istoricul existent.
        column = new Array<number | null>(this.timestamps.length - 1).fill(null)
        this.columns.set(key, column)
      }
      column.push(signal.quality === 'valid' ? signal.value : null)
    }

    // Semnalele absente din acest cadru primesc `null`, ca toate coloanele să
    // rămână aliniate cu `timestamps`.
    for (const [key, column] of this.columns) {
      if (column.length < this.timestamps.length) {
        column.push(signals[key]?.value ?? null)
      }
    }

    // Tăiem în loturi, nu la fiecare inserare, ca să evităm un `splice` per cadru.
    if (this.timestamps.length > this.trimThreshold) {
      const excess = this.timestamps.length - this.capacity
      this.timestamps.splice(0, excess)
      for (const column of this.columns.values()) column.splice(0, excess)
    }

    this.version += 1
  }

  get length(): number {
    return this.timestamps.length
  }

  /** Ultimele `seconds` secunde pentru semnalele cerute. */
  window(keys: string[], seconds: number, now = Date.now()): HistoryWindow {
    const cutoff = now - seconds * 1_000
    let start = 0
    while (start < this.timestamps.length && this.timestamps[start]! < cutoff) {
      start += 1
    }

    const series: Record<string, (number | null)[]> = {}
    for (const key of keys) {
      series[key] = this.columns.get(key)?.slice(start) ?? []
    }

    return { timestamps: this.timestamps.slice(start), series }
  }

  /** Ultima valoare cunoscută a unui semnal, ignorând golurile. */
  lastValue(key: string): number | null {
    const column = this.columns.get(key)
    if (!column) return null
    for (let index = column.length - 1; index >= 0; index -= 1) {
      const value = column[index]
      if (value !== null && value !== undefined) return value
    }
    return null
  }

  /**
   * Variația unui semnal față de acum `seconds` secunde. Returnează `null` când
   * nu avem suficient istoric pentru o comparație onestă.
   */
  delta(key: string, seconds: number, now = Date.now()): number | null {
    const column = this.columns.get(key)
    if (!column || column.length < 2) return null

    const current = this.lastValue(key)
    if (current === null) return null

    const cutoff = now - seconds * 1_000
    for (let index = this.timestamps.length - 1; index >= 0; index -= 1) {
      if (this.timestamps[index]! <= cutoff) {
        const past = column[index]
        return past === null || past === undefined ? null : current - past
      }
    }
    return null
  }

  /** Integrează un semnal de putere (W) pe tot istoricul și dă energia în Wh. */
  integrate(key: string): number | null {
    const column = this.columns.get(key)
    if (!column || column.length < 2) return null

    let wattSeconds = 0
    for (let index = 1; index < column.length; index += 1) {
      const previous = column[index - 1]
      const current = column[index]
      if (previous === null || current === null) continue
      if (previous === undefined || current === undefined) continue

      const dtS = (this.timestamps[index]! - this.timestamps[index - 1]!) / 1_000
      if (dtS <= 0 || dtS > 5) continue // sărim peste golurile de comunicație
      wattSeconds += ((previous + current) / 2) * dtS
    }

    return wattSeconds / 3_600
  }

  clear(): void {
    this.timestamps = []
    this.columns.clear()
    this.version += 1
  }
}
