import { bench, describe } from 'vitest'
import { TelemetryAnalytics } from './analytics'
import { pushDerived } from './derived-buffer'
import { makeSample, qualityFor } from '../test/synthetic'

/**
 * Audit: costul acumulatorului de statistici pe o cursă lungă.
 *
 * `update()` rulează la 5 Hz, `snapshot()` la 2 Hz. O cursă de opt ore
 * înseamnă 144 000 de actualizări și 57 600 de snapshot-uri.
 */

const HOURS = 8
const TICK_MS = 200
const TICKS = (HOURS * 3600 * 1000) / TICK_MS

// Calitatea unui eșantion complet (104 semnale), reutilizată cu timpul schimbat.
const qualityFrames = Array.from({ length: 50 }, (_, index) =>
  qualityFor(makeSample(index * 2)),
)

describe('acumulatorul de statistici', () => {
  bench(
    `update() × ${TICKS} (${HOURS} h la 5 Hz, 104 semnale)`,
    () => {
      const analytics = new TelemetryAnalytics()
      for (let index = 0; index < TICKS; index += 1) {
        analytics.update({
          timeMs: index * TICK_MS,
          quality: qualityFrames[index % 50],
        })
      }
    },
    { iterations: 2, time: 0, warmupIterations: 1 },
  )

  const warm = new TelemetryAnalytics()
  for (let index = 0; index < 3000; index += 1) {
    warm.update({ timeMs: index * TICK_MS, quality: qualityFrames[index % 50] })
  }

  bench('snapshot() cu ferestrele pline (600 eșantioane)', () => {
    warm.snapshot()
  })

  bench('snapshot() + pushDerived (ce se întâmplă la 2 Hz)', () => {
    pushDerived(Date.now(), warm.snapshot())
  })
})
