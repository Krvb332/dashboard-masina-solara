import { describe, expect, it } from 'vitest'
import {
  MAX_ACCEL,
  MAX_BRAKE,
  MAX_SPEED_MPS,
  MIN_SPEED_MPS,
  positionAt,
  targetSpeedAt,
  toLatLon,
  TRACK,
} from './track'

describe('geometria circuitului', () => {
  it('are o lungime plauzibilă pentru un circuit de test', () => {
    expect(TRACK.length).toBeGreaterThan(1_500)
    expect(TRACK.length).toBeLessThan(5_000)
  })

  it('eșantionează traseul la pas constant', () => {
    for (let index = 1; index < TRACK.points.length; index += 1) {
      const previous = TRACK.points[index - 1]!
      const current = TRACK.points[index]!
      const step = Math.hypot(current.x - previous.x, current.y - previous.y)
      expect(step).toBeCloseTo(TRACK.spacing, 1)
    }
  })

  it('se închide în buclă', () => {
    const first = TRACK.points[0]!
    const last = TRACK.points.at(-1)!
    const gap = Math.hypot(last.x - first.x, last.y - first.y)

    // Distanța dintre ultimul și primul punct este tot un pas de eșantionare.
    expect(gap).toBeLessThan(TRACK.spacing * 1.5)
  })

  it('nu se autointersectează', () => {
    // Un circuit care se taie singur ar avea nevoie de un pod. Verificăm toate
    // perechile de segmente neadiacente.
    const points = TRACK.points
    const count = points.length

    const intersects = (
      a: (typeof points)[number],
      b: (typeof points)[number],
      c: (typeof points)[number],
      d: (typeof points)[number],
    ) => {
      const orientation = (
        p: (typeof points)[number],
        q: (typeof points)[number],
        r: (typeof points)[number],
      ) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))

      return (
        orientation(a, b, c) !== orientation(a, b, d) &&
        orientation(c, d, a) !== orientation(c, d, b)
      )
    }

    const crossings: string[] = []
    for (let i = 0; i < count; i += 1) {
      const a = points[i]!
      const b = points[(i + 1) % count]!

      for (let j = i + 2; j < count; j += 1) {
        // Segmentele vecine se ating la capete; le sărim.
        if (i === 0 && j === count - 1) continue
        const c = points[j]!
        const d = points[(j + 1) % count]!

        if (intersects(a, b, c, d)) {
          crossings.push(
            `segmentul ${i} taie segmentul ${j} lângă (${a.x.toFixed(0)}, ${a.y.toFixed(0)})`,
          )
        }
      }
    }

    expect(crossings).toEqual([])
  })

  it('conține atât drepte, cât și viraje strânse', () => {
    const curvatures = TRACK.curvatures
    const minRadius = 1 / Math.max(...curvatures)
    const maxRadius = 1 / Math.min(...curvatures.filter((k) => k > 1e-6))

    // Acul de păr este strâns, dar nu imposibil.
    expect(minRadius).toBeGreaterThan(10)
    expect(minRadius).toBeLessThan(60)
    // Există și porțiuni aproape drepte.
    expect(maxRadius).toBeGreaterThan(400)
  })
})

describe('profilul de viteză', () => {
  it('rămâne între limitele configurate', () => {
    for (const speed of TRACK.speeds) {
      expect(speed).toBeGreaterThanOrEqual(MIN_SPEED_MPS - 1e-6)
      expect(speed).toBeLessThanOrEqual(MAX_SPEED_MPS + 1e-6)
    }
  })

  it('respectă limitele de accelerație și frânare între eșantioane', () => {
    const count = TRACK.speeds.length
    const ds = TRACK.spacing

    for (let index = 0; index < count; index += 1) {
      const current = TRACK.speeds[index]!
      const next = TRACK.speeds[(index + 1) % count]!

      // Accelerare: viteza nu poate crește mai repede decât permite motorul.
      expect(next * next).toBeLessThanOrEqual(
        current * current + 2 * MAX_ACCEL * ds + 1e-6,
      )
      // Frânare: viteza nu poate scădea mai brusc decât permit frânele.
      expect(current * current).toBeLessThanOrEqual(
        next * next + 2 * MAX_BRAKE * ds + 1e-6,
      )
    }
  })

  it('încetinește în cel mai strâns viraj', () => {
    let tightest = 0
    for (let index = 1; index < TRACK.curvatures.length; index += 1) {
      if (TRACK.curvatures[index]! > TRACK.curvatures[tightest]!) {
        tightest = index
      }
    }

    const speedInCorner = TRACK.speeds[tightest]!
    const fastest = Math.max(...TRACK.speeds)

    expect(speedInCorner).toBeLessThan(fastest * 0.6)
  })
})

describe('eșantionarea pe distanță', () => {
  it('revine în același punct după un tur complet', () => {
    const start = positionAt(0)
    const afterLap = positionAt(TRACK.length)

    expect(afterLap.x).toBeCloseTo(start.x, 6)
    expect(afterLap.y).toBeCloseTo(start.y, 6)
  })

  it('interpolează între eșantioane, nu sare de la unul la altul', () => {
    const a = positionAt(0)
    const b = positionAt(TRACK.spacing / 2)
    const c = positionAt(TRACK.spacing)

    const firstHalf = Math.hypot(b.x - a.x, b.y - a.y)
    const secondHalf = Math.hypot(c.x - b.x, c.y - b.y)

    // Punctul intermediar cade exact la mijlocul segmentului.
    expect(firstHalf).toBeCloseTo(secondHalf, 6)

    // Interpolarea liniară dă coarda, care este puțin mai scurtă decât arcul de
    // `spacing` metri — cu atât mai scurtă cu cât porțiunea este mai curbată.
    expect(firstHalf).toBeLessThanOrEqual(TRACK.spacing / 2)
    expect(firstHalf).toBeGreaterThan(TRACK.spacing / 2 - 0.01)
  })

  it('acceptă distanțe cumulate peste mai multe tururi', () => {
    const start = positionAt(0)
    const afterFiveLaps = positionAt(TRACK.length * 5)

    expect(afterFiveLaps.x).toBeCloseTo(start.x, 6)
    expect(targetSpeedAt(TRACK.length * 5)).toBeCloseTo(targetSpeedAt(0), 6)
  })
})

describe('toLatLon', () => {
  const center = { lat: 46.7712, lon: 23.6236 }

  it('păstrează centrul neschimbat', () => {
    const result = toLatLon({ x: 0, y: 0 }, center)

    expect(result.lat).toBeCloseTo(center.lat, 9)
    expect(result.lon).toBeCloseTo(center.lon, 9)
  })

  it('deplasează spre nord pentru y pozitiv', () => {
    expect(toLatLon({ x: 0, y: 1_113.2 }, center).lat).toBeCloseTo(
      center.lat + 0.01,
      6,
    )
  })

  it('ține cont de scurtarea longitudinii cu latitudinea', () => {
    // La 46,77° un grad de longitudine are aproximativ 76 km.
    const east = toLatLon({ x: 1_000, y: 0 }, center)
    const degrees = east.lon - center.lon

    expect(degrees).toBeGreaterThan(1_000 / 111_320)
    expect(degrees).toBeCloseTo(1_000 / (111_320 * Math.cos((46.7712 * Math.PI) / 180)), 9)
  })
})
