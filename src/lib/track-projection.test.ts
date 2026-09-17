import { describe, expect, it } from 'vitest'
import {
  metersPerPixel,
  mixColor,
  niceStep,
  pairPositions,
  projectTrack,
  referenceFrame,
  type Position,
} from './track-projection'
import { trackReference } from './track-reference'

/** Bucla eliptică folosită de simulator, în jurul unui punct din Cluj-Napoca. */
function ovalTrack(count = 64): Position[] {
  const centerLat = 46.7712
  const centerLon = 23.6236
  const lonScale = Math.cos((centerLat * Math.PI) / 180)

  return Array.from({ length: count }, (_, index) => {
    const theta = (index / count) * 2 * Math.PI
    return {
      lat: centerLat + (140 * Math.sin(theta)) / 111_320,
      lon: centerLon + (250 * Math.cos(theta)) / (111_320 * lonScale),
      speed: 60 + 40 * Math.abs(Math.sin(theta)),
    }
  })
}

describe('pairPositions', () => {
  it('împerechează coordonatele după momentul de timp', () => {
    const result = pairPositions(
      [
        [1000, 46.77],
        [2000, 46.78],
      ],
      [
        [1000, 23.62],
        [2000, 23.63],
      ],
      [[1000, 55]],
    )

    expect(result).toEqual([
      { lat: 46.77, lon: 23.62, speed: 55 },
      // Fără viteză pentru al doilea moment, folosim 0 doar pentru culoare.
      { lat: 46.78, lon: 23.63, speed: 0 },
    ])
  })

  it('ignoră latitudinile fără longitudine corespunzătoare', () => {
    const result = pairPositions(
      [
        [1000, 46.77],
        [2000, 46.78],
      ],
      [[1000, 23.62]],
      [],
    )

    expect(result).toHaveLength(1)
  })
})

describe('projectTrack', () => {
  it('încadrează toate punctele în suprafața disponibilă', () => {
    const projected = projectTrack(ovalTrack(), 400, 300)

    for (const point of projected) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(400)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(300)
    }
  })

  it('păstrează proporțiile traseului', () => {
    // Traseul are 500 m pe axa lungă și 280 m pe cea scurtă: raportul ~1,79
    // trebuie regăsit în pixeli, altfel ovalul ar apărea ca un cerc.
    const projected = projectTrack(ovalTrack(), 400, 300)
    const xs = projected.map((point) => point.x)
    const ys = projected.map((point) => point.y)

    const ratio =
      (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))

    expect(ratio).toBeGreaterThan(1.6)
    expect(ratio).toBeLessThan(2.0)
  })

  it('desenează nordul în sus', () => {
    const projected = projectTrack(
      [
        { lat: 46.0, lon: 23.0, speed: 0 },
        { lat: 47.0, lon: 23.0, speed: 0 },
      ],
      400,
      300,
    )

    // Latitudine mai mare (nord) înseamnă y mai mic pe canvas.
    expect(projected[1].y).toBeLessThan(projected[0].y)
  })

  it('nu împarte la zero când mașina stă pe loc', () => {
    const projected = projectTrack(
      [
        { lat: 46.77, lon: 23.62, speed: 0 },
        { lat: 46.77, lon: 23.62, speed: 0 },
      ],
      400,
      300,
    )

    expect(projected.every((point) => Number.isFinite(point.x))).toBe(true)
    expect(projected.every((point) => Number.isFinite(point.y))).toBe(true)
  })

  it('întoarce o listă goală fără puncte', () => {
    expect(projectTrack([], 400, 300)).toEqual([])
  })
})

describe('metersPerPixel', () => {
  it('estimează scara din distanța reală și cea în pixeli', () => {
    const points: Position[] = [
      { lat: 46.7712, lon: 23.6236, speed: 0 },
      { lat: 46.7802, lon: 23.6236, speed: 0 }, // ~1 km spre nord
    ]
    const projected = projectTrack(points, 400, 300)

    const scale = metersPerPixel(points[0], points[1], projected)
    const pixelSpan = Math.abs(projected[1].y - projected[0].y)

    expect(scale * pixelSpan).toBeCloseTo(1002, -1)
  })

  it('nu raportează o scară pentru puncte suprapuse', () => {
    const point: Position = { lat: 46.77, lon: 23.62, speed: 0 }
    expect(
      Number.isNaN(
        metersPerPixel(point, point, projectTrack([point], 400, 300)),
      ),
    ).toBe(true)
  })
})

describe('niceStep', () => {
  it('rotunjește la valori citibile', () => {
    expect(niceStep(7)).toBe(10)
    expect(niceStep(38)).toBe(50)
    expect(niceStep(140)).toBe(200)
    expect(niceStep(999_999)).toBe(5000)
  })
})

describe('mixColor', () => {
  it('interpolează între cele două capete', () => {
    expect(mixColor([0, 0, 0], [255, 255, 255], 0)).toBe('rgb(0, 0, 0)')
    expect(mixColor([0, 0, 0], [255, 255, 255], 1)).toBe('rgb(255, 255, 255)')
    expect(mixColor([0, 0, 0], [255, 255, 255], 0.5)).toBe('rgb(128, 128, 128)')
  })

  it('limitează raportul la intervalul valid', () => {
    expect(mixColor([0, 0, 0], [255, 255, 255], -5)).toBe('rgb(0, 0, 0)')
    expect(mixColor([0, 0, 0], [255, 255, 255], 12)).toBe('rgb(255, 255, 255)')
  })
})

/**
 * Cadrul fix, legat de circuit.
 *
 * Proprietatea care contează nu este cum arată, ci că *nu se schimbă*. Harta
 * auto-scalată de dinainte era corectă la fiecare cadru și totuși inutilizabilă
 * pe o mașină oprită: fereastra se strângea pe dispersia receptorului, iar
 * câțiva metri de zgomot umpleau pânza.
 */
describe('referenceFrame', () => {
  it('nu depinde de datele primite', () => {
    // Același cadru, calculat de două ori, la orice moment: aceiași pixeli.
    const first = referenceFrame(trackReference, 800, 400)
    const second = referenceFrame(trackReference, 800, 400)

    for (const node of trackReference.nodes.slice(0, 30)) {
      const a = first.project(node[0], node[1])
      const b = second.project(node[0], node[1])
      expect(a.x).toBe(b.x)
      expect(a.y).toBe(b.y)
    }
    expect(first.metersPerPixel).toBe(second.metersPerPixel)
  })

  it('păstrează scara constantă pe toată suprafața', () => {
    const frame = referenceFrame(trackReference, 800, 400)

    // Un metru înseamnă același număr de pixeli oriunde pe hartă și în orice
    // direcție; altfel circuitul ar apărea turtit.
    const ratios: number[] = []
    for (let index = 0; index < trackReference.segments.length; index += 3) {
      const segment = trackReference.segments[index]
      // Segmentele foarte scurte au coordonatele rotunjite la ~1 cm, deci
      // raportul lor ar măsura rotunjirea tabelului, nu scara cadrului.
      if (segment.lengthM < 10) continue

      const from = trackReference.nodes[segment.index]
      const to =
        trackReference.nodes[(segment.index + 1) % trackReference.nodes.length]
      const a = frame.project(from[0], from[1])
      const b = frame.project(to[0], to[1])

      ratios.push(Math.hypot(b.x - a.x, b.y - a.y) / segment.lengthM)
    }

    expect(ratios.length).toBeGreaterThan(10)
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThan(1.001)
    // Și scara raportată este chiar aceea.
    expect(1 / frame.metersPerPixel).toBeCloseTo(ratios[0], 4)
  })

  it('încadrează tot circuitul în suprafața disponibilă', () => {
    const width = 640
    const height = 360
    const padding = 18
    const frame = referenceFrame(trackReference, width, height, padding)

    for (const node of trackReference.nodes) {
      const point = frame.project(node[0], node[1])
      expect(point.x).toBeGreaterThanOrEqual(padding - 0.5)
      expect(point.x).toBeLessThanOrEqual(width - padding + 0.5)
      expect(point.y).toBeGreaterThanOrEqual(padding - 0.5)
      expect(point.y).toBeLessThanOrEqual(height - padding + 0.5)
    }
  })

  it('desenează nordul în sus', () => {
    const frame = referenceFrame(trackReference, 800, 400)
    const south = frame.project(trackReference.bounds.minLat, trackReference.origin.lon)
    const north = frame.project(trackReference.bounds.maxLat, trackReference.origin.lon)

    expect(north.y).toBeLessThan(south.y)
  })

  it('nu se strânge pe zgomot când mașina stă pe loc', () => {
    // Controlul care arată de ce cadrul fix nu este doar o preferință: pe
    // aceleași fixuri, proiecția auto-scalată dă o scară de ordinul metrilor
    // pe pixel mai mică cu câteva ordine de mărime.
    const spot = trackReference.nodes[0]
    const jitter: Position[] = Array.from({ length: 50 }, (_, index) => ({
      lat: spot[0] + (index % 5) * 0.00002,
      lon: spot[1] + (index % 7) * 0.00002,
      speed: 0,
    }))

    const autoScaled = projectTrack(jitter, 800, 400)
    const autoSpanPx = Math.max(...autoScaled.map((point) => point.x)) -
      Math.min(...autoScaled.map((point) => point.x))

    const frame = referenceFrame(trackReference, 800, 400)
    const fixed = jitter.map((point) => frame.project(point.lat, point.lon))
    const fixedSpanPx = Math.max(...fixed.map((point) => point.x)) -
      Math.min(...fixed.map((point) => point.x))

    // În cadrul circuitului, cei câțiva metri de zgomot rămân câțiva pixeli.
    expect(fixedSpanPx).toBeLessThan(10)
    // Auto-scalat, aceiași metri se întind peste o bună parte din pânză —
    // raportul dintre cele două este ce vede operatorul ca „harta a sărit".
    expect(autoSpanPx / fixedSpanPx).toBeGreaterThan(20)
  })
})
