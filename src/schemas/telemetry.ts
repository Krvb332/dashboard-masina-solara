import { z } from 'zod'

/**
 * Contractele de date. Oglindesc modelele Pydantic din `server/app/schemas.py`.
 * Fiecare cadru primit pe WebSocket este validat aici: un mesaj malformat este
 * numărat și ignorat, nu lăsat să ajungă în interfață.
 */

const isoDateTime = z.iso.datetime({ offset: true })

export const telemetryMessageSchema = z.object({
  schema_version: z.number().int().positive(),
  vehicle_id: z.string().min(1),
  session_id: z.string().min(1),
  timestamp: isoDateTime,
  sequence: z.number().int().nonnegative(),
  signals: z.record(z.string(), z.number()),
})

export const signalGroupSchema = z.enum([
  'status',
  'energy',
  'thermal',
  'motor',
  'gps',
  'chassis',
  'board',
])

export const signalSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  unit: z.string(),
  group: signalGroupSchema,
  decimals: z.number().int().nonnegative(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  stale_after_s: z.number().positive(),
  warn_below: z.number().nullable(),
  crit_below: z.number().nullable(),
  warn_above: z.number().nullable(),
  crit_above: z.number().nullable(),
  hysteresis: z.number(),
  overview: z.boolean(),
  chartable: z.boolean(),
  color: z.string().nullable(),
  description: z.string(),
})

export const signalCatalogSchema = z.object({
  signals: z.array(signalSchema),
  groups: z.array(z.object({ key: signalGroupSchema, label: z.string() })),
})

/**
 * Cerința 3 din documentul de arhitectură: `0` și „nu mai primesc date" sunt
 * stări diferite, iar interfața trebuie să le distingă vizual.
 */
export const qualityStateSchema = z.enum([
  'valid',
  'stale',
  'unavailable',
  'sensor_error',
])

export const signalQualitySchema = z.object({
  state: qualityStateSchema,
  age_ms: z.number().int().nonnegative(),
  value: z.number().nullable().default(null),
})

export const severitySchema = z.enum(['critical', 'warning', 'info'])

export const alarmSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  severity: severitySchema,
  message: z.string(),
  signal_key: z.string().nullable().default(null),
  value: z.number().nullable().default(null),
  threshold: z.number().nullable().default(null),
  raised_at: isoDateTime,
  cleared_at: isoDateTime.nullable().default(null),
  active: z.boolean().default(true),
})

export const streamStatsSchema = z.object({
  received: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  out_of_order: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  effective_hz: z.number().nonnegative(),
  last_sequence: z.number().int().nullable().default(null),
  clock_offset_ms: z.number().int(),
})

export const sampleSchema = z.object({
  timestamp: isoDateTime,
  server_received_at: isoDateTime,
  sequence: z.number().int().nonnegative(),
  signals: z.record(z.string(), z.number()),
})

const frameBase = {
  vehicle_id: z.string().nullable().default(null),
  session_id: z.string().nullable().default(null),
  latest: sampleSchema.nullable().default(null),
  quality: z.record(z.string(), signalQualitySchema),
  alarms: z.array(alarmSchema),
  stats: streamStatsSchema,
  server_time: isoDateTime,
  recording_session_id: z.string().nullable().default(null),
}

export const telemetryFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('frame'), ...frameBase }),
  z.object({
    type: z.literal('snapshot'),
    ...frameBase,
    history: z.array(sampleSchema),
  }),
])

export const sessionInfoSchema = z.object({
  id: z.string(),
  vehicle_id: z.string(),
  started_at: isoDateTime,
  ended_at: isoDateTime.nullable().default(null),
  sample_count: z.number().int().nonnegative(),
  alarm_count: z.number().int().nonnegative(),
  note: z.string(),
})

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  schema_version: z.number().int(),
  uptime_s: z.number(),
  ingest: z.record(z.string(), z.boolean()),
  last_message_at: isoDateTime.nullable(),
  stats: streamStatsSchema,
  recording_session_id: z.string().nullable(),
})

export type TelemetryMessage = z.infer<typeof telemetryMessageSchema>
export type SignalGroup = z.infer<typeof signalGroupSchema>
export type SignalDefinition = z.infer<typeof signalSchema>
export type SignalCatalog = z.infer<typeof signalCatalogSchema>
export type QualityState = z.infer<typeof qualityStateSchema>
export type SignalQuality = z.infer<typeof signalQualitySchema>
export type Severity = z.infer<typeof severitySchema>
export type Alarm = z.infer<typeof alarmSchema>
export type StreamStats = z.infer<typeof streamStatsSchema>
export type Sample = z.infer<typeof sampleSchema>
export type TelemetryFrame = z.infer<typeof telemetryFrameSchema>
export type SessionInfo = z.infer<typeof sessionInfoSchema>
export type Health = z.infer<typeof healthSchema>

export const EMPTY_STATS: StreamStats = {
  received: 0,
  dropped: 0,
  duplicates: 0,
  out_of_order: 0,
  invalid: 0,
  effective_hz: 0,
  last_sequence: null,
  clock_offset_ms: 0,
}
