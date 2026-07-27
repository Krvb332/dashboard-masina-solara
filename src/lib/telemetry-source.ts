import type { Alarm, TelemetryFrame } from '../schemas/telemetry'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export type TelemetryHandlers = {
  onFrame: (frame: TelemetryFrame) => void
  onAlarms: (alarms: Alarm[]) => void
  onStatus: (status: ConnectionStatus, detail?: string) => void
  /** Mesaj primit dar respins de validare — util pentru diagnosticarea backendului. */
  onInvalid: (reason: string) => void
}

export type TelemetrySource = {
  readonly kind: 'websocket' | 'simulator'
  /** Descriere scurtă a sursei, afișată în interfață. */
  readonly describe: string
  start: () => void
  stop: () => void
}
