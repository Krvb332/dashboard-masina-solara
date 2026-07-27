import { create } from 'zustand'
import { env } from '../config/env'
import { HistoryBuffer } from '../lib/history-buffer'
import type { ConnectionStatus } from '../lib/telemetry-source'
import {
  normalizeSignals,
  type Alarm,
  type NormalizedSignal,
  type NormalizedSignals,
  type TelemetryFrame,
} from '../schemas/telemetry'

/**
 * Istoricul este ținut în afara store-ului React (vezi `HistoryBuffer`).
 * Store-ul păstrează doar `historyVersion`, care se schimbă la fiecare
 * publicare și declanșează redesenarea graficelor.
 */
export const historyBuffer = new HistoryBuffer(env.historySize)

export type FrameMeta = {
  vehicleId: string
  sessionId: string
  sequence: number
  /** Timestamp-ul generat de mașină. */
  vehicleTime: number
  /** Momentul recepției în browser — folosit pentru vechime și latență. */
  receivedAt: number
}

export type TelemetryStats = {
  received: number
  invalid: number
  /** Mesaje lipsă, deduse din discontinuitățile numărului de secvență. */
  gaps: number
  outOfOrder: number
  /** Rata efectivă de recepție pe fir, calculată pe ultima secundă. */
  rateHz: number
  /** Diferența dintre ceasul mașinii și cel al browserului. */
  clockSkewMs: number | null
  lastInvalidReason: string | null
}

type TelemetryState = {
  connection: ConnectionStatus
  connectionDetail: string
  sourceKind: 'websocket' | 'simulator'
  sourceLabel: string

  signals: NormalizedSignals | null
  meta: FrameMeta | null
  historyVersion: number

  /** Alarme calculate de server; cele locale sunt derivate în `useAlarms`. */
  serverAlarms: Alarm[]
  stats: TelemetryStats

  /** Înregistrează un cadru la rata plină, fără să declanșeze randare. */
  ingestFrame: (frame: TelemetryFrame, receivedAt?: number) => void
  /** Publică în React ultimul cadru înregistrat. Apelat limitat, la `uiRefreshHz`. */
  commit: () => void

  setStatus: (status: ConnectionStatus, detail?: string) => void
  setSource: (kind: 'websocket' | 'simulator', label: string) => void
  setServerAlarms: (alarms: Alarm[]) => void
  reportInvalid: (reason: string) => void
  reset: () => void
}

const createStats = (): TelemetryStats => ({
  received: 0,
  invalid: 0,
  gaps: 0,
  outOfOrder: 0,
  rateHz: 0,
  clockSkewMs: null,
  lastInvalidReason: null,
})

/**
 * Acumulator mutabil, în afara stării React.
 *
 * Cadrele sosesc potențial la 50–100 Hz, dar interfața nu are nevoie să se
 * redeseneze pentru fiecare. Istoricul, statisticile și detecția golurilor se
 * actualizează pentru fiecare cadru; doar publicarea către React este limitată.
 */
type Pending = {
  signals: NormalizedSignals | null
  meta: FrameMeta | null
  stats: TelemetryStats
  lastSequence: number | null
  arrivals: number[]
  dirty: boolean
}

const pending: Pending = {
  signals: null,
  meta: null,
  stats: createStats(),
  lastSequence: null,
  arrivals: [],
  dirty: false,
}

function measureRate(receivedAt: number): number {
  pending.arrivals.push(receivedAt)
  const cutoff = receivedAt - 1_000
  while (pending.arrivals.length > 0 && pending.arrivals[0]! < cutoff) {
    pending.arrivals.shift()
  }
  return pending.arrivals.length
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  connection: 'idle',
  connectionDetail: '',
  sourceKind: env.telemetrySource,
  sourceLabel: '',

  signals: null,
  meta: null,
  historyVersion: 0,

  serverAlarms: [],
  stats: createStats(),

  ingestFrame: (frame, receivedAt = Date.now()) => {
    const signals = normalizeSignals(frame.signals)
    const vehicleTime = Date.parse(frame.timestamp)

    historyBuffer.push(receivedAt, signals)

    if (pending.lastSequence !== null) {
      const step = frame.sequence - pending.lastSequence
      if (step > 1) pending.stats.gaps += step - 1
      else if (step <= 0) pending.stats.outOfOrder += 1
    }
    pending.lastSequence = frame.sequence

    pending.stats.received += 1
    pending.stats.rateHz = measureRate(receivedAt)
    pending.stats.clockSkewMs = Number.isFinite(vehicleTime)
      ? receivedAt - vehicleTime
      : null

    pending.signals = signals
    pending.meta = {
      vehicleId: frame.vehicle_id,
      sessionId: frame.session_id,
      sequence: frame.sequence,
      vehicleTime,
      receivedAt,
    }
    pending.dirty = true
  },

  commit: () => {
    if (!pending.dirty) return
    pending.dirty = false
    set({
      signals: pending.signals,
      meta: pending.meta,
      historyVersion: historyBuffer.version,
      stats: { ...pending.stats },
    })
  },

  setStatus: (connection, detail = '') =>
    set({ connection, connectionDetail: detail }),

  setSource: (sourceKind, sourceLabel) => set({ sourceKind, sourceLabel }),

  setServerAlarms: (serverAlarms) => set({ serverAlarms }),

  reportInvalid: (reason) => {
    pending.stats.invalid += 1
    pending.stats.lastInvalidReason = reason
    pending.dirty = true
  },

  reset: () => {
    historyBuffer.clear()
    pending.signals = null
    pending.meta = null
    pending.stats = createStats()
    pending.lastSequence = null
    pending.arrivals = []
    pending.dirty = false

    set({
      signals: null,
      meta: null,
      serverAlarms: [],
      stats: createStats(),
      historyVersion: historyBuffer.version,
    })
  },
}))

/**
 * Citirea unui semnal. Returnează întotdeauna aceeași formă, cu `value: null`
 * când semnalul lipsește — apelanții nu trebuie să distingă între „semnal
 * necunoscut" și „fără valoare".
 */
export const MISSING_SIGNAL: NormalizedSignal = {
  value: null,
  quality: 'unavailable',
}

export function selectSignal(
  signals: NormalizedSignals | null,
  key: string,
): NormalizedSignal {
  return signals?.[key] ?? MISSING_SIGNAL
}
