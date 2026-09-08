import {
  alarmSchema,
  healthSchema,
  sampleSchema,
  sessionInfoSchema,
  signalCatalogSchema,
  type Alarm,
  type Health,
  type Sample,
  type SessionInfo,
  type SignalCatalog,
} from '../schemas/telemetry'
import { z } from 'zod'

/**
 * Accesul la serviciul de telemetrie. Fiecare răspuns este validat cu Zod:
 * dacă serverul schimbă contractul, aflăm imediat, nu prin `undefined` apărut
 * într-un card la mijlocul cursei.
 */

export const API_URL = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

export const WS_URL =
  import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws/telemetry'

export const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? ''

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ApiError(
      detail || `Cererea către ${path} a eșuat.`,
      response.status,
    )
  }

  return schema.parse(await response.json())
}

export function fetchCatalog(): Promise<SignalCatalog> {
  return request('/api/v1/signals', signalCatalogSchema)
}

export function fetchHealth(): Promise<Health> {
  return request('/api/v1/health', healthSchema)
}

export function fetchSessions(limit = 50): Promise<SessionInfo[]> {
  return request(`/api/v1/sessions?limit=${limit}`, z.array(sessionInfoSchema))
}

export function fetchActiveSession(): Promise<SessionInfo | null> {
  return request('/api/v1/sessions/active', sessionInfoSchema.nullable())
}

export function startSession(note = ''): Promise<SessionInfo> {
  return request(
    `/api/v1/sessions/start?note=${encodeURIComponent(note)}`,
    sessionInfoSchema,
    { method: 'POST' },
  )
}

export function stopSession(): Promise<SessionInfo> {
  return request('/api/v1/sessions/stop', sessionInfoSchema, { method: 'POST' })
}

/** Alarmele înregistrate într-o sesiune, folosite în timpul redării. */
export function fetchSessionAlarms(sessionId: string): Promise<Alarm[]> {
  return request(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/alarms`,
    z.array(alarmSchema),
  )
}

export function ackAlarm(alarmId: string): Promise<{ acknowledged: string }> {
  return request(
    `/api/v1/alarms/${encodeURIComponent(alarmId)}/ack`,
    z.object({ acknowledged: z.string() }),
    { method: 'POST' },
  )
}

export type HistoryQuery = {
  sessionId?: string
  /** Pentru backfill după reconectare: doar eșantioanele mai noi de acest moment. */
  since?: string
  start?: string
  end?: string
  limit?: number
  offset?: number
}

export function fetchHistory(query: HistoryQuery = {}): Promise<Sample[]> {
  const params = new URLSearchParams()
  if (query.sessionId) params.set('session_id', query.sessionId)
  if (query.since) params.set('since', query.since)
  if (query.start) params.set('start', query.start)
  if (query.end) params.set('end', query.end)
  params.set('limit', String(query.limit ?? 1200))
  if (query.offset) params.set('offset', String(query.offset))

  return request(`/api/v1/history?${params}`, z.array(sampleSchema))
}

export function exportUrl(sessionId: string): string {
  return `${API_URL}/api/v1/sessions/${encodeURIComponent(sessionId)}/export.csv`
}
