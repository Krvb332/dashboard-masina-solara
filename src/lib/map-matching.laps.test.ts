import { describe, expect, it } from 'vitest'
import { matchRun } from './map-matching'
import { pointAt, trackReference } from './track-reference'
import { fixAt, makeLapRun, offsetFromCenterline } from '../test/track-fixtures'

/**
 * Turele și distanța, deduse din poziția pe traseu.
 *
 * Numărătoarea nu urmărește „a trecut peste linie", ci avansul net cumulat.
 * Diferența se vede pe o mașină oprită pe linia de start: prima metodă ar
 * număra o trecere la fiecare eșantion care oscilează peste linie — zeci de
 * ture într-un minut de staționare; a doua adună deplasări cu semn, iar
 * oscilația se anulează.
 */

describe('numărătoarea de tururi', () => {
  it('nu numără nimic înainte ca mașina să încheie un tur', () => {
    const { fixes } = makeLapRun({ laps: 0.9, speedMs: 25 })
    const run = matchRun(fixes)

    expect(run.lapCount).toBe(0)
    expect(run.fixes[run.fixes.length - 1].lap).toBe(0)
  })

  it('numără un tur la fiecare trecere completă a circuitului', () => {
    for (const laps of [1, 2, 3]) {
      const { fixes } = makeLapRun({ laps: laps + 0.2, speedMs: 25 })
      const run = matchRun(fixes)
      expect(run.lapCount).toBe(laps)
    }
  })

  it('numără la fel și cu zgomot de receptor', () => {
    const { fixes } = makeLapRun({
      laps: 3.4,
      speedMs: 25,
      noiseM: 5,
      seed: 21,
    })
    expect(matchRun(fixes).lapCount).toBe(3)
  })

  it('nu numără ture pe o mașină oprită pe linia de start', () => {
    // Exact cazul pe care o detecție „a trecut peste linie" îl greșește:
    // zgomotul mută poziția înainte și înapoi peste linie de sute de ori.
    const stationary = Array.from({ length: 600 }, (_, index) => {
      const s = index % 2 === 0 ? 3 : trackReference.lengthM - 3
      const point = pointAt(trackReference, s)
      return fixAt(1_700_000_000_000 + index * 100, point.lat, point.lon)
    })

    const run = matchRun(stationary)
    expect(run.lapCount).toBe(0)
    // Avansul net rămâne aproape de zero, oricât de mult ar oscila.
    expect(Math.abs(run.progressM)).toBeLessThan(20)
  })
})

describe('distanța pe traseu', () => {
  it('crește monoton, oricât de zgomotoase ar fi fixurile', () => {
    const { fixes } = makeLapRun({
      laps: 2,
      speedMs: 25,
      noiseM: 6,
      seed: 9,
    })
    const run = matchRun(fixes)

    for (let index = 1; index < run.fixes.length; index += 1) {
      expect(run.fixes[index].distanceM).toBeGreaterThanOrEqual(
        run.fixes[index - 1].distanceM,
      )
    }
  })

  it('corespunde lungimii circuitului pe un tur curat', () => {
    const { fixes } = makeLapRun({ laps: 1, speedMs: 20, noiseM: 0 })
    const run = matchRun(fixes)

    // Eșantionarea nu cade fix pe linia de start, deci ultimul pas lipsește.
    const expected = trackReference.lengthM
    expect(run.distanceM).toBeGreaterThan(expected - 5)
    expect(run.distanceM).toBeLessThan(expected + 1)
  })

  it('nu acumulează distanță cât mașina nu este pe traseu', () => {
    const on = pointAt(trackReference, 500)
    const away = offsetFromCenterline(500, 300)

    const run = matchRun([
      fixAt(1000, on.lat, on.lon),
      // Cinci fixuri în afara coridorului: poziția lor pe linia mediană este
      // o ficțiune, iar diferența față de ultimul punct real ar intra în
      // odometru ca un salt.
      ...Array.from({ length: 5 }, (_, index) =>
        fixAt(1100 + index * 100, away.lat, away.lon),
      ),
      fixAt(1600, on.lat, on.lon),
    ])

    expect(run.offTrack).toBe(5)
    expect(run.distanceM).toBe(0)
  })

  it('reia acumularea corect după revenirea pe traseu', () => {
    const first = pointAt(trackReference, 500)
    const away = offsetFromCenterline(500, 300)
    const second = pointAt(trackReference, 600)
    const third = pointAt(trackReference, 700)

    const run = matchRun([
      fixAt(1000, first.lat, first.lon),
      fixAt(1100, away.lat, away.lon),
      fixAt(1200, second.lat, second.lon),
      fixAt(1300, third.lat, third.lon),
    ])

    // Doar pasul 600 -> 700 se contorizează: saltul peste pauză nu.
    expect(run.distanceM).toBeCloseTo(100, 0)
  })
})
