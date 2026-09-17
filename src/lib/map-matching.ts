/**
 * Proiecția fixurilor GPS pe linia mediană a circuitului.
 *
 * Un receptor GNSS bun raportează poziția cu câțiva metri de dispersie. Pe un
 * grafic de viteză, câțiva metri nu se văd. Pe o hartă de circuit se văd foarte
 * bine: urma iese în iarbă, taie interiorul virajelor, iar mașina oprită în box
 * desenează un ghem. Iar mărimile deduse din poziție moștenesc zgomotul —
 * distanța pe tur iese mai mare decât circuitul, panta sare între ±10 %.
 *
 * Informația care lipsește nu este în date: este pe hartă. Mașina nu poate fi
 * oriunde, ci pe asfalt. Modulul de față adaugă exact această constrângere —
 * fiecare fix este proiectat pe punctul cel mai apropiat de pe linia mediană,
 * iar mai departe se lucrează cu *poziția pe traseu*, nu cu perechea de
 * coordonate. Zgomotul perpendicular pe traseu dispare complet, fiindcă nu mai
 * are unde să existe; rămâne doar componenta de-a lungul traseului, care este
 * și mult mai mică, și inofensivă.
 *
 * **Continuitatea este partea grea.** Un circuit trece de mai multe ori pe
 * lângă el însuși — la Zolder, linia dreaptă principală și ieșirea din
 * Sterrenwacht sunt la câteva zeci de metri una de alta. Un fix zgomotos de pe
 * una dintre ele este uneori mai aproape de cealaltă, iar o potrivire care
 * caută doar „punctul cel mai apropiat de pe tot circuitul" teleportează mașina
 * dintr-o parte în alta a hărții. De aceea căutarea pornește din vecinătatea
 * poziției precedente și abia dacă acolo nu găsește nimic plauzibil se uită pe
 * tot traseul.
 *
 * **Nu se lipește nimic cu forța.** Un fix aflat în afara coridorului este
 * raportat ca atare (`onTrack: false`), nu mutat pe circuit. Distincția
 * contează: mașina în padoc, pe drumul de acces sau cu receptorul defect chiar
 * *nu este* pe traseu, iar o hartă care o desenează oricum pe asfalt ascunde
 * tocmai lucrul pe care operatorul trebuie să îl vadă.
 */

import { isUsableFix, type GpsFix } from './gps'
import {
  deltaS,
  headingOf,
  sectorAt,
  segmentAt,
  toGeo,
  toLocal,
  trackReference,
  wrapS,
  type TrackReference,
  type TrackSegment,
} from './track-reference'
import type { TrackSector } from './track-zolder'

export const MATCHING = {
  /**
   * Cât de departe de linia mediană poate fi un fix ca să fie considerat pe
   * traseu, în metri.
   *
   * Asfaltul are vreo doisprezece metri lățime, deci marginea lui este la ~6 m
   * de mijloc. Restul până la 25 m este bugetul de eroare al receptorului: cu
   * HDOP prost un fix onest poate cădea la cincisprezece metri de unde este
   * mașina. Un prag mai strâns ar declara „în afara traseului" exact când
   * receptorul e mai slab, adică exact când proiecția ajută cel mai mult.
   */
  corridorM: 25,
  /**
   * Cât caută potrivirea în jurul poziției precedente, în metri de traseu.
   *
   * La 120 km/h mașina avansează 3,3 m între două eșantioane de 10 Hz. O sută
   * cincizeci de metri acoperă și o pauză de câteva secunde în transmisie, dar
   * rămâne mult sub distanța până la porțiunile paralele ale circuitului.
   */
  windowM: 150,
  /**
   * După atâtea fixuri consecutive în afara coridorului, potrivirea uită
   * poziția precedentă și caută din nou pe tot circuitul.
   *
   * Fără uitare, o mașină transportată în padoc și readusă pe grilă ar continua
   * să fie căutată lângă locul unde a ieșit de pe traseu.
   */
  offTrackBeforeReset: 20,
} as const

/** Rezultatul proiecției unui fix pe traseu. */
export type TrackMatch = {
  /** Distanța de la linia de start până la punctul proiectat, în metri. */
  s: number
  /**
   * Abaterea laterală față de linia mediană, în metri. Pozitiv la stânga
   * sensului de mers, negativ la dreapta. Modulul este distanța reală până la
   * traseu, inclusiv când proiecția cade pe capătul unui segment.
   */
  offsetM: number
  /** Poziția de pe traseu, în grade. */
  lat: number
  lon: number
  /** Altitudinea traseului în acel punct — teren, nu măsurătoare. */
  elevationM: number
  /** Direcția traseului acolo, grade față de nord. */
  headingDeg: number
  /** Panta traseului acolo, ca fracțiune (0,03 = 3 %). */
  gradeFraction: number
  sector: TrackSector
  /** Adevărat doar dacă fixul a căzut în coridor. */
  onTrack: boolean
}

type Projection = {
  segment: TrackSegment
  s: number
  offsetM: number
  distanceM: number
}

/** Proiectează un punct local pe un segment, cu capetele incluse. */
function projectOnSegment(
  segment: TrackSegment,
  x: number,
  y: number,
): Projection {
  const px = x - segment.x0
  const py = y - segment.y0

  // Poziția relativă pe segment, limitată la [0, 1]: dincolo de capete punctul
  // aparține segmentului vecin, iar fără limitare proiecția ar aluneca pe
  // prelungirea dreptei, undeva în afara circuitului.
  let ratio = (px * segment.dx + py * segment.dy) * segment.invLengthSq
  if (ratio < 0) ratio = 0
  else if (ratio > 1) ratio = 1

  const closestX = segment.x0 + segment.dx * ratio
  const closestY = segment.y0 + segment.dy * ratio
  const distanceM = Math.hypot(x - closestX, y - closestY)

  // Semnul vine din produsul vectorial, deci rămâne corect și când proiecția a
  // fost limitată la un capăt; mărimea vine din distanța efectivă, care în acel
  // caz nu mai este perpendiculara pe dreaptă.
  const cross = segment.dx * py - segment.dy * px
  const sign = cross >= 0 ? 1 : -1

  return {
    segment,
    s: segment.startS + segment.lengthM * ratio,
    offsetM: sign * distanceM,
    distanceM,
  }
}

/** Cea mai bună proiecție dintre segmentele date. */
function bestOf(
  reference: TrackReference,
  indices: Iterable<number>,
  x: number,
  y: number,
): Projection | null {
  let best: Projection | null = null

  for (const index of indices) {
    const projection = projectOnSegment(reference.segments[index], x, y)
    if (best === null || projection.distanceM < best.distanceM) {
      best = projection
    }
  }

  return best
}

/**
 * Indicii segmentelor aflate la cel mult `windowM` de poziția dată, de o parte
 * și de alta, pe traseu.
 *
 * Mersul se face pe indici, nu pe distanțe cumulate, ca să traverseze firesc
 * linia de start: pe un circuit închis segmentul de dinaintea kilometrului zero
 * este vecin cu cel de după, oricât de diferite ar fi distanțele lor cumulate.
 */
function windowAround(
  reference: TrackReference,
  s: number,
  windowM: number,
): number[] {
  const segments = reference.segments
  const count = segments.length
  const center = segmentAt(reference, s).index
  const indices = [center]

  let behind = 0
  for (let step = 1; step < count && behind < windowM; step += 1) {
    const index = (center - step + count * 2) % count
    indices.push(index)
    behind += segments[index].lengthM
  }

  let ahead = 0
  for (let step = 1; step < count && ahead < windowM; step += 1) {
    const index = (center + step) % count
    // Un circuit scurt cu o fereastră mare ar putea întâlni același segment din
    // ambele direcții; proiectat de două ori ar da același rezultat, dar
    // verificarea costă mai puțin decât munca dublă.
    if (!indices.includes(index)) indices.push(index)
    ahead += segments[index].lengthM
  }

  return indices
}

function allIndices(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
}

function describe(
  reference: TrackReference,
  projection: Projection,
  onTrack: boolean,
): TrackMatch {
  const segment = projection.segment
  const ratio =
    segment.lengthM > 0
      ? (projection.s - segment.startS) / segment.lengthM
      : 0

  const x = segment.x0 + segment.dx * ratio
  const y = segment.y0 + segment.dy * ratio
  const { lat, lon } = toGeo(reference, x, y)
  const rise = segment.elevation1 - segment.elevation0

  return {
    s: wrapS(reference, projection.s),
    offsetM: projection.offsetM,
    lat,
    lon,
    elevationM: segment.elevation0 + rise * ratio,
    headingDeg: headingOf(segment),
    gradeFraction: segment.lengthM > 0 ? rise / segment.lengthM : 0,
    sector: sectorAt(reference, segment.index),
    onTrack,
  }
}

export type MatcherOptions = {
  corridorM?: number
  windowM?: number
  offTrackBeforeReset?: number
  reference?: TrackReference
}

/**
 * Potrivirea cu memorie: ține minte unde era mașina, ca să nu o teleporteze pe
 * porțiunea paralelă a circuitului.
 *
 * Instanța este stateful prin proiectare. Aceeași secvență de fixuri dă același
 * rezultat doar pornind de la o instanță nouă — de aceea consumatorii care
 * recalculează toată urma la fiecare cadru își creează un `TrackMatcher` nou,
 * în loc să refolosească unul care ar purta starea cadrului anterior.
 */
export class TrackMatcher {
  private readonly reference: TrackReference
  private readonly corridorM: number
  private readonly windowM: number
  private readonly offTrackBeforeReset: number

  /** Ultima poziție acceptată pe traseu. `null` înseamnă „caută peste tot". */
  private anchorS: number | null = null
  private consecutiveOffTrack = 0

  constructor(options: MatcherOptions = {}) {
    this.reference = options.reference ?? trackReference
    this.corridorM = options.corridorM ?? MATCHING.corridorM
    this.windowM = options.windowM ?? MATCHING.windowM
    this.offTrackBeforeReset =
      options.offTrackBeforeReset ?? MATCHING.offTrackBeforeReset
  }

  reset(): void {
    this.anchorS = null
    this.consecutiveOffTrack = 0
  }

  /** Unde consideră potrivirea că este mașina acum, pe traseu. */
  get anchor(): number | null {
    return this.anchorS
  }

  match(latitude: number, longitude: number): TrackMatch {
    const reference = this.reference
    const { x, y } = toLocal(reference, latitude, longitude)

    // Mai întâi în jurul poziției precedente. Dacă fixul cade acolo în coridor,
    // este cu siguranță continuarea drumului și nu mai are rost o căutare care
    // ar putea prefera o porțiune paralelă aflată întâmplător cu un metru mai
    // aproape.
    if (this.anchorS !== null) {
      const local = bestOf(
        reference,
        windowAround(reference, this.anchorS, this.windowM),
        x,
        y,
      )
      if (local !== null && local.distanceM <= this.corridorM) {
        this.anchorS = local.s
        this.consecutiveOffTrack = 0
        return describe(reference, local, true)
      }
    }

    // Căutare pe tot circuitul. Liniară peste cele câteva sute de segmente:
    // rulează doar la primul fix și după ieșirile de pe traseu, deci un index
    // spațial ar adăuga cod de întreținut fără să scurteze nimic măsurabil.
    const global = bestOf(
      reference,
      allIndices(reference.segments.length),
      x,
      y,
    )
    if (global === null) {
      throw new Error('referința de traseu nu are segmente')
    }

    const onTrack = global.distanceM <= this.corridorM
    if (onTrack) {
      this.anchorS = global.s
      this.consecutiveOffTrack = 0
    } else {
      this.consecutiveOffTrack += 1
      if (this.consecutiveOffTrack >= this.offTrackBeforeReset) {
        this.anchorS = null
      }
    }

    return describe(reference, global, onTrack)
  }
}

/**
 * Câte tururi complete înseamnă un avans net dat.
 *
 * Trunchiere, nu rotunjire în jos. Diferența apare exact unde contează: o
 * mașină oprită pe linia de start oscilează în jurul lui zero, iar avansul ei
 * net ajunge la câțiva centimetri negativi. Rotunjit în jos, `-0,06 m` pe un
 * circuit de patru kilometri dă turul **−1** — adică un tur inventat din
 * zgomotul receptorului, tocmai pe mașina care nu s-a mișcat. Trunchiat, dă
 * zero, iar un tur întreg mers înapoi tot se raportează ca −1.
 */
function completedLaps(progressM: number, lengthM: number): number {
  const laps = Math.trunc(progressM / lengthM)
  // `Math.trunc` de pe un avans negativ mic întoarce `-0`. Se afișează „0" și
  // se compară egal cu zero, dar nu este *identic* cu el, iar un test strict
  // sau o cheie de memoizare l-ar trata ca pe altă valoare.
  return laps === 0 ? 0 : laps
}

/** Un fix după proiecție, cu poziția pe tur și distanța cumulată. */
export type MatchedFix = {
  timeMs: number
  /** Coordonatele așa cum au venit de pe mașină. */
  raw: { lat: number; lon: number }
  match: TrackMatch
  /** Turul, numărat de la primul fix acceptat pe traseu. */
  lap: number
  /** Distanța parcursă pe traseu de la primul fix acceptat, în metri. */
  distanceM: number
}

export type MatchedRun = {
  fixes: MatchedFix[]
  /** Câte ture complete s-au închis. */
  lapCount: number
  /**
   * Distanța parcursă pe traseu, în metri — avans înainte, cu prag de zgomot.
   * Crește monoton.
   */
  distanceM: number
  /** Avansul net cu semn — negativ dacă mașina a mers înapoi pe traseu. */
  progressM: number
  onTrack: number
  offTrack: number
  /** Mediana modulului abaterii laterale, pe fixurile din coridor. */
  medianOffsetM: number | null
  reference: TrackReference
}

/**
 * Proiectează o serie întreagă de fixuri și numără turele.
 *
 * Turele nu se numără urmărind „a trecut peste linie": pe o mașină oprită
 * exact pe linia de start, zgomotul ar produce o trecere la fiecare eșantion.
 * Se numără din avansul net cumulat — fiecare pas contribuie cu deplasarea lui
 * pe drumul cel mai scurt, iar oscilația în jurul liniei se adună la
 * aproximativ zero. Un tur se închide când avansul net trece de o lungime de
 * circuit, ceea ce nu se poate întâmpla din zgomot.
 */
export function matchRun(
  fixes: GpsFix[],
  options: MatcherOptions = {},
): MatchedRun {
  const matcher = new TrackMatcher(options)
  const reference = options.reference ?? trackReference

  const matched: MatchedFix[] = []
  const offsets: number[] = []

  let progressM = 0
  let distanceM = 0
  let previousS: number | null = null
  let onTrack = 0
  let offTrack = 0

  for (const fix of fixes) {
    if (!isUsableFix(fix)) continue

    const match = matcher.match(fix.latitude, fix.longitude)

    if (match.onTrack) {
      onTrack += 1
      offsets.push(Math.abs(match.offsetM))

      if (previousS !== null) {
        // Avansul net păstrează semnul: din el se numără turele, iar zgomotul
        // din jurul unei poziții fixe se adună la aproximativ zero.
        progressM += deltaS(reference, previousS, match.s)
      }
      previousS = match.s

      // Odometrul este maximul atins de avansul net, nu o sumă de pași.
      //
      // Diferența este întreaga problemă. O sumă de pași adună la fiecare
      // eșantion și modulul zgomotului, care nu scade niciodată: la 10 Hz și
      // 22 m/s mașina avansează 2,2 m între eșantioane, iar un receptor cu 4 m
      // dispersie produce pași de câțiva metri din zgomot pur — distanța ieșea
      // de trei ori mai mare decât circuitul. Era exact eroarea pe care
      // proiecția trebuia să o repare, refăcută pe altă axă.
      //
      // Avansul net, în schimb, se telescopează: suma diferențelor dintre
      // poziții consecutive *este* diferența dintre prima și ultima, deci
      // zgomotul intermediar se anulează în întregime. Rămâne doar cel al
      // capetelor, adică metri, nu kilometri. Maximul peste istoric adaugă
      // monotonia de care are nevoie un odometru, fără să reintroducă
      // acumularea.
      distanceM = Math.max(distanceM, progressM)
    } else {
      offTrack += 1
      // Cât timp mașina nu este pe traseu nu se acumulează nici distanță, nici
      // tur: poziția ei pe linia mediană este o ficțiune, iar diferența față de
      // ultimul punct real ar intra în odometru ca un salt.
      previousS = null
    }

    matched.push({
      timeMs: fix.timeMs,
      raw: { lat: fix.latitude, lon: fix.longitude },
      match,
      lap: completedLaps(progressM, reference.lengthM),
      distanceM,
    })
  }

  offsets.sort((a, b) => a - b)
  const medianOffsetM =
    offsets.length === 0
      ? null
      : offsets.length % 2 === 1
        ? offsets[(offsets.length - 1) / 2]
        : (offsets[offsets.length / 2 - 1] + offsets[offsets.length / 2]) / 2

  return {
    fixes: matched,
    lapCount: completedLaps(progressM, reference.lengthM),
    distanceM,
    progressM,
    onTrack,
    offTrack,
    medianOffsetM,
    reference,
  }
}
