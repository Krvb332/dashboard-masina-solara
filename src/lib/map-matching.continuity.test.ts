import { describe, expect, it } from 'vitest'
import { TrackMatcher, matchRun } from './map-matching'
import { deltaS, pointAt, toGeo, toLocal, trackReference } from './track-reference'
import { makeLapRun } from '../test/track-fixtures'

/**
 * Continuitatea: potrivirea pornește din vecinătatea poziției precedente.
 *
 * **Cât de mult contează, pe circuitul acesta.** Prima verificare de mai jos
 * măsoară separarea geometrică a circuitului — cât de aproape trec una de alta
 * două porțiuni depărtate pe traseu. La Zolder minimul este de ~70 m, mult
 * peste coridorul de 25 m, deci la coridorul implicit *nu există* pereche
 * ambiguă: și o căutare fără memorie ar nimeri corect. Continuitatea este aici
 * o marjă și o economie de căutare, nu o corecție.
 *
 * Asta nu o face inutilă și nici netestabilă: cu un receptor prost coridorul
 * trebuie lărgit, iar de la o lățime încolo ambiguitatea apare. Testul care o
 * demonstrează o construiește explicit, la un coridor declarat — nu se preface
 * că este cazul implicit.
 *
 * Restul verificărilor cer lucrul care trebuie să fie adevărat oricum:
 * căutarea îngustă nu are voie să dea alt rezultat decât cea completă acolo
 * unde amândouă sunt corecte.
 */

describe('cât de ambiguu este circuitul', () => {
  it('măsoară separarea minimă dintre porțiuni depărtate pe traseu', () => {
    const reference = trackReference
    const length = reference.lengthM

    const points: { s: number; x: number; y: number }[] = []
    for (let s = 0; s < length; s += 4) {
      const point = pointAt(reference, s)
      const local = toLocal(reference, point.lat, point.lon)
      points.push({ s, x: local.x, y: local.y })
    }

    let closest = Infinity
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        // „Depărtate pe traseu" înseamnă că nu sunt pur și simplu vecine:
        // altfel ar fi comparate puncte de pe același segment.
        const along = Math.abs(deltaS(reference, points[i].s, points[j].s))
        if (along < 200) continue
        closest = Math.min(
          closest,
          Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y),
        )
      }
    }

    // Măsurat, nu presupus: cifra justifică afirmația din comentariul de sus.
    expect(closest).toBeGreaterThan(60)
  })
})

describe('căutarea îngustă față de cea completă', () => {
  it('dă exact același rezultat pe un tur curat', () => {
    const { fixes, truth } = makeLapRun({ laps: 1, speedMs: 25, noiseM: 0 })

    // Cu memorie: fiecare fix căutat lângă cel dinainte.
    const continuous = new TrackMatcher()
    // Fără memorie: fiecare fix căutat pe tot circuitul.
    const memoryless = new TrackMatcher()

    for (let index = 0; index < fixes.length; index += 1) {
      const fix = fixes[index]
      const withMemory = continuous.match(fix.latitude, fix.longitude)
      memoryless.reset()
      const withoutMemory = memoryless.match(fix.latitude, fix.longitude)

      expect(withMemory.s).toBeCloseTo(withoutMemory.s, 6)
      // Și amândouă cad pe poziția adevărată.
      expect(
        Math.abs(deltaS(trackReference, withMemory.s, truth[index].s)),
      ).toBeLessThan(0.5)
    }
  })

  it('rămâne fidelă și cu zgomot realist', () => {
    const { fixes, truth } = makeLapRun({
      laps: 1,
      speedMs: 22,
      noiseM: 4,
      seed: 11,
    })
    const run = matchRun(fixes)

    let worst = 0
    for (let index = 0; index < run.fixes.length; index += 1) {
      worst = Math.max(
        worst,
        Math.abs(deltaS(trackReference, run.fixes[index].match.s, truth[index].s)),
      )
    }

    // Zgomotul de-a lungul traseului rămâne; ce nu are voie să apară este un
    // salt — o poziție ajunsă în cu totul altă parte a circuitului.
    expect(worst).toBeLessThan(20)
  })

  it('avansează fără salturi de-a lungul unei ture zgomotoase', () => {
    const { fixes } = makeLapRun({
      laps: 2,
      speedMs: 25,
      noiseM: 5,
      seed: 3,
    })
    const run = matchRun(fixes)

    // La 25 m/s și 10 Hz, între două eșantioane sunt 2,5 m. Cu zgomot de 5 m
    // pe ambele capete, pasul proiectat poate ajunge la câțiva metri — dar nu
    // la zeci, și cu atât mai puțin la sute.
    let biggestStep = 0
    for (let index = 1; index < run.fixes.length; index += 1) {
      biggestStep = Math.max(
        biggestStep,
        Math.abs(
          deltaS(
            trackReference,
            run.fixes[index - 1].match.s,
            run.fixes[index].match.s,
          ),
        ),
      )
    }

    expect(biggestStep).toBeLessThan(30)
  })
})

describe('ambiguitatea construită, la coridor lărgit', () => {
  /**
   * Cele două porțiuni care trec cel mai aproape una de alta pe acest circuit,
   * găsite de măsurătoarea de mai sus: ~70 m între ele.
   */
  const NEAR_A = 305
  const NEAR_B = 1470

  /** Un punct pe segmentul dintre cele două porțiuni, la `metersFromA` de A. */
  function between(metersFromA: number): { lat: number; lon: number } {
    const a = pointAt(trackReference, NEAR_A)
    const b = pointAt(trackReference, NEAR_B)
    const localA = toLocal(trackReference, a.lat, a.lon)
    const localB = toLocal(trackReference, b.lat, b.lon)

    const dx = localB.x - localA.x
    const dy = localB.y - localA.y
    const span = Math.hypot(dx, dy)
    const ratio = metersFromA / span

    return toGeo(
      trackReference,
      localA.x + dx * ratio,
      localA.y + dy * ratio,
    )
  }

  it('fără memorie, un fix aruncat departe se lipește de porțiunea greșită', () => {
    // Controlul care dă sens testului următor: dacă și căutarea completă ar
    // nimeri corect, continuitatea n-ar corecta nimic aici.
    const memoryless = new TrackMatcher({ corridorM: 60 })
    const thrown = between(45)
    const match = memoryless.match(thrown.lat, thrown.lon)

    expect(match.onTrack).toBe(true)
    expect(Math.abs(deltaS(trackReference, match.s, NEAR_B))).toBeLessThan(60)
  })

  it('cu memorie, același fix rămâne pe porțiunea pe care mergea mașina', () => {
    const matcher = new TrackMatcher({ corridorM: 60 })

    // Mașina vine pe porțiunea A și ajunge lângă ea.
    for (let s = NEAR_A - 60; s <= NEAR_A; s += 5) {
      const point = pointAt(trackReference, s)
      matcher.match(point.lat, point.lon)
    }

    const thrown = between(45)
    const match = matcher.match(thrown.lat, thrown.lon)

    expect(match.onTrack).toBe(true)
    expect(Math.abs(deltaS(trackReference, match.s, NEAR_A))).toBeLessThan(60)
  })
})
