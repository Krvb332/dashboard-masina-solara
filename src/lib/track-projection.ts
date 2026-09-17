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

export type Position = {
  lat: number
  lon: number
  speed: number
  /** Altitudine în metri, dacă receptorul o raportează. */
  elevation?: number
}
export type Projected = {
  x: number
  y: number
  speed: number
  elevation?: number
}

export const METERS_PER_DEG_LAT = 111_320

/**
 * Cea mai mică fereastră, în metri, pe care harta o desenează.
 *
 * Fără un prag, proiecția se scalează la dreptunghiul care încadrează punctele,
 * oricât de mic ar fi el. O mașină oprită încadrează exact zgomotul
 * receptorului, iar câțiva metri de dispersie ajung să umple toată pânza: se
 * vede o urmă agitată, cu bara de scară la 10 m, pe un vehicul care nu s-a
 * mișcat deloc. Zoomul era corect matematic și complet fals ca informație.
 *
 * Douăzeci de metri este puțin peste dispersia unui receptor obișnuit, deci un
 * vehicul oprit rămâne un punct în mijlocul unei ferestre stabile, iar prima
 * deplasare reală se citește ca deplasare, nu ca schimbare de scară.
 */
export const MIN_SPAN_M = 20

/**
 * Împerechează seriile de latitudine, longitudine și viteză după momentul de
 * timp. Fiecare semnal are propriile eșantioane, iar o poziție fără ambele
 * coordonate nu poate fi desenată.
 */
export function pairPositions(
  latitudes: [number, number][],
  longitudes: [number, number][],
  speeds: [number, number][],
  elevations: [number, number][] = [],
): Position[] {
  const lonByTime = new Map(longitudes)
  const speedByTime = new Map(speeds)
  const elevationByTime = new Map(elevations)
  const result: Position[] = []

  for (const [time, lat] of latitudes) {
    const lon = lonByTime.get(time)
    if (lon === undefined) continue

    // O poziție fără altitudine rămâne fără altitudine. Nu punem `0`: harta
    // colorată după elevație ar desena un traseu la nivelul mării.
    const elevation = elevationByTime.get(time)
    result.push({
      lat,
      lon,
      speed: speedByTime.get(time) ?? 0,
      ...(elevation === undefined ? {} : { elevation }),
    })
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

  // Pragul se aplică în grade, ca să însemne același lucru pe ambele axe: un
  // grad de longitudine este mai scurt decât unul de latitudine, iar `lonScale`
  // a adus deja longitudinea la aceeași unitate.
  const minSpanDeg = MIN_SPAN_M / METERS_PER_DEG_LAT
  const dataSpanLat = maxLat - minLat
  const dataSpanLon = (maxLon - minLon) * lonScale
  const spanLat = Math.max(dataSpanLat, minSpanDeg)
  const spanLon = Math.max(dataSpanLon, minSpanDeg)

  // Când pragul este cel care decide fereastra, datele ocupă mai puțin decât
  // ea. Jumătatea de diferență le împinge în mijloc; fără ea, un vehicul oprit
  // ar apărea lipit de colțul din stânga-jos, unde pică minimul seriei.
  const insetLat = (spanLat - dataSpanLat) / 2
  const insetLon = (spanLon - dataSpanLon) / 2

  // Aceeași scară pe ambele axe: altfel un oval ar apărea ca un cerc.
  const scale = Math.min(
    (width - padding * 2) / spanLon,
    (height - padding * 2) / spanLat,
  )

  const offsetX = (width - spanLon * scale) / 2
  const offsetY = (height - spanLat * scale) / 2

  return points.map((point) => ({
    x: offsetX + (insetLon + (point.lon - minLon) * lonScale) * scale,
    // Latitudinea crește spre nord, iar y-ul canvasului crește în jos.
    y: height - offsetY - (insetLat + (point.lat - minLat)) * scale,
    speed: point.speed,
    ...(point.elevation === undefined ? {} : { elevation: point.elevation }),
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

/**
 * Cadrul fix al hărții, legat de circuit în loc de datele primite.
 *
 * `projectTrack` scalează după dreptunghiul care încadrează punctele. Este
 * potrivit când nu se știe pe ce traseu se rulează — dar când se știe, este
 * activ dăunător: fereastra se schimbă la fiecare cadru, pe măsură ce sosesc
 * puncte noi. Urma pare să se miște când de fapt se redesenează la altă scară,
 * iar bara de scară sare între valori. Pe o mașină oprită, fereastra ajunge să
 * încadreze exact dispersia receptorului, iar câțiva metri de zgomot umplu toată
 * pânza — vezi `MIN_SPAN_M`, pragul pus tocmai ca să limiteze dauna.
 *
 * Cu circuitul cunoscut, fereastra se calculează o singură dată, din geometria
 * lui. Nimic din ce sosește nu o mai poate schimba: același loc de pe asfalt
 * cade mereu în același pixel, de la un cadru la altul și de la o sesiune la
 * alta. Pragul minim de întindere nu mai are ce apăra și nu se mai aplică.
 */
export type MapFrame = {
  width: number
  height: number
  /** Câți metri reprezintă un pixel. Constant, prin construcție. */
  metersPerPixel: number
  project: (lat: number, lon: number) => { x: number; y: number }
}

export function referenceFrame(
  reference: {
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }
    origin: { lat: number; lon: number }
    metersPerDegLat: number
    metersPerDegLon: number
  },
  width: number,
  height: number,
  padding = 18,
): MapFrame {
  const { bounds } = reference

  const toLocalX = (lon: number) =>
    (lon - reference.origin.lon) * reference.metersPerDegLon
  const toLocalY = (lat: number) =>
    (lat - reference.origin.lat) * reference.metersPerDegLat

  const minX = toLocalX(bounds.minLon)
  const maxX = toLocalX(bounds.maxLon)
  const minY = toLocalY(bounds.minLat)
  const maxY = toLocalY(bounds.maxLat)

  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)

  // Aceeași scară pe ambele axe, altfel circuitul ar apărea turtit.
  const scale = Math.min(
    (width - padding * 2) / spanX,
    (height - padding * 2) / spanY,
  )

  // Centrat pe suprafața disponibilă, cu tot cu marginea rămasă pe axa care
  // nu a dictat scara.
  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2

  return {
    width,
    height,
    metersPerPixel: scale > 0 ? 1 / scale : Number.NaN,
    project: (lat: number, lon: number) => ({
      x: offsetX + (toLocalX(lon) - minX) * scale,
      // Latitudinea crește spre nord, iar y-ul canvasului crește în jos.
      y: height - offsetY - (toLocalY(lat) - minY) * scale,
    }),
  }
}
