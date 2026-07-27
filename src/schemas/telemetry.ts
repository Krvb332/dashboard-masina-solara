import { z } from 'zod'

/**
 * Calitatea unui semnal, conform deciziei tehnice #8 din documentul de
 * arhitectură. Serverul poate trimite fie un număr simplu, fie un obiect cu
 * valoare și calitate; ambele forme sunt acceptate și normalizate.
 */
export const signalQualitySchema = z.enum([
  'valid',
  'stale',
  'unavailable',
  'error',
])

export type SignalQuality = z.infer<typeof signalQualitySchema>

export const signalValueSchema = z.union([
  z.number(),
  z.null(),
  z.object({
    value: z.number().nullable(),
    quality: signalQualitySchema.optional(),
  }),
])

/** Mesajul de telemetrie, exact cum este descris în documentul de arhitectură. */
export const telemetryFrameSchema = z.object({
  schema_version: z.number().int().positive(),
  vehicle_id: z.string().min(1),
  session_id: z.string().min(1),
  timestamp: z.iso.datetime(),
  sequence: z.number().int().nonnegative(),
  signals: z.record(z.string(), signalValueSchema),
})

export type TelemetryFrame = z.infer<typeof telemetryFrameSchema>

export const alarmSeveritySchema = z.enum(['critical', 'warning', 'info'])
export type AlarmSeverity = z.infer<typeof alarmSeveritySchema>

export const alarmSchema = z.object({
  id: z.string().min(1),
  severity: alarmSeveritySchema,
  signal: z.string().optional(),
  title: z.string().min(1),
  detail: z.string().optional(),
  since: z.iso.datetime().optional(),
})

export type Alarm = z.infer<typeof alarmSchema>

/**
 * Serverul poate trimite fie un frame „gol” (forma documentată), fie un plic cu
 * discriminator. Suportăm ambele ca să nu blocăm frontendul pe o decizie de
 * backend care încă nu a fost luată.
 */
export const serverMessageSchema = z.union([
  z.object({ type: z.literal('telemetry'), frame: telemetryFrameSchema }),
  z.object({ type: z.literal('alarms'), alarms: z.array(alarmSchema) }),
  telemetryFrameSchema,
])

export type ServerMessage = z.infer<typeof serverMessageSchema>

/** Valoarea unui semnal după normalizare. `null` = nu avem date, nu zero. */
export type NormalizedSignal = {
  value: number | null
  quality: SignalQuality
}

export type NormalizedSignals = Record<string, NormalizedSignal>

export function normalizeSignals(
  signals: TelemetryFrame['signals'],
): NormalizedSignals {
  const result: NormalizedSignals = {}

  for (const [key, raw] of Object.entries(signals)) {
    if (raw === null) {
      result[key] = { value: null, quality: 'unavailable' }
    } else if (typeof raw === 'number') {
      result[key] = { value: raw, quality: 'valid' }
    } else {
      result[key] = {
        value: raw.value,
        quality: raw.quality ?? (raw.value === null ? 'unavailable' : 'valid'),
      }
    }
  }

  return result
}
