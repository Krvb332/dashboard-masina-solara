import { describe, expect, it } from 'vitest'
import { telemetryFrameSchema } from './telemetry'
import { makeFrame } from '../test/synthetic'

/**
 * Audit B2, partea de contract: ce face browserul cu un `null` în semnale.
 *
 * Serverul acceptă `NaN` de la mașină (și îl marchează corect ca eroare de
 * senzor), dar îl serializează ca `null`. Testul de față fixează faptul că
 * schema frontendului respinge atunci întregul cadru — nu doar semnalul —
 * deci o singură valoare NaN oprește afișarea tuturor celorlalte 103 semnale.
 */

describe('contractul cadrului cu un semnal null (B2)', () => {
  it('un cadru complet valid trece', () => {
    expect(telemetryFrameSchema.safeParse(makeFrame(1)).success).toBe(true)
  })

  it('un singur null în latest.signals invalidează tot cadrul', () => {
    const frame = makeFrame(1) as unknown as {
      latest: { signals: Record<string, unknown> }
    }
    frame.latest.signals.motor_temp_c = null
    const result = telemetryFrameSchema.safeParse(frame)
    expect(result.success).toBe(false)
    if (!result.success) {
      console.info(
        `[audit B2] cadru cu motor_temp_c=null → respins de Zod: ${result.error.issues[0]?.path.join('.')} (${result.error.issues[0]?.code}); celelalte ${Object.keys(frame.latest.signals).length - 1} semnale nu mai ajung în interfață`,
      )
    }
  })

  it('un null în quality.value este acceptat (contractul îl permite explicit)', () => {
    const frame = makeFrame(1)
    frame.quality.motor_temp_c = {
      state: 'sensor_error',
      age_ms: 0,
      value: null,
    }
    expect(telemetryFrameSchema.safeParse(frame).success).toBe(true)
  })
})
