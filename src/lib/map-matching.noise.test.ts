import { describe, expect, it } from 'vitest'
import { haversineMeters } from './gps'
import { matchRun } from './map-matching'
import { deltaS, toLocal, trackReference } from './track-reference'
import { makeLapRun } from '../test/track-fixtures'

/**
 * Cât zgomot scoate proiecția — măsurat, cu așteptările puse de matematică.
 *
 * Testele de aici sunt singurele care justifică toată construcția. Restul
 * verifică *funcționarea*: că proiecția cade unde trebuie, că turele se
 * numără, că un fix din padoc este respins. Acestea verifică *rostul*.
 *
 * **Ce se poate aștepta, înainte de a măsura.** Zgomotul unui receptor este
 * aproximativ gaussian și izotrop, cu abaterea standard σ pe fiecare axă.
 * Modulul erorii în plan urmează atunci o distribuție Rayleigh, cu mediana
 * 1,177 σ. Proiecția desface eroarea în două componente: perpendiculară pe
 * traseu, care dispare complet, și de-a lungul traseului, care rămâne — o
 * seminormală, cu mediana 0,674 σ.
 *
 * Deci raportul de îmbunătățire a poziției în plan este 1,177 / 0,674 ≈ 1,75,
 * și — important — **nu depinde de σ**. Nu este un număr care se poate regla
 * mai bine cu parametri mai buni: este proprietatea metodei. O implementare
 * care ar raporta mult mai mult ar fi suspectă, nu mai bună.
 *
 * Câștigul adevărat nu este însă factorul acela. Sunt celelalte două lucruri,
 * măsurate mai jos: abaterea perpendiculară dispare *de tot* — adică urma nu
 * mai iese de pe asfalt — iar distanța parcursă încetează să fie umflată de
 * zgomot, ceea ce contează direct în consumul pe kilometru.
 */

/** Distanța în metri între două coordonate, în cadrul local al circuitului. */
function metersBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const localA = toLocal(trackReference, a.lat, a.lon)
  const localB = toLocal(trackReference, b.lat, b.lon)
  return Math.hypot(localA.x - localB.x, localA.y - localB.y)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length / 2
  return sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

type Errors = {
  /** Eroarea de poziție în plan, brută și după proiecție. */
  rawPlanar: number[]
  matchedPlanar: number[]
  /** Componenta perpendiculară pe traseu, brută și după proiecție. */
  rawLateral: number[]
  matchedLateral: number[]
}

function measure(options: Parameters<typeof makeLapRun>[0]): Errors {
  const { fixes, truth } = makeLapRun(options)
  const run = matchRun(fixes)
  const byTime = new Map(truth.map((point) => [point.timeMs, point]))

  const errors: Errors = {
    rawPlanar: [],
    matchedPlanar: [],
    rawLateral: [],
    matchedLateral: [],
  }

  for (const matched of run.fixes) {
    const actual = byTime.get(matched.timeMs)
    if (actual === undefined) continue

    errors.rawPlanar.push(metersBetween(actual, matched.raw))
    errors.matchedPlanar.push(metersBetween(actual, matched.match))

    // Componenta perpendiculară a fixului brut este chiar abaterea lui
    // laterală față de traseu; pentru poziția proiectată este zero prin
    // construcție, dar se măsoară, nu se presupune.
    errors.rawLateral.push(Math.abs(matched.match.offsetM))
    errors.matchedLateral.push(
      Math.abs(
        metersBetween(matched.match, {
          lat: matched.match.lat,
          lon: matched.match.lon,
        }),
      ),
    )
  }

  return errors
}

describe('reducerea zgomotului prin proiecție', () => {
  it('îmbunătățește poziția în plan cu factorul pe care îl prezice teoria', () => {
    const results: { sigma: number; ratio: number }[] = []

    for (const sigma of [2, 3, 5, 8]) {
      const errors = measure({
        laps: 1,
        speedMs: 22,
        noiseM: sigma,
        seed: 17,
      })
      const raw = median(errors.rawPlanar)
      const matched = median(errors.matchedPlanar)
      results.push({ sigma, ratio: raw / matched })

      console.log(
        `σ = ${sigma} m: eroare mediană ${raw.toFixed(2)} m → ` +
          `${matched.toFixed(2)} m (×${(raw / matched).toFixed(2)})`,
      )

      // Mediana brută trebuie să fie Rayleigh: 1,177 σ.
      expect(raw / sigma).toBeGreaterThan(1.05)
      expect(raw / sigma).toBeLessThan(1.3)
      // Cea proiectată, seminormală: 0,674 σ.
      expect(matched / sigma).toBeGreaterThan(0.55)
      expect(matched / sigma).toBeLessThan(0.8)
    }

    for (const result of results) {
      expect(result.ratio).toBeGreaterThan(1.5)
      expect(result.ratio).toBeLessThan(2.1)
    }

    // Și raportul nu depinde de cât de prost este receptorul: dacă ar depinde,
    // una dintre cele două distribuții nu ar fi cea presupusă, iar modelul din
    // antet ar fi greșit.
    const ratios = results.map((result) => result.ratio)
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.25)
  })

  it('elimină complet abaterea perpendiculară pe traseu', () => {
    // Aceasta este componenta care se vede: ea scoate urma în iarbă și ea taie
    // interiorul virajelor. Pe poziția proiectată nu mai poate exista deloc,
    // fiindcă poziția *este* un punct de pe traseu.
    const errors = measure({ laps: 1, speedMs: 22, noiseM: 5, seed: 29 })

    const rawLateral = median(errors.rawLateral)
    const worstRawLateral = Math.max(...errors.rawLateral)

    console.log(
      `σ = 5 m: abatere laterală mediană ${rawLateral.toFixed(2)} m ` +
        `(cea mai mare ${worstRawLateral.toFixed(1)} m) → 0 m după proiecție`,
    )

    expect(rawLateral).toBeGreaterThan(2)
    expect(worstRawLateral).toBeGreaterThan(10)
    // Nu „mică": zero. Marginea acoperă doar aritmetica în virgulă mobilă.
    expect(Math.max(...errors.matchedLateral)).toBeLessThan(1e-6)
  })

  it('oprește umflarea distanței parcurse', () => {
    // Fără referință, distanța se obține însumând pașii dintre fixuri. Fiecare
    // pas moștenește zgomotul ambelor capete, iar zgomotul se adună mereu în
    // plus — un modul, niciodată o scădere. Pe un tur întreg asta nu este o
    // imprecizie, este o supraevaluare sistematică, iar consumul pe kilometru
    // o moștenește direct.
    const laps = 2
    const { fixes } = makeLapRun({
      laps,
      speedMs: 22,
      noiseM: 4,
      seed: 37,
    })

    let rawDistance = 0
    for (let index = 1; index < fixes.length; index += 1) {
      rawDistance += haversineMeters(fixes[index - 1], fixes[index]) ?? 0
    }

    const run = matchRun(fixes)
    const truth = laps * trackReference.lengthM

    const rawError = Math.abs(rawDistance - truth) / truth
    const matchedError = Math.abs(run.distanceM - truth) / truth

    console.log(
      `${laps} ture, σ = 4 m: adevăr ${truth.toFixed(0)} m; ` +
        `însumat din fixuri ${rawDistance.toFixed(0)} m (+${(rawError * 100).toFixed(1)} %); ` +
        `pe traseu ${run.distanceM.toFixed(0)} m (${(matchedError * 100).toFixed(2)} %)`,
    )

    // Supraevaluarea brută este mare și într-o singură direcție.
    expect(rawDistance).toBeGreaterThan(truth * 1.2)
    // Distanța pe traseu rămâne în procent de adevăr.
    expect(matchedError).toBeLessThan(0.01)
  })

  it('păstrează traiectoria de curse ca informație, nu o șterge', () => {
    // Un pilot taie virajele, deci merge constant la câțiva metri lateral.
    // Proiecția îl desenează pe mijloc — deci eroarea *de poziție în plan* nu
    // se mai îmbunătățește, fiindcă abaterea lui este reală, nu zgomot.
    //
    // Ce nu are voie să se piardă este informația: cât de departe de mijloc
    // era. Raportată separat, ea rămâne disponibilă, iar poziția de-a lungul
    // traseului — cea care decide turul, sectorul și distanța — este în
    // continuare mai bună decât cea brută.
    const lateral = 5
    const { fixes, truth } = makeLapRun({
      laps: 1,
      speedMs: 22,
      noiseM: 3,
      lateralM: lateral,
      seed: 43,
    })
    const run = matchRun(fixes)
    const byTime = new Map(truth.map((point) => [point.timeMs, point]))

    // Abaterea laterală raportată recuperează traiectoria reală.
    expect(run.medianOffsetM).not.toBeNull()
    expect(run.medianOffsetM as number).toBeGreaterThan(lateral - 1)
    expect(run.medianOffsetM as number).toBeLessThan(lateral + 1)

    // Iar poziția de-a lungul traseului rămâne exactă.
    const alongErrors: number[] = []
    for (const matched of run.fixes) {
      const actual = byTime.get(matched.timeMs)
      if (actual === undefined) continue
      alongErrors.push(
        Math.abs(deltaS(trackReference, matched.match.s, actual.s)),
      )
    }

    const alongMedian = median(alongErrors)
    console.log(
      `traiectorie la ${lateral} m lateral, σ = 3 m: abatere raportată ` +
        `${(run.medianOffsetM as number).toFixed(2)} m; eroare mediană ` +
        `de-a lungul traseului ${alongMedian.toFixed(2)} m`,
    )
    expect(alongMedian).toBeLessThan(3)
  })
})
