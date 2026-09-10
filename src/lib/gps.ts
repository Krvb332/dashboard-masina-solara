/**
 * Geometria poziției: distanțe, direcție, elevație și validarea fixului.
 *
 * `lib/track-projection.ts` se ocupă de *desen* — cum ajung gradele pixeli pe
 * canvas. Modulul de față se ocupă de *măsurători*: câți metri sunt între două
 * fixuri, ce pantă are traseul, cât s-a urcat pe tur. Sunt lucruri diferite și
 * greșite diferit: o proiecție strâmbă se vede pe ecran, o distanță greșită
 * intră tăcut în consumul pe kilometru.
 *
 * Toate funcțiile refuză fixurile implauzibile. Un receptor GNSS fără fix
 * raportează frecvent `0,0` — „Null Island", în golful Guineei. Acceptat ca
 * poziție, un singur asemenea eșantion ar adăuga ~5000 km la distanța sesiunii
 * și ar strica tot ce se calculează din ea.
 */

export const EARTH_RADIUS_M = 6_371_008.8

export type GpsFix = {
  /** Momentul eșantionului, în milisecunde. */
  timeMs: number
  latitude: number
  longitude: number
  /** Altitudine în metri. Absentă pe receptoarele care nu o raportează. */
  altitude?: number | null
  hdop?: number | null
  satellites?: number | null
  /** 0 fără fix, 1 GPS, 2 DGPS, 4 RTK fix, 5 RTK float. */
  fixQuality?: number | null
}

/** Praguri peste care o poziție nu mai susține analiza turului. */
export const FIX_LIMITS = {
  maxHdop: 5,
  minSatellites: 4,
  /** Sub un grad de la (0, 0) receptorul raportează de fapt „fără fix". */
  nullIslandDeg: 1,
  /** O mașină solară nu se teleportează: peste atât e salt de receptor. */
  maxSpeedMs: 60,
  /** Peste atâția metri pe secundă verticali, altitudinea este zgomot. */
  maxClimbMs: 12,
} as const

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Coordonatele sunt numere valide și în intervalul admis de WGS84. */
export function hasValidCoordinates(fix: Partial<GpsFix>): boolean {
  if (!isFiniteNumber(fix.latitude) || !isFiniteNumber(fix.longitude)) {
    return false
  }
  if (fix.latitude < -90 || fix.latitude > 90) return false
  if (fix.longitude < -180 || fix.longitude > 180) return false

  const nearNullIsland =
    Math.abs(fix.latitude) < FIX_LIMITS.nullIslandDeg &&
    Math.abs(fix.longitude) < FIX_LIMITS.nullIslandDeg
  return !nearNullIsland
}

/**
 * Fixul poate fi folosit pentru hartă și pentru calculul distanței.
 *
 * Câmpurile de calitate lipsesc pe unele receptoare; absența lor nu invalidează
 * poziția, dar o valoare proastă raportată explicit o invalidează.
 */
export function isUsableFix(fix: Partial<GpsFix>): boolean {
  if (!hasValidCoordinates(fix)) return false
  if (isFiniteNumber(fix.hdop) && fix.hdop > FIX_LIMITS.maxHdop) return false
  if (
    isFiniteNumber(fix.satellites) &&
    fix.satellites < FIX_LIMITS.minSatellites
  ) {
    return false
  }
  if (isFiniteNumber(fix.fixQuality) && fix.fixQuality < 1) return false
  return true
}

/**
 * Distanța pe cerc mare între două fixuri, în metri (haversine).
 *
 * La scara unui circuit diferența față de o proiecție plană este sub un
 * centimetru, dar formula rămâne corectă și pe etape lungi de cursă, unde
 * aproximarea plană se rupe.
 */
export function haversineMeters(
  from: Pick<GpsFix, 'latitude' | 'longitude'>,
  to: Pick<GpsFix, 'latitude' | 'longitude'>,
): number | null {
  if (!hasValidCoordinates(from) || !hasValidCoordinates(to)) return null

  const phi1 = toRadians(from.latitude)
  const phi2 = toRadians(to.latitude)
  const deltaPhi = toRadians(to.latitude - from.latitude)
  const deltaLambda = toRadians(to.longitude - from.longitude)

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Direcția de la un fix la altul, în grade față de nord (0–360). */
export function bearingDeg(
  from: Pick<GpsFix, 'latitude' | 'longitude'>,
  to: Pick<GpsFix, 'latitude' | 'longitude'>,
): number | null {
  if (!hasValidCoordinates(from) || !hasValidCoordinates(to)) return null

  const phi1 = toRadians(from.latitude)
  const phi2 = toRadians(to.latitude)
  const deltaLambda = toRadians(to.longitude - from.longitude)

  const y = Math.sin(deltaLambda) * Math.cos(phi2)
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda)

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Viteza dedusă din două fixuri consecutive, în m/s. */
export function speedFromFixes(from: GpsFix, to: GpsFix): number | null {
  const distance = haversineMeters(from, to)
  if (distance === null) return null

  const seconds = (to.timeMs - from.timeMs) / 1000
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return distance / seconds
}

/**
 * Panta dintre două fixuri, ca fracțiune (0,05 = 5 %).
 *
 * Fără altitudine validă nu există pantă — și nu presupunem teren plat:
 * `0` ar intra în modelul de rezistență la înaintare ca afirmație, nu ca lipsă
 * de informație.
 */
export function gradeFraction(from: GpsFix, to: GpsFix): number | null {
  if (!isFiniteNumber(from.altitude) || !isFiniteNumber(to.altitude)) {
    return null
  }

  const run = haversineMeters(from, to)
  if (run === null || run < 1) return null

  const rise = to.altitude - from.altitude
  const seconds = (to.timeMs - from.timeMs) / 1000
  // Salt vertical imposibil între două eșantioane: zgomot de receptor, nu deal.
  if (seconds > 0 && Math.abs(rise) / seconds > FIX_LIMITS.maxClimbMs) {
    return null
  }

  return rise / run
}

export type ElevationProfile = {
  /** Metri urcați cumulat. */
  gainM: number
  /** Metri coborâți cumulat, ca număr pozitiv. */
  lossM: number
  minM: number | null
  maxM: number | null
  /** Punctele (distanță cumulată în metri, altitudine) pentru grafic. */
  points: [number, number][]
}

/** Câți metri lipsesc între două eșantioane ca să nu numărăm zgomot ca urcare. */
const ELEVATION_NOISE_M = 0.5

/**
 * Profilul de elevație al unei serii de fixuri.
 *
 * Câștigul se numără doar peste pragul de zgomot: un receptor obișnuit are
 * ±1 m dispersie pe verticală, iar însumarea naivă a diferențelor ar raporta
 * sute de metri urcați pe un circuit perfect plan.
 */
export function elevationProfile(fixes: GpsFix[]): ElevationProfile {
  const usable = fixes.filter(
    (fix) => isUsableFix(fix) && isFiniteNumber(fix.altitude),
  )

  const empty: ElevationProfile = {
    gainM: 0,
    lossM: 0,
    minM: null,
    maxM: null,
    points: [],
  }
  if (usable.length === 0) return empty

  let gain = 0
  let loss = 0
  let distance = 0
  let min = usable[0].altitude as number
  let max = usable[0].altitude as number
  const points: [number, number][] = [[0, usable[0].altitude as number]]

  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1]
    const current = usable[index]

    const step = haversineMeters(previous, current)
    if (step !== null) distance += step

    const altitude = current.altitude as number
    const rise = altitude - (previous.altitude as number)

    if (rise > ELEVATION_NOISE_M) gain += rise
    else if (rise < -ELEVATION_NOISE_M) loss += -rise

    min = Math.min(min, altitude)
    max = Math.max(max, altitude)
    points.push([distance, altitude])
  }

  return { gainM: gain, lossM: loss, minM: min, maxM: max, points }
}

/** Lungimea traseului parcurs, în metri, sărind peste salturile de receptor. */
export function trackLengthMeters(fixes: GpsFix[]): number {
  const usable = fixes.filter(isUsableFix)
  let total = 0

  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1]
    const current = usable[index]
    const step = haversineMeters(previous, current)
    if (step === null) continue

    const seconds = (current.timeMs - previous.timeMs) / 1000
    if (seconds > 0 && step / seconds > FIX_LIMITS.maxSpeedMs) continue
    total += step
  }

  return total
}

/**
 * Elimină fixurile care implică o viteză imposibilă față de cel anterior.
 * Un singur salt de receptor desenează o linie dreaptă peste toată harta.
 */
export function rejectOutliers(fixes: GpsFix[]): GpsFix[] {
  const usable = fixes.filter(isUsableFix)
  if (usable.length === 0) return []

  const kept: GpsFix[] = [usable[0]]

  for (let index = 1; index < usable.length; index += 1) {
    const candidate = usable[index]
    const speed = speedFromFixes(kept[kept.length - 1], candidate)
    if (speed !== null && speed > FIX_LIMITS.maxSpeedMs) continue
    kept.push(candidate)
  }

  return kept
}

export type FixQualityReport = {
  total: number
  usable: number
  rejected: number
  withAltitude: number
  /** Motivele respingerii, pentru panoul de verificare a mapării. */
  reasons: Record<string, number>
}

/**
 * De ce au fost respinse fixurile. Panoul de verificare arată exact asta:
 * „12 fixuri fără altitudine" trimite pe cineva la mesajul GGA din firmware,
 * nu la o dezbatere despre harta care „sare".
 */
export function inspectFixes(fixes: GpsFix[]): FixQualityReport {
  const reasons: Record<string, number> = {}
  let usable = 0
  let withAltitude = 0

  const bump = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1
  }

  for (const fix of fixes) {
    if (!hasValidCoordinates(fix)) {
      bump('coordonate lipsă sau (0, 0)')
      continue
    }
    if (isFiniteNumber(fix.fixQuality) && fix.fixQuality < 1) {
      bump('receptor fără fix')
      continue
    }
    if (isFiniteNumber(fix.hdop) && fix.hdop > FIX_LIMITS.maxHdop) {
      bump(`HDOP peste ${FIX_LIMITS.maxHdop}`)
      continue
    }
    if (
      isFiniteNumber(fix.satellites) &&
      fix.satellites < FIX_LIMITS.minSatellites
    ) {
      bump(`sub ${FIX_LIMITS.minSatellites} sateliți`)
      continue
    }

    usable += 1
    if (isFiniteNumber(fix.altitude)) withAltitude += 1
    else bump('fără altitudine')
  }

  return {
    total: fixes.length,
    usable,
    rejected: fixes.length - usable,
    withAltitude,
    reasons,
  }
}
