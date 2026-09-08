import { describe, expect, it } from 'vitest'
import {
  metersPerPixel,
  mixColor,
  niceStep,
  pairPositions,
  projectTrack,
  type Position,
} from './track-projection'

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
