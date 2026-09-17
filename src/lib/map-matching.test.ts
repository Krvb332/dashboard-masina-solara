import { describe, expect, it } from 'vitest'
import { MATCHING, TrackMatcher, matchRun } from './map-matching'
import { pointAt, trackReference, wrapS } from './track-reference'
import {
  fixAt,
  makeLapRun,
  offsetFromCenterline,
} from '../test/track-fixtures'

/** Proiecția în sine: unde cade fixul și cât de departe de traseu este. */
describe('proiecția pe linia mediană', () => {
  it('lasă pe loc un punct care este deja pe traseu', () => {
    const matcher = new TrackMatcher()

    for (const s of [0, 500, 1234.5, 2600, 3900]) {
      matcher.reset()
      const on = pointAt(trackReference, s)
      const match = matcher.match(on.lat, on.lon)

      expect(match.onTrack).toBe(true)
      expect(Math.abs(match.offsetM)).toBeLessThan(0.1)
      expect(match.s).toBeCloseTo(wrapS(trackReference, s), 1)
    }
  })

  it('măsoară abaterea laterală în metri, cu semnul părții', () => {
    const matcher = new TrackMatcher()

    for (const s of [300, 1500, 2900]) {
      for (const lateral of [-8, -3, 3, 8]) {
        matcher.reset()
        const point = offsetFromCenterline(s, lateral)
        const match = matcher.match(point.lat, point.lon)

        expect(match.offsetM).toBeCloseTo(lateral, 1)
        // Poziția proiectată rămâne cea de pe traseu, nu cea măsurată.
        expect(match.s).toBeCloseTo(s, 0)
      }
    }
  })

  it('aduce poziția înapoi pe asfalt', () => {
    const matcher = new TrackMatcher()
    const off = offsetFromCenterline(1000, 12)
    const match = matcher.match(off.lat, off.lon)
    const on = pointAt(trackReference, 1000)

    // Coordonatele raportate sunt ale traseului, nu ale fixului.
    expect(match.lat).toBeCloseTo(on.lat, 6)
    expect(match.lon).toBeCloseTo(on.lon, 6)
  })

  it('dă altitudinea și panta terenului, nu ale receptorului', () => {
    const matcher = new TrackMatcher()
    const on = pointAt(trackReference, 2000)
    const match = matcher.match(on.lat, on.lon)

    expect(match.elevationM).toBeCloseTo(on.elevationM, 3)
    expect(match.gradeFraction).toBeCloseTo(on.gradeFraction, 6)
    expect(Math.abs(match.gradeFraction)).toBeLessThan(0.15)
  })

  it('spune în ce sector al circuitului se află mașina', () => {
    const matcher = new TrackMatcher()
    const seen = new Set<string>()

    for (let s = 0; s < trackReference.lengthM; s += 20) {
      matcher.reset()
      const on = pointAt(trackReference, s)
      seen.add(matcher.match(on.lat, on.lon).sector.name)
    }

    expect(seen.has('Linia dreaptă principală')).toBe(true)
    expect(seen.has('Eerste linkse')).toBe(true)
    expect(seen.has('Kleine Chicane')).toBe(true)
    expect(seen.has('Jacky Ickx')).toBe(true)
  })

  it('nu se pierde la trecerea peste linia de start', () => {
    const matcher = new TrackMatcher()
    const length = trackReference.lengthM

    // Ultimul metru înainte de linie și primul după ea sunt vecini pe asfalt,
    // deși distanțele lor cumulate sunt la capete opuse ale intervalului.
    const before = pointAt(trackReference, length - 1)
    const after = pointAt(trackReference, 1)

    const matchBefore = matcher.match(before.lat, before.lon)
    const matchAfter = matcher.match(after.lat, after.lon)

    expect(matchBefore.s).toBeGreaterThan(length - 2)
    expect(matchAfter.s).toBeLessThan(2)
    expect(matchAfter.onTrack).toBe(true)
  })
})

/** Coridorul: ce se acceptă ca fiind pe traseu și ce nu. */
describe('coridorul din jurul traseului', () => {
  it('acceptă un fix din interiorul coridorului — controlul pozitiv', () => {
    // Fără acest control, testul de respingere de mai jos ar trece și dacă
    // potrivirea ar refuza *orice* fix, inclusiv unul perfect valid.
    const matcher = new TrackMatcher()
    const inside = offsetFromCenterline(1200, MATCHING.corridorM - 3)
    const match = matcher.match(inside.lat, inside.lon)

    expect(match.onTrack).toBe(true)
    expect(Math.abs(match.offsetM)).toBeLessThan(MATCHING.corridorM)
  })

  it('respinge un fix din afara coridorului, fără să îl lipească pe traseu', () => {
    const matcher = new TrackMatcher()
    const outside = offsetFromCenterline(1200, MATCHING.corridorM + 40)
    const match = matcher.match(outside.lat, outside.lon)

    expect(match.onTrack).toBe(false)
    expect(Math.abs(match.offsetM)).toBeGreaterThan(MATCHING.corridorM)
  })

  it('respinge o poziție complet în altă parte a lumii', () => {
    const matcher = new TrackMatcher()
    // Coordonatele vechiului simulator, lângă Cluj-Napoca: la peste o mie de
    // kilometri de Zolder. Dacă asemenea fixuri ar fi raportate ca fiind „pe
    // traseu", harta ar desena o cursă care nu a avut loc.
    const match = matcher.match(46.7712, 23.6236)

    expect(match.onTrack).toBe(false)
    expect(Math.abs(match.offsetM)).toBeGreaterThan(100_000)
  })

  it('numără fixurile acceptate și respinse dintr-o serie', () => {
    const { fixes } = makeLapRun({ laps: 0.25, noiseM: 2, seed: 4 })
    const away = offsetFromCenterline(600, 200)
    // Trei fixuri în padoc, intercalate în tur.
    const mixed = [
      ...fixes.slice(0, 20),
      fixAt(fixes[20].timeMs, away.lat, away.lon),
      fixAt(fixes[21].timeMs, away.lat, away.lon),
      fixAt(fixes[22].timeMs, away.lat, away.lon),
      ...fixes.slice(23),
    ]

    const run = matchRun(mixed)
    expect(run.offTrack).toBe(3)
    expect(run.onTrack).toBe(mixed.length - 3)
  })

  it('ignoră fixurile pe care receptorul le declară nefolosibile', () => {
    const on = pointAt(trackReference, 800)
    const run = matchRun([
      fixAt(1000, on.lat, on.lon),
      // Fără fix: „Null Island" în golful Guineei.
      fixAt(1100, 0, 0),
      // HDOP peste pragul de utilizabilitate.
      fixAt(1200, on.lat, on.lon, { hdop: 9 }),
      fixAt(1300, on.lat, on.lon),
    ])

    expect(run.fixes).toHaveLength(2)
    expect(run.onTrack).toBe(2)
  })
})

describe('uitarea poziției după ieșirea de pe traseu', () => {
  it('caută din nou pe tot circuitul după destule fixuri în afara lui', () => {
    const matcher = new TrackMatcher({ offTrackBeforeReset: 3 })

    const start = pointAt(trackReference, 100)
    expect(matcher.match(start.lat, start.lon).onTrack).toBe(true)
    expect(matcher.anchor).not.toBeNull()

    for (let index = 0; index < 3; index += 1) {
      matcher.match(46.7712, 23.6236)
    }
    expect(matcher.anchor).toBeNull()

    // Readusă pe circuit în cu totul altă parte, mașina este găsită acolo.
    const elsewhere = pointAt(trackReference, 2500)
    const back = matcher.match(elsewhere.lat, elsewhere.lon)
    expect(back.onTrack).toBe(true)
    expect(back.s).toBeCloseTo(2500, 0)
  })
})
