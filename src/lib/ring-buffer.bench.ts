import { bench, describe } from 'vitest'
import { collectFixes } from './gps-buffer'
import { TelemetryRingBuffer } from './ring-buffer'
import {
  BUFFER_CAPACITY,
  pushSamples,
  resetBuffer,
  telemetryBuffer,
} from './telemetry-buffer'
import { makeSamples } from '../test/synthetic'

/**
 * Audit P5: costul bufferului circular la ritmul real.
 *
 * 6000 de eșantioane × 104 semnale = zece minute la 10 Hz. Cifrele de aici
 * spun cât costă un `push` (o dată la 100 ms) și o extragere de serie (de
 * câteva ori la 200 ms, per grafic).
 */

const samples = makeSamples(BUFFER_CAPACITY, { gpsNoiseM: 1.5 })
const times = samples.map((sample) =>
  new Date(sample.server_received_at).getTime(),
)

resetBuffer()
pushSamples(samples)

describe('ring buffer 6000 × 104 semnale', () => {
  bench('push: 6000 eșantioane (10 minute la 10 Hz)', () => {
    const buffer = new TelemetryRingBuffer(BUFFER_CAPACITY)
    for (let index = 0; index < samples.length; index += 1) {
      buffer.push(times[index], samples[index].signals)
    }
  })

  bench(
    'toSeries: un semnal, fereastră 7 min, 900 puncte (un grafic, o serie)',
    () => {
      telemetryBuffer.toSeries('battery_power_w', 7 * 60_000, 900)
    },
  )

  bench(
    'toSeries: 6 semnale, fără fereastră, 3000 puncte (collectFixes pentru hartă)',
    () => {
      collectFixes(3000)
    },
  )

  bench(
    'toSeries: 6 semnale, fără fereastră, 6000 puncte (collectFixes pentru profil)',
    () => {
      collectFixes()
    },
  )

  bench('latest + valueAgo(60 s): un card de indicator', () => {
    telemetryBuffer.latest('battery_power_w')
    telemetryBuffer.valueAgo('battery_power_w', 60_000)
  })

  bench('snapshot(): export complet al bufferului', () => {
    telemetryBuffer.snapshot()
  })
})
