import { z } from 'zod'

export const telemetryMessageSchema = z.object({
  schema_version: z.number().int().positive(),
  vehicle_id: z.string().min(1),
  session_id: z.string().min(1),
  timestamp: z.iso.datetime(),
  sequence: z.number().int().nonnegative(),
  signals: z.record(z.string(), z.number()),
})

export type TelemetryMessage = z.infer<typeof telemetryMessageSchema>
