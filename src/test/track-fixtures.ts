/**
 * Ture sintetice pe circuitul real, pentru testele de proiecție.
 *
 * Testele de potrivire au nevoie de ceva ce datele adevărate nu oferă
 * niciodată: adevărul. Pe o înregistrare reală nu se știe unde *era* mașina, ci
 * doar ce a raportat receptorul — deci nu se poate măsura cât din eroare a fost
 * înlăturată. Aici poziția adevărată este aleasă prima, zgomotul este adăugat
 * peste ea, iar diferența dintre ce a ieșit și ce fusese ales este eroarea,
 * cunoscută exact.
 *
 * Zgomotul este gaussian, nu uniform: dispersia unui receptor GNSS are cozi.
 * Un zgomot uniform ar tăia exact cazurile care contează — fixul izolat aruncat
 * la douăzeci de metri, pe care coridorul trebuie să îl decidă.
 */

import type { GpsFix } from '../lib/gps'
import { pointAt, toGeo, toLocal, trackReference } from '../lib/track-reference'

/** Generator determinist (mulberry32), ca cifrele să fie reproductibile. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Două eșantioane normale standard, prin transformarea Box-Muller. */
function gaussianPair(random: () => number): [number, number] {
  // `random()` poate întoarce exact 0, iar logaritmul din zero este infinit;
  // deplasarea îl ține în interval fără să schimbe distribuția perceptibil.
  const u1 = Math.max(random(), Number.EPSILON)
  const u2 = random()
  const radius = Math.sqrt(-2 * Math.log(u1))
  const angle = 2 * Math.PI * u2
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
}

export type LapOptions = {
  /** Câte ture se parcurg. Fracționar este permis. */
  laps?: number
  /** De unde pornește, în metri de la linia de start. */
  startS?: number
  /** Viteza constantă, în m/s. */
  speedMs?: number
  /** Rata de eșantionare. */
  hz?: number
  /** Abaterea standard a zgomotului orizontal, în metri. */
  noiseM?: number
  /**
   * Abaterea laterală constantă față de linia mediană, în metri — traiectoria
   * pe care chiar merge mașina. Pozitiv la stânga sensului de mers.
   */
  lateralM?: number
  seed?: number
  startTimeMs?: number
  /** Ce se raportează ca HDOP pe fiecare fix. */
  hdop?: number
}

export type TruthPoint = {
  timeMs: number
  /** Poziția adevărată pe traseu, în metri de la linia de start. */
  s: number
  /** Coordonatele adevărate, înainte de zgomot. */
  lat: number
  lon: number
}

/**
 * O tură sintetică: fixurile zgomotoase și poziția adevărată din spatele lor.
 *
 * Mașina merge cu viteză constantă la o abatere laterală constantă față de
 * linia mediană — o traiectorie simplă, dar suficientă: ce se măsoară este
 * proiecția, nu realismul pilotajului.
 */
export function makeLapRun(options: LapOptions = {}): {
  fixes: GpsFix[]
  truth: TruthPoint[]
} {
  const laps = options.laps ?? 1
  const speedMs = options.speedMs ?? 20
  const hz = options.hz ?? 10
  const noiseM = options.noiseM ?? 0
  const lateralM = options.lateralM ?? 0
  const startS = options.startS ?? 0
  const startTimeMs = options.startTimeMs ?? 1_700_000_000_000
  const hdop = options.hdop ?? 0.9
  const random = makeRandom(options.seed ?? 1)

  const reference = trackReference
  const totalM = laps * reference.lengthM
  const stepM = speedMs / hz
  const count = Math.max(2, Math.round(totalM / stepM))

  const fixes: GpsFix[] = []
  const truth: TruthPoint[] = []

  for (let index = 0; index < count; index += 1) {
    const s = startS + index * stepM
    const on = pointAt(reference, s)

    // Traiectoria reală: linia mediană deplasată lateral cu `lateralM`.
    // Normala la stânga direcției de mers, în cadrul local.
    const heading = (on.headingDeg * Math.PI) / 180
    const center = toLocal(reference, on.lat, on.lon)
    const trueX = center.x - lateralM * Math.cos(heading)
    const trueY = center.y + lateralM * Math.sin(heading)
    const truePoint = toGeo(reference, trueX, trueY)

    const [noiseX, noiseY] = gaussianPair(random)
    const measured = toGeo(
      reference,
      trueX + noiseX * noiseM,
      trueY + noiseY * noiseM,
    )

    const timeMs = startTimeMs + Math.round((index / hz) * 1000)

    truth.push({ timeMs, s, lat: truePoint.lat, lon: truePoint.lon })
    fixes.push({
      timeMs,
      latitude: measured.lat,
      longitude: measured.lon,
      altitude: on.elevationM,
      hdop,
      satellites: 11,
      fixQuality: 1,
    })
  }

  return { fixes, truth }
}

/** Un punct deplasat lateral față de linia mediană, la distanța dată. */
export function offsetFromCenterline(
  s: number,
  lateralM: number,
): { lat: number; lon: number } {
  const reference = trackReference
  const on = pointAt(reference, s)
  const heading = (on.headingDeg * Math.PI) / 180
  const center = toLocal(reference, on.lat, on.lon)
  return toGeo(
    reference,
    center.x - lateralM * Math.cos(heading),
    center.y + lateralM * Math.sin(heading),
  )
}

/** Un fix gata de dat potrivirii, la coordonatele date. */
export function fixAt(
  timeMs: number,
  lat: number,
  lon: number,
  overrides: Partial<GpsFix> = {},
): GpsFix {
  return {
    timeMs,
    latitude: lat,
    longitude: lon,
    altitude: 40,
    hdop: 0.9,
    satellites: 11,
    fixQuality: 1,
    ...overrides,
  }
}
