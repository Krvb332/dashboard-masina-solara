/**
 * Referința geometrică a circuitului: linia mediană adusă într-un cadru metric
 * local, cu distanțe cumulate, altitudine și sectoare.
 *
 * `track-zolder.ts` ține datele brute — grade și metri, așa cum au venit din
 * OpenStreetMap și din modelul de teren. Modulul de față le transformă o
 * singură dată, la încărcare, în forma pe care o cer toate calculele de după:
 * coordonate în metri față de un punct fix, lungimi de segmente, distanța
 * cumulată de la linia de start.
 *
 * **De ce un cadru local în metri.** Proiecția fixurilor pe traseu este o
 * problemă de geometrie plană: proiectezi un punct pe un segment. În grade
 * geografice segmentul nu este drept și un grad de longitudine nu are aceeași
 * lungime cu unul de latitudine, deci formula elementară ar da un rezultat
 * greșit — și greșit *inegal*, mai mult spre nordul circuitului decât spre
 * sudul lui. Convertite o dată în metri față de centrul circuitului, cele două
 * axe devin comparabile și proiecția redevine ceea ce pare: un produs scalar.
 *
 * Aproximarea este echirectangulară, ca și la desenul hărții, dar cu factorii
 * de scară calculați pentru latitudinea circuitului în loc de constanta rotundă
 * — vezi `degreeScales`. La patru kilometri, ce rămâne din eroarea ei este sub
 * un centimetru, adică cu două ordine de mărime sub zgomotul oricărui receptor.
 */

import {
  ZOLDER_METADATA,
  ZOLDER_NODES,
  ZOLDER_SECTORS,
  type TrackNode,
  type TrackSector,
} from './track-zolder'

/**
 * Câți metri are un grad de latitudine și unul de longitudine, la latitudinea
 * dată, pe elipsoidul WGS84.
 *
 * Restul dashboardului folosește constanta rotundă de 111 320 m pentru un grad
 * de latitudine — pentru bara de scară a hărții este mai mult decât suficientă.
 * Aici nu este: din lungimile segmentelor se compune lungimea circuitului, iar
 * din ea distanța pe tur și consumul pe kilometru. Constanta rotundă supraevaluează
 * latitudinea cu 0,065 % și subevaluează longitudinea cu 0,2 %, iar pe patru
 * kilometri asta înseamnă câțiva metri pe tur, în aceeași direcție de fiecare
 * dată — adică o eroare care se acumulează, nu una care se mediază.
 *
 * Seriile sunt aproximarea clasică a razelor de curbură ale elipsoidului; la o
 * latitudine fixă eroarea lor este sub un metru la grad, deci sub 0,001 % aici.
 * Măsurată așa, linia mediană iese 4008,7 m față de cei 4011 m publicați — o
 * potrivire care, cu constanta rotundă, s-ar fi pierdut în propria aproximare.
 */
export function degreeScales(latitudeDeg: number): {
  metersPerDegLat: number
  metersPerDegLon: number
} {
  const phi = (latitudeDeg * Math.PI) / 180
  return {
    metersPerDegLat:
      111_132.92 -
      559.82 * Math.cos(2 * phi) +
      1.175 * Math.cos(4 * phi) -
      0.0023 * Math.cos(6 * phi),
    metersPerDegLon:
      111_412.84 * Math.cos(phi) -
      93.5 * Math.cos(3 * phi) +
      0.118 * Math.cos(5 * phi),
  }
}

/** Un punct al traseului în cadrul metric local. */
export type LocalPoint = { x: number; y: number }

/**
 * Un segment al liniei mediane, precalculat pentru proiecție.
 *
 * Toate mărimile sunt în cadrul local, în metri. `invLengthSq` este păstrat ca
 * să nu existe nicio împărțire în bucla de potrivire — se execută de sute de
 * ori pentru fiecare cadru desenat.
 */
export type TrackSegment = {
  /** Indicele nodului de start. */
  index: number
  x0: number
  y0: number
  /** Vectorul segmentului, în metri. */
  dx: number
  dy: number
  lengthM: number
  invLengthSq: number
  /** Distanța cumulată de la linia de start până la nodul de start. */
  startS: number
  elevation0: number
  elevation1: number
}

export type TrackReference = {
  name: string
  location: string
  /** Lungimea publicată a circuitului, pentru comparație. */
  officialLengthM: number
  /** Lungimea măsurată din geometria efectivă a liniei mediane. */
  lengthM: number
  nodes: readonly TrackNode[]
  sectors: readonly TrackSector[]
  segments: readonly TrackSegment[]
  /** Punctul față de care se măsoară cadrul local. */
  origin: { lat: number; lon: number }
  metersPerDegLat: number
  metersPerDegLon: number
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }
  /** Colțurile cadrului local, pentru desenul hărții. */
  localBounds: { minX: number; maxX: number; minY: number; maxY: number }
  geometrySource: string
  elevationSource: string
}

function buildReference(
  nodes: readonly TrackNode[],
  sectors: readonly TrackSector[],
  metadata: typeof ZOLDER_METADATA,
): TrackReference {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity

  for (const [lat, lon] of nodes) {
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
  }

  // Centrul circuitului ca origine: distribuie eroarea aproximării pe ambele
  // margini, în loc să o acumuleze la capătul opus unui colț.
  const origin = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 }
  const { metersPerDegLat, metersPerDegLon } = degreeScales(origin.lat)

  const local: LocalPoint[] = nodes.map(([lat, lon]) => ({
    x: (lon - origin.lon) * metersPerDegLon,
    y: (lat - origin.lat) * metersPerDegLat,
  }))

  const segments: TrackSegment[] = []
  let cumulative = 0

  for (let index = 0; index < nodes.length; index += 1) {
    // Ultimul segment se închide înapoi la nodul zero: bucla nu repetă nodul de
    // start, tocmai ca să nu existe un segment de lungime nulă.
    const next = (index + 1) % nodes.length
    const from = local[index]
    const to = local[next]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lengthSq = dx * dx + dy * dy
    const lengthM = Math.sqrt(lengthSq)

    segments.push({
      index,
      x0: from.x,
      y0: from.y,
      dx,
      dy,
      lengthM,
      invLengthSq: lengthSq > 0 ? 1 / lengthSq : 0,
      startS: cumulative,
      elevation0: nodes[index][2],
      elevation1: nodes[next][2],
    })

    cumulative += lengthM
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of local) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    name: metadata.name,
    location: metadata.location,
    officialLengthM: metadata.officialLengthM,
    lengthM: cumulative,
    nodes,
    sectors,
    segments,
    origin,
    metersPerDegLat,
    metersPerDegLon,
    bounds: { minLat, maxLat, minLon, maxLon },
    localBounds: { minX, maxX, minY, maxY },
    geometrySource: metadata.geometrySource,
    elevationSource: metadata.elevationSource,
  }
}

/** Circuitul pe care rulează dashboardul. */
export const trackReference: TrackReference = buildReference(
  ZOLDER_NODES,
  ZOLDER_SECTORS,
  ZOLDER_METADATA,
)

/** Coordonate geografice aduse în cadrul metric local al circuitului. */
export function toLocal(
  reference: TrackReference,
  lat: number,
  lon: number,
): LocalPoint {
  return {
    x: (lon - reference.origin.lon) * reference.metersPerDegLon,
    y: (lat - reference.origin.lat) * reference.metersPerDegLat,
  }
}

/** Drumul invers: din cadrul local înapoi în grade. */
export function toGeo(
  reference: TrackReference,
  x: number,
  y: number,
): { lat: number; lon: number } {
  return {
    lat: reference.origin.lat + y / reference.metersPerDegLat,
    lon: reference.origin.lon + x / reference.metersPerDegLon,
  }
}

/** Aduce o distanță pe traseu în intervalul [0, lungime). */
export function wrapS(reference: TrackReference, s: number): number {
  const wrapped = s % reference.lengthM
  return wrapped < 0 ? wrapped + reference.lengthM : wrapped
}

/**
 * Diferența dintre două poziții pe traseu, pe drumul cel mai scurt.
 *
 * Pe un circuit închis, „de la 3990 m la 10 m" înseamnă 20 m înainte, nu 3980 m
 * înapoi. Rezultatul este în intervalul (−lungime/2, +lungime/2], deci pozitiv
 * pentru mers înainte.
 */
export function deltaS(
  reference: TrackReference,
  from: number,
  to: number,
): number {
  const half = reference.lengthM / 2
  let delta = (to - from) % reference.lengthM
  if (delta > half) delta -= reference.lengthM
  if (delta <= -half) delta += reference.lengthM
  return delta
}

/** Segmentul care conține distanța dată, prin căutare binară. */
export function segmentAt(
  reference: TrackReference,
  s: number,
): TrackSegment {
  const target = wrapS(reference, s)
  const segments = reference.segments

  let low = 0
  let high = segments.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (segments[middle].startS <= target) low = middle
    else high = middle - 1
  }
  return segments[low]
}

export type TrackPointAt = {
  lat: number
  lon: number
  /** Altitudinea de referință, interpolată între noduri. */
  elevationM: number
  /** Direcția traseului în acel punct, grade față de nord. */
  headingDeg: number
  /** Panta locală ca fracțiune (0,03 = 3 %). */
  gradeFraction: number
  sector: TrackSector
}

/** Ce se află pe traseu la distanța dată de linia de start. */
export function pointAt(
  reference: TrackReference,
  s: number,
): TrackPointAt {
  const segment = segmentAt(reference, s)
  const along = wrapS(reference, s) - segment.startS
  // Un segment de lungime zero nu există în date, dar împărțirea la el ar
  // produce NaN care s-ar propaga tăcut în poziția desenată.
  const ratio = segment.lengthM > 0 ? along / segment.lengthM : 0

  const x = segment.x0 + segment.dx * ratio
  const y = segment.y0 + segment.dy * ratio
  const { lat, lon } = toGeo(reference, x, y)

  const rise = segment.elevation1 - segment.elevation0
  const elevationM = segment.elevation0 + rise * ratio

  return {
    lat,
    lon,
    elevationM,
    headingDeg: headingOf(segment),
    gradeFraction: segment.lengthM > 0 ? rise / segment.lengthM : 0,
    sector: sectorAt(reference, segment.index),
  }
}

/** Direcția unui segment, în grade față de nord. */
export function headingOf(segment: TrackSegment): number {
  // atan2(est, nord): în cadrul local x este estul și y nordul, iar azimutul se
  // măsoară de la nord spre est — deci argumentele sunt inversate față de
  // convenția matematică obișnuită.
  return ((Math.atan2(segment.dx, segment.dy) * 180) / Math.PI + 360) % 360
}

/** Sectorul care conține nodul dat. */
export function sectorAt(
  reference: TrackReference,
  nodeIndex: number,
): TrackSector {
  const sectors = reference.sectors
  let low = 0
  let high = sectors.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (sectors[middle].fromIndex <= nodeIndex) low = middle
    else high = middle - 1
  }
  return sectors[low]
}

/**
 * Profilul de altitudine al circuitului, ca perechi (distanță, altitudine).
 *
 * Spre deosebire de profilul calculat din fixuri, acesta nu depinde de ce a
 * reușit receptorul să măsoare: este terenul, așa cum este el, și rămâne
 * același de la o sesiune la alta.
 */
export function referenceElevationProfile(
  reference: TrackReference,
): [number, number][] {
  const points: [number, number][] = reference.segments.map((segment) => [
    segment.startS,
    segment.elevation0,
  ])
  // Închiderea buclei: ultimul punct repetă altitudinea de la start, la
  // distanța totală, ca graficul să nu se termine brusc înainte de linie.
  points.push([reference.lengthM, reference.segments[0].elevation0])
  return points
}
