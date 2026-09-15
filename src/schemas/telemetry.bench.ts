import { bench, describe } from 'vitest'
import { sampleSchema, telemetryFrameSchema } from './telemetry'
import { z } from 'zod'
import { makeFrame, makeSamples, makeSnapshot } from '../test/synthetic'

/**
 * Audit P3: costul validării Zod pe firul principal.
 *
 * Fiecare cadru WebSocket (10 Hz) trece prin `JSON.parse` + `safeParse`.
 * Snapshotul inițial aduce 600 de eșantioane, iar o pagină de replay 20 000.
 */

const frameJson = JSON.stringify(makeFrame(1234))
const snapshotJson = JSON.stringify(makeSnapshot(600))
const pageSamples = makeSamples(20_000)
const pageJson = JSON.stringify(pageSamples)
const historyPageSchema = z.array(sampleSchema)

console.info(
  `[audit P3] dimensiuni JSON: cadru=${(frameJson.length / 1024).toFixed(1)} KB, snapshot(600)=${(snapshotJson.length / 1024).toFixed(0)} KB, pagină replay(20000)=${(pageJson.length / 1024 / 1024).toFixed(1)} MB`,
)

describe('validare Zod', () => {
  bench(
    'cadru WS complet: JSON.parse + safeParse (de 10 ori pe secundă)',
    () => {
      telemetryFrameSchema.safeParse(JSON.parse(frameJson))
    },
  )

  bench('doar JSON.parse al cadrului', () => {
    JSON.parse(frameJson)
  })

  bench('snapshot cu 600 eșantioane: JSON.parse + safeParse', () => {
    telemetryFrameSchema.safeParse(JSON.parse(snapshotJson))
  })

  bench(
    'pagină de replay cu 20 000 eșantioane: JSON.parse + parse',
    () => {
      historyPageSchema.parse(JSON.parse(pageJson))
    },
    { iterations: 3, time: 0, warmupIterations: 1 },
  )
})
