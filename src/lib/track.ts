/**
 * Geometria circuitului folosit de simulator.
 *
 * Traseul este definit prin puncte de reper, interpolate cu o spline
 * Catmull-Rom închisă și reeșantionate la pas constant de lungime de arc. Din
 * curbura rezultată se calculează un profil de viteză: mașina încetinește în
 * viraje și accelerează pe drepte, cu limite realiste de accelerație și frânare.
 *
 * Coordonatele sunt în metri, cu `x` spre est și `y` spre nord, față de centrul
 * circuitului. Conversia în grade se face în `toLatLon`.
 */

export type Vec2 = { x: number; y: number }

/**
 * Puncte de reper, în metri. Formează un circuit cu o dreaptă principală, un
 * viraj rapid, o zonă de șicane, un ac de păr și un sector de esuri care taie
 * prin interiorul buclei.
 */
const WAYPOINTS: Vec2[] = [
  { x: -300, y: -200 }, // start/finish
  { x: -60, y: -215 },
  { x: 190, y: -210 }, // capătul dreptei principale
  { x: 400, y: -190 },
  { x: 505, y: -95 }, // viraj 1, rapid, spre dreapta
  { x: 525, y: 45 },
  { x: 470, y: 175 }, // intrare în șicană
  { x: 545, y: 275 },
  { x: 470, y: 370 }, // ieșire din șicană
  { x: 355, y: 455 },
  { x: 205, y: 480 }, // dreapta din spate
  { x: 55, y: 470 },
  { x: -75, y: 505 }, // intrare în acul de păr
  { x: -170, y: 440 },
  { x: -125, y: 330 }, // ieșire din acul de păr
  { x: -20, y: 265 }, // esuri prin interior
  { x: -105, y: 165 },
  { x: -20, y: 70 },
  { x: -150, y: 5 }, // ultimul viraj
  { x: -320, y: -70 },
]

/** Distanța dintre eșantioanele traseului, în metri. */
const SAMPLE_SPACING_M = 3

/** Accelerația laterală maximă acceptată în viraje. */
export const MAX_LATERAL_ACCEL = 3.4
/** Accelerația longitudinală maximă — o mașină solară nu are rezerve mari. */
export const MAX_ACCEL = 1.1
/** Decelerația maximă la frânare. */
export const MAX_BRAKE = 2.6

export const MAX_SPEED_MPS = 25 // 90 km/h
export const MIN_SPEED_MPS = 7 // 25 km/h, în vârful acului de păr

/** Interpolare Catmull-Rom uniformă între `p1` și `p2`. */
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t
  const t3 = t2 * t

  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Spline densă prin toate reperele, ca buclă închisă. */
function buildDenseCurve(waypoints: Vec2[], stepsPerSegment: number): Vec2[] {
  const count = waypoints.length
  const curve: Vec2[] = []

  for (let index = 0; index < count; index += 1) {
    const p0 = waypoints[(index - 1 + count) % count]!
    const p1 = waypoints[index]!
    const p2 = waypoints[(index + 1) % count]!
    const p3 = waypoints[(index + 2) % count]!

    for (let step = 0; step < stepsPerSegment; step += 1) {
      curve.push(catmullRom(p0, p1, p2, p3, step / stepsPerSegment))
    }
  }

  return curve
}

/** Reeșantionează curba la pas constant de lungime de arc. */
function resampleByArcLength(curve: Vec2[], spacing: number): Vec2[] {
  const resampled: Vec2[] = [curve[0]!]
  let carry = 0

  for (let index = 0; index < curve.length; index += 1) {
    const current = curve[index]!
    const next = curve[(index + 1) % curve.length]!
    const segment = distance(current, next)
    if (segment === 0) continue

    let offset = spacing - carry
    while (offset <= segment) {
      const t = offset / segment
      resampled.push({
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
      })
      offset += spacing
    }
    carry = segment - (offset - spacing)
  }

  // Ultimul punct poate cădea prea aproape de primul după închiderea buclei.
  if (
    resampled.length > 1 &&
    distance(resampled.at(-1)!, resampled[0]!) < spacing * 0.5
  ) {
    resampled.pop()
  }

  return resampled
}

/**
 * Curbura într-un punct, prin raza cercului circumscris celor trei puncte
 * vecine. Mai stabil numeric decât diferențele finite de ordinul doi.
 */
function curvatureAt(previous: Vec2, current: Vec2, next: Vec2): number {
  const a = distance(previous, current)
  const b = distance(current, next)
  const c = distance(previous, next)
  if (a === 0 || b === 0 || c === 0) return 0

  // Aria triunghiului prin produsul vectorial.
  const cross =
    (current.x - previous.x) * (next.y - previous.y) -
    (current.y - previous.y) * (next.x - previous.x)
  const area = Math.abs(cross) / 2
  if (area < 1e-9) return 0

  const radius = (a * b * c) / (4 * area)
  return 1 / radius
}

/**
 * Profil de viteză fizic plauzibil.
 *
 * Pornim de la viteza maximă permisă de curbură în fiecare punct, apoi aplicăm
 * treceri înainte și înapoi peste buclă pentru a respecta limitele de
 * accelerație și frânare — altfel mașina ar intra în viraj cu viteza de pe
 * dreaptă și ar „sări" instantaneu la viteza de viraj.
 */
function buildSpeedProfile(curvatures: number[], spacing: number): number[] {
  const count = curvatures.length
  const speeds = curvatures.map((curvature) => {
    if (curvature <= 1e-6) return MAX_SPEED_MPS
    const cornerSpeed = Math.sqrt(MAX_LATERAL_ACCEL / curvature)
    return Math.min(MAX_SPEED_MPS, Math.max(MIN_SPEED_MPS, cornerSpeed))
  })

  // Două iterații sunt suficiente ca limitele să se propage peste închiderea buclei.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = count - 1; index >= 0; index -= 1) {
      const ahead = speeds[(index + 1) % count]!
      const reachable = Math.sqrt(ahead * ahead + 2 * MAX_BRAKE * spacing)
      speeds[index] = Math.min(speeds[index]!, reachable)
    }
    for (let index = 0; index < count; index += 1) {
      const behind = speeds[(index - 1 + count) % count]!
      const reachable = Math.sqrt(behind * behind + 2 * MAX_ACCEL * spacing)
      speeds[index] = Math.min(speeds[index]!, reachable)
    }
  }

  return speeds
}

function buildTrack() {
  const dense = buildDenseCurve(WAYPOINTS, 60)
  const points = resampleByArcLength(dense, SAMPLE_SPACING_M)

  const curvatures = points.map((point, index) =>
    curvatureAt(
      points[(index - 1 + points.length) % points.length]!,
      point,
      points[(index + 1) % points.length]!,
    ),
  )

  return {
    points,
    curvatures,
    speeds: buildSpeedProfile(curvatures, SAMPLE_SPACING_M),
    spacing: SAMPLE_SPACING_M,
    length: points.length * SAMPLE_SPACING_M,
  }
}

export const TRACK = buildTrack()

/** Interpolare liniară între două eșantioane vecine ale traseului. */
function sampleAt<T>(
  values: T[],
  distanceM: number,
  blend: (a: T, b: T, t: number) => T,
): T {
  const raw = distanceM / TRACK.spacing
  const index = Math.floor(raw)
  const t = raw - index
  const a = values[((index % values.length) + values.length) % values.length]!
  const b = values[((index + 1) % values.length + values.length) % values.length]!
  return blend(a, b, t)
}

/** Poziția pe traseu la distanța dată de la linia de start. */
export function positionAt(distanceM: number): Vec2 {
  return sampleAt(TRACK.points, distanceM, (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }))
}

/** Viteza-țintă din profil, în m/s, la distanța dată. */
export function targetSpeedAt(distanceM: number): number {
  return sampleAt(TRACK.speeds, distanceM, (a, b, t) => a + (b - a) * t)
}

const METERS_PER_DEG_LAT = 111_320

/** Convertește coordonate locale în grade, în jurul unui centru dat. */
export function toLatLon(
  point: Vec2,
  center: { lat: number; lon: number },
): { lat: number; lon: number } {
  const metersPerDegLon =
    METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180)

  return {
    lat: center.lat + point.y / METERS_PER_DEG_LAT,
    lon: center.lon + point.x / metersPerDegLon,
  }
}
