import { describe, expect, it } from 'vitest'
import {
  deltaS,
  degreeScales,
  pointAt,
  referenceElevationProfile,
  segmentAt,
  toGeo,
  toLocal,
  trackReference,
  wrapS,
} from './track-reference'
import { ZOLDER_NODES } from './track-zolder'

/**
 * Referința nu este cod care se poate strica singur: este un tabel de date.
 * Ce se poate strica este *încrederea* în el — un nod mutat la o editare
 * manuală, o rotație aplicată greșit, o altitudine pierdută. Testele de aici
 * măsoară proprietăți pe care numai circuitul real le are, nu proprietăți pe
 * care orice buclă închisă le-ar avea.
 */

const EARTH_RADIUS_M = 6_371_008.8

/** Distanța pe cerc mare — verificare independentă de cadrul local. */
function haversineMeters(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const phi1 = toRad(a[0])
  const phi2 = toRad(b[0])
  const deltaPhi = toRad(b[0] - a[0])
  const deltaLambda = toRad(b[1] - a[1])
  const h =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Distanța geodezică pe elipsoidul WGS84 (Vincenty, problema inversă).
 *
 * Formula de mai sus, pe sferă, nu poate arbitra corectitudinea cadrului local:
 * o sferă are aceeași rază în toate direcțiile, iar Pământul nu — la 51° nord
 * raza pe meridian și cea pe verticala principală diferă cu ~0,2 %. Comparat cu
 * sfera, orice cadru corect *pare* să deformeze, pentru că sfera este cea care
 * deformează. Vincenty lucrează pe același elipsoid pe care raportează
 * receptorul GNSS, deci este singura referință față de care are sens măsurată
 * o eroare de sub o miime.
 */
function vincentyMeters(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const semiMajor = 6_378_137
  const flattening = 1 / 298.257223563
  const semiMinor = semiMajor * (1 - flattening)

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const L = toRad(b[1] - a[1])
  const U1 = Math.atan((1 - flattening) * Math.tan(toRad(a[0])))
  const U2 = Math.atan((1 - flattening) * Math.tan(toRad(b[0])))
  const sinU1 = Math.sin(U1)
  const cosU1 = Math.cos(U1)
  const sinU2 = Math.sin(U2)
  const cosU2 = Math.cos(U2)

  let lambda = L
  let sinSigma = 0
  let cosSigma = 1
  let sigma = 0
  let cos2SigmaM = 1
  let cosSqAlpha = 1

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const sinLambda = Math.sin(lambda)
    const cosLambda = Math.cos(lambda)
    sinSigma = Math.hypot(
      cosU2 * sinLambda,
      cosU1 * sinU2 - sinU1 * cosU2 * cosLambda,
    )
    if (sinSigma === 0) return 0

    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda
    sigma = Math.atan2(sinSigma, cosSigma)
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma
    cosSqAlpha = 1 - sinAlpha * sinAlpha
    cos2SigmaM =
      cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha

    const C =
      (flattening / 16) *
      cosSqAlpha *
      (4 + flattening * (4 - 3 * cosSqAlpha))
    const previous = lambda
    lambda =
      L +
      (1 - C) *
        flattening *
        sinAlpha *
        (sigma +
          C *
            sinSigma *
            (cos2SigmaM +
              C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))

    if (Math.abs(lambda - previous) < 1e-12) break
  }

  const uSq =
    (cosSqAlpha * (semiMajor * semiMajor - semiMinor * semiMinor)) /
    (semiMinor * semiMinor)
  const A =
    1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)))

  return semiMinor * A * (sigma - deltaSigma)
}

describe('geometria circuitului', () => {
  it('este o buclă închisă, fără noduri duplicate la capete', () => {
    const first = ZOLDER_NODES[0]
    const last = ZOLDER_NODES[ZOLDER_NODES.length - 1]

    // Nodul de start nu se repetă la final: repetat, ar produce un segment de
    // lungime zero, iar raportul poziției pe el ar fi o împărțire la zero.
    expect(haversineMeters([first[0], first[1]], [last[0], last[1]])).
      toBeGreaterThan(1)

    // Ultimul segment se închide totuși pe primul nod, prin construcție.
    const segments = trackReference.segments
    expect(segments).toHaveLength(ZOLDER_NODES.length)
    const closing = segments[segments.length - 1]
    expect(closing.x0 + closing.dx).toBeCloseTo(segments[0].x0, 6)
    expect(closing.y0 + closing.dy).toBeCloseTo(segments[0].y0, 6)
  })

  it('are lungimea circuitului real, măsurată din noduri', () => {
    // Nu se compară cu o valoare scrisă în modul: lungimea se recompune aici
    // din coordonate, cu o formulă diferită de cea folosită la construcție.
    let measured = 0
    for (let index = 0; index < ZOLDER_NODES.length; index += 1) {
      const from = ZOLDER_NODES[index]
      const to = ZOLDER_NODES[(index + 1) % ZOLDER_NODES.length]
      measured += haversineMeters([from[0], from[1]], [to[0], to[1]])
    }

    const official = trackReference.officialLengthM
    expect(Math.abs(measured - official) / official).toBeLessThan(0.01)
    expect(
      Math.abs(trackReference.lengthM - official) / official,
    ).toBeLessThan(0.01)
  })

  it('este chiar Zolder, nu o buclă oarecare de aceeași lungime', () => {
    // Circuitul se află în Belgia, la Heusden-Zolder. O geometrie corectă ca
    // formă dar plasată altundeva ar trece toate testele metrice de mai sus.
    expect(trackReference.bounds.minLat).toBeGreaterThan(50.98)
    expect(trackReference.bounds.maxLat).toBeLessThan(51.0)
    expect(trackReference.bounds.minLon).toBeGreaterThan(5.24)
    expect(trackReference.bounds.maxLon).toBeLessThan(5.27)
  })

  it('numerotează virajele oficial, în ordinea de parcurs', () => {
    const refs = trackReference.sectors
      .map((sector) => sector.ref)
      .filter((ref): ref is string => ref !== null)

    // T1..T16 o singură dată fiecare. Un sector sărit sau repetat ar însemna
    // că rotația la linia de start a tăiat geometria în locul greșit.
    const numbers = refs.map((ref) => Number(ref.slice(1)))
    expect(numbers).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ])
  })

  it('începe la linia de start, pe linia dreaptă principală', () => {
    expect(pointAt(trackReference, 0).sector.name).toBe(
      'Linia dreaptă principală',
    )
    // Coordonatele publicate ale circuitului sunt 50,98972 N / 5,25667 E.
    // Originea trebuie să fie în imediata lor vecinătate, altfel numărătoarea
    // de tururi s-ar închide în alt punct decât cronometrarea de pe circuit.
    const start = pointAt(trackReference, 0)
    expect(haversineMeters([start.lat, start.lon], [50.98972, 5.25667]))
      .toBeLessThan(60)
  })
})

describe('altitudinea de referință', () => {
  it('există pentru fiecare nod', () => {
    const missing = ZOLDER_NODES.filter(
      (node) => !Number.isFinite(node[2]),
    )
    expect(missing).toHaveLength(0)
  })

  it('descrie un teren, nu o suprafață plană sau un artefact', () => {
    const elevations = ZOLDER_NODES.map((node) => node[2])
    const relief = Math.max(...elevations) - Math.min(...elevations)

    // Zolder este un circuit cu denivelare; o referință plată ar însemna că
    // altitudinea s-a pierdut pe drum, iar corecția de pantă ar fi mută.
    expect(relief).toBeGreaterThan(10)
    // Dar nici un munte: peste câteva zeci de metri ar fi un artefact al
    // modelului de teren, citit pe un pod sau pe o clădire.
    expect(relief).toBeLessThan(60)
  })

  it('nu are salturi de altitudine imposibile între noduri vecini', () => {
    let steepest = 0
    for (const segment of trackReference.segments) {
      if (segment.lengthM < 5) continue
      const grade = Math.abs(
        (segment.elevation1 - segment.elevation0) / segment.lengthM,
      )
      steepest = Math.max(steepest, grade)
    }
    // Un circuit de curse nu are pante peste ~15 %; mai mult ar fi zgomot.
    expect(steepest).toBeLessThan(0.15)
  })

  it('închide profilul de elevație pe toată lungimea', () => {
    const profile = referenceElevationProfile(trackReference)
    expect(profile[0][0]).toBe(0)
    expect(profile[profile.length - 1][0]).toBeCloseTo(
      trackReference.lengthM,
      6,
    )
    // Bucla e închisă, deci ultimul punct are altitudinea primului.
    expect(profile[profile.length - 1][1]).toBe(profile[0][1])
  })
})

describe('cadrul metric local', () => {
  it('duce coordonatele în metri și înapoi fără pierdere', () => {
    for (const node of ZOLDER_NODES.slice(0, 20)) {
      const local = toLocal(trackReference, node[0], node[1])
      const back = toGeo(trackReference, local.x, local.y)
      expect(back.lat).toBeCloseTo(node[0], 9)
      expect(back.lon).toBeCloseTo(node[1], 9)
    }
  })

  it('păstrează distanțele geodezice, în orice direcție și oriunde', () => {
    // Referința este elipsoidul WGS84, nu sfera: vezi `vincentyMeters`. Se
    // urmăresc două lucruri deodată — că scara este corectă (raportul aproape
    // de 1) și că este *aceeași* în toate direcțiile (dispersia raportului
    // aproape de zero). A doua condiție este cea care contează pentru formă:
    // un cadru cu scară greșită doar pe o axă ar desena circuitul turtit, iar
    // proiecția fixurilor ar aluneca spre axa comprimată.
    const ratios: number[] = []

    for (let index = 0; index < ZOLDER_NODES.length; index += 3) {
      for (const span of [5, 20, 40, 80]) {
        const from = ZOLDER_NODES[index]
        const to = ZOLDER_NODES[(index + span) % ZOLDER_NODES.length]

        const a = toLocal(trackReference, from[0], from[1])
        const b = toLocal(trackReference, to[0], to[1])
        const planar = Math.hypot(b.x - a.x, b.y - a.y)
        const geodesic = vincentyMeters([from[0], from[1]], [to[0], to[1]])

        // Sub o sută de metri, rotunjirea coordonatelor la a șaptea zecimală
        // (~1 cm) ar domina raportul și ar măsura precizia tabelului, nu a
        // cadrului.
        if (geodesic < 100) continue
        ratios.push(planar / geodesic)
      }
    }

    expect(ratios.length).toBeGreaterThan(100)

    for (const ratio of ratios) {
      expect(Math.abs(ratio - 1)).toBeLessThan(0.0005)
    }
    expect(Math.max(...ratios) / Math.min(...ratios) - 1).toBeLessThan(0.0005)
  })

  it('controlul: o sferă de rază medie chiar deformează, deci testul de mai sus nu este vacuu', () => {
    // Dacă orice model ar trece pragul de mai sus, testul n-ar demonstra
    // nimic. Aceleași coarde, măsurate pe sferă în loc de elipsoid, ies în
    // afara pragului — și ies *anizotrop*, mai prost pe est-vest decât pe
    // nord-sud, exact defectul pe care pragul îl caută.
    const ratios: number[] = []

    for (let index = 0; index < ZOLDER_NODES.length; index += 3) {
      for (const span of [5, 20, 40, 80]) {
        const from = ZOLDER_NODES[index]
        const to = ZOLDER_NODES[(index + span) % ZOLDER_NODES.length]
        const geodesic = vincentyMeters([from[0], from[1]], [to[0], to[1]])
        if (geodesic < 100) continue
        ratios.push(
          haversineMeters([from[0], from[1]], [to[0], to[1]]) / geodesic,
        )
      }
    }

    expect(Math.max(...ratios) / Math.min(...ratios) - 1).toBeGreaterThan(
      0.0005,
    )
  })

  it('folosește scări de grad potrivite latitudinii, nu constanta rotundă', () => {
    const scales = degreeScales(trackReference.origin.lat)
    // La 51° nordul un grad de latitudine are ~111 250 m, nu 111 320.
    expect(scales.metersPerDegLat).toBeGreaterThan(111_200)
    expect(scales.metersPerDegLat).toBeLessThan(111_300)
    // Iar unul de longitudine ~70 200 m, nu 111 320·cos(φ) = 70 055 m.
    expect(scales.metersPerDegLon).toBeGreaterThan(70_100)
    expect(scales.metersPerDegLon).toBeLessThan(70_300)
  })
})

describe('poziția pe traseu', () => {
  it('readuce orice distanță în lungimea circuitului', () => {
    expect(wrapS(trackReference, -10)).toBeCloseTo(
      trackReference.lengthM - 10,
      6,
    )
    expect(wrapS(trackReference, trackReference.lengthM + 25)).toBeCloseTo(
      25,
      6,
    )
  })

  it('măsoară diferențele pe drumul cel mai scurt, peste linia de start', () => {
    const length = trackReference.lengthM
    // Cu douăzeci de metri înainte de linie, la zece metri după ea: treizeci
    // de metri înainte, nu aproape un circuit înapoi.
    expect(deltaS(trackReference, length - 20, 10)).toBeCloseTo(30, 6)
    expect(deltaS(trackReference, 10, length - 20)).toBeCloseTo(-30, 6)
  })

  it('găsește segmentul care conține distanța dată', () => {
    for (const segment of trackReference.segments) {
      const middle = segment.startS + segment.lengthM / 2
      expect(segmentAt(trackReference, middle).index).toBe(segment.index)
    }
  })

  it('avansează pe traseu odată cu distanța', () => {
    // Punctele succesive trebuie să fie la distanța cerută unul de altul,
    // altfel poziția desenată ar înainta cu altă viteză decât cea raportată.
    for (let s = 0; s < trackReference.lengthM - 50; s += 137) {
      const a = pointAt(trackReference, s)
      const b = pointAt(trackReference, s + 25)
      const step = haversineMeters([a.lat, a.lon], [b.lat, b.lon])
      // Pe un segment drept sunt exact 25 m; peste un nod, coarda este puțin
      // mai scurtă decât arcul.
      expect(step).toBeGreaterThan(20)
      expect(step).toBeLessThan(25.5)
    }
  })

  it('dă o direcție și o pantă plauzibile în orice punct', () => {
    for (let s = 0; s < trackReference.lengthM; s += 97) {
      const point = pointAt(trackReference, s)
      expect(point.headingDeg).toBeGreaterThanOrEqual(0)
      expect(point.headingDeg).toBeLessThan(360)
      expect(Math.abs(point.gradeFraction)).toBeLessThan(0.15)
      expect(point.elevationM).toBeGreaterThan(20)
      expect(point.elevationM).toBeLessThan(60)
    }
  })
})
