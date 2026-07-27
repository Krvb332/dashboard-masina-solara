import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TrackMap } from './TrackMap'
import { createSimulatorState, stepSimulator } from '../lib/simulator-source'
import { TRACK } from '../lib/track'
import { useTelemetryStore } from '../stores/telemetry-store'

/** Alimentează store-ul cu un tur complet generat de simulator. */
function driveOneLap(stepS = 1) {
  const state = createSimulatorState()
  const random = () => 0.5
  const store = useTelemetryStore.getState()

  // Eșantioanele se termină în prezent, ca să intre în fereastra hărții.
  const steps = Math.ceil(TRACK.length / (18 * stepS)) + 20
  const startAt = Date.now() - steps * stepS * 1_000

  for (let index = 0; index < steps; index += 1) {
    const now = startAt + index * stepS * 1_000
    const frame = stepSimulator(state, stepS, random, {
      vehicleId: 'tucn-solar-01',
      sessionId: 'test',
      now,
    })
    store.ingestFrame(frame, now)
    if (state.distanceM >= TRACK.length) break
  }

  store.commit()
  return state
}

/** Limitele traseului proiectate în metri, din definiția circuitului. */
function trackExtents() {
  const xs = TRACK.points.map((point) => point.x)
  const ys = TRACK.points.map((point) => point.y)
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
  }
}

function drawnExtents(path: string) {
  const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number)
  const xs: number[] = []
  const ys: number[] = []
  for (let index = 0; index < numbers.length; index += 2) {
    xs.push(numbers[index]!)
    ys.push(numbers[index + 1]!)
  }
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
    points: xs.length,
  }
}

describe('TrackMap', () => {
  beforeEach(() => {
    useTelemetryStore.getState().reset()
  })

  it('anunță explicit lipsa poziției GPS', () => {
    render(<TrackMap />)

    expect(screen.getByText('Fără poziție GPS')).toBeInTheDocument()
  })

  it('desenează întregul circuit după un tur complet', () => {
    const state = driveOneLap()
    expect(state.distanceM).toBeGreaterThanOrEqual(TRACK.length)

    const { container } = render(<TrackMap />)
    const path = container.querySelector('path')!.getAttribute('d')!
    const drawn = drawnExtents(path)
    const expected = trackExtents()

    // Traseul desenat trebuie să acopere circuitul, cu toleranță pentru
    // eșantionarea la un punct pe secundă.
    expect(drawn.width).toBeGreaterThan(expected.width * 0.9)
    expect(drawn.depth).toBeGreaterThan(expected.depth * 0.9)
    expect(drawn.width).toBeLessThan(expected.width * 1.1)
    expect(drawn.depth).toBeLessThan(expected.depth * 1.1)
  })

  it('păstrează proporțiile geografice în viewBox', () => {
    driveOneLap()

    const { container } = render(<TrackMap />)
    const svg = container.querySelector('svg')!
    const [, , width, depth] = svg
      .getAttribute('viewBox')!
      .split(' ')
      .map(Number)
    const expected = trackExtents()

    // viewBox este în metri reali, deci raportul lui trebuie să fie raportul
    // circuitului. `preserveAspectRatio` face restul la randare.
    expect(width! / depth!).toBeCloseTo(expected.width / expected.depth, 1)
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
  })

  it('subeșantionează traseul în loc să deseneze fiecare punct', () => {
    // Un tur la 10 Hz produce mult peste limita de puncte desenate.
    driveOneLap(0.1)

    const { container } = render(<TrackMap />)
    const path = container.querySelector('path')!.getAttribute('d')!

    expect(drawnExtents(path).points).toBeLessThanOrEqual(900)
  })
})
