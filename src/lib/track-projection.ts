/**
 * Matematica hărții de traseu, separată de desenul propriu-zis ca să poată fi
 * testată fără canvas.
 *
 * Proiecția este equirectangulară locală: la scara unui circuit (sute de metri),
 * corectarea longitudinii cu cosinusul latitudinii este suficientă pentru ca
 * forma traseului să nu apară deformată. Nu avem nevoie de o proiecție
 * cartografică reală și nici de tile-uri externe, ceea ce păstrează harta
 * funcțională fără internet.
 */

export type Position = { lat: number; lon: number; speed: number }
export type Projected = { x: number; y: number; speed: number }

export const METERS_PER_DEG_LAT = 111_320

/**
 * Împerechează seriile de latitudine, longitudine și viteză după momentul de
 * timp. Fiecare semnal are propriile eșantioane, iar o poziție fără ambele
 * coordonate nu poate fi desenată.
 */
export function pairPositions(
  latitudes: [number, number][],
  longitudes: [number, number][],
  speeds: [number, number][],
): Position[] {
  const lonByTime = new Map(longitudes)
  const speedByTime = new Map(speeds)
  const result: Position[] = []

  for (const [time, lat] of latitudes) {
    const lon = lonByTime.get(time)
    if (lon === undefined) continue
    result.push({ lat, lon, speed: speedByTime.get(time) ?? 0 })
  }

  return result
}

/** Scalează punctele la dimensiunea disponibilă, păstrând proporțiile. */
export function projectTrack(
  points: Position[],
  width: number,
  height: number,
  padding = 18,
): Projected[] {
  if (points.length === 0) return []

  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity

  for (const point of points) {
    minLat = Math.min(minLat, point.lat)
    maxLat = Math.max(maxLat, point.lat)
    minLon = Math.min(minLon, point.lon)
    maxLon = Math.max(maxLon, point.lon)
  }

  const centerLat = (minLat + maxLat) / 2
  const lonScale = Math.cos((centerLat * Math.PI) / 180)

  const spanLat = Math.max(maxLat - minLat, 1e-6)
  const spanLon = Math.max((maxLon - minLon) * lonScale, 1e-6)

  // Aceeași scară pe ambele axe: altfel un oval ar apărea ca un cerc.
  const scale = Math.min(
    (width - padding * 2) / spanLon,
    (height - padding * 2) / spanLat,
  )

  const offsetX = (width - spanLon * scale) / 2
  const offsetY = (height - spanLat * scale) / 2

  return points.map((point) => ({
    x: offsetX + (point.lon - minLon) * lonScale * scale,
    // Latitudinea crește spre nord, iar y-ul canvasului crește în jos.
    y: height - offsetY - (point.lat - minLat) * scale,
    speed: point.speed,
  }))
}

/** Câți metri reprezintă un pixel, pentru bara de scară. */
export function metersPerPixel(
  first: Position,
  last: Position,
  projected: Projected[],
): number {
  if (projected.length < 2) return Number.NaN

  const start = projected[0]
  const end = projected[projected.length - 1]
  const pixelDistance = Math.hypot(end.x - start.x, end.y - start.y)
  if (pixelDistance < 1) return Number.NaN

  const metersLat = (last.lat - first.lat) * METERS_PER_DEG_LAT
  const metersLon =
    (last.lon - first.lon) *
    METERS_PER_DEG_LAT *
    Math.cos((first.lat * Math.PI) / 180)

  return Math.hypot(metersLat, metersLon) / pixelDistance
}

/** Rotunjește lungimea barei de scară la o valoare citibilă. */
export function niceStep(value: number): number {
  const steps = [10, 25, 50, 100, 200, 500, 1000, 2000, 5000]
  return steps.find((step) => step >= value) ?? steps[steps.length - 1]
}

/** Interpolare de culoare pentru colorarea urmei după viteză. */
export function mixColor(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  ratio: number,
): string {
  const clamped = Math.max(0, Math.min(1, ratio))
  const channels = from.map((value, index) =>
    Math.round(value + (to[index] - value) * clamped),
  )
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`
}
