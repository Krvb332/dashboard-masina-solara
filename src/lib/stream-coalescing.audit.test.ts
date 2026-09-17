import { describe, expect, it } from 'vitest'
import { makeRandom } from '../test/synthetic'

/**
 * Audit D8: câte eșantioane ajung în grafic prin cadrele WebSocket.
 *
 * Serverul trimite la 10 Hz doar ultima stare (`latest`), iar browserul
 * adaugă în grafic un punct nou doar când `server_received_at` diferă de
 * ultimul adăugat (`useTelemetryStream`). Modelul de mai jos reproduce exact
 * această regulă pe timpi de sosire cu jitter, ca la o legătură radio reală.
 */

function deliveredFraction(
  vehicleHz: number,
  jitterMs: number,
  seed: number,
): number {
  const random = makeRandom(seed)
  const durationMs = 10 * 60_000
  const arrivals: number[] = []
  for (let t = 0; t < durationMs; t += 1000 / vehicleHz) {
    arrivals.push(t + (random() * 2 - 1) * jitterMs)
  }
  arrivals.sort((a, b) => a - b)

  let pushed = 0
  let lastPushed: number | null = null
  let cursor = 0
  for (let tick = 0; tick < durationMs; tick += 100) {
    // `bus.latest` la momentul tick-ului: ultimul eșantion sosit.
    while (cursor < arrivals.length && arrivals[cursor] <= tick) cursor += 1
    const latest = cursor === 0 ? null : arrivals[cursor - 1]
    if (latest !== null && latest !== lastPushed) {
      pushed += 1
      lastPushed = latest
    }
  }
  return pushed / arrivals.length
}

describe('coalescing la 10 Hz (D8)', () => {
  it('control: mașină la 5 Hz, fiecare eșantion ajunge în grafic', () => {
    expect(deliveredFraction(5, 20, 1)).toBeGreaterThan(0.99)
  })

  it.fails(
    'D8 (defect confirmat): mașină la 10 Hz cu jitter de 30 ms, sub 5 % din eșantioane lipsesc din grafic',
    () => {
      expect(deliveredFraction(10, 30, 2)).toBeGreaterThan(0.95)
    },
  )

  it('măsurătoare: fracțiunea de eșantioane care ajung în grafic', () => {
    const at10 = deliveredFraction(10, 30, 2)
    const at10Clean = deliveredFraction(10, 0, 3)
    const at20 = deliveredFraction(20, 10, 4)
    console.info(
      `[audit D8] în grafic ajung: ${(at10Clean * 100).toFixed(0)} % la 10 Hz fără jitter, ${(at10 * 100).toFixed(0)} % la 10 Hz cu ±30 ms jitter, ${(at20 * 100).toFixed(0)} % la 20 Hz`,
    )
    expect(at20).toBeLessThan(0.6)
  })
})
