import { create } from 'zustand'
import type { ConnectionState } from '../lib/ws-client'
import {
  EMPTY_STATS,
  type Alarm,
  type Sample,
  type SignalDefinition,
  type SignalQuality,
  type StreamStats,
  type TelemetryFrame,
} from '../schemas/telemetry'

/**
 * Starea „lentă" a aplicației: ce se afișează ca text, nu ca grafic.
 *
 * Seriile temporale NU trec pe aici - trăiesc în `lib/telemetry-buffer.ts`.
 * Aici ajunge doar ultima stare cunoscută, actualizată de câteva ori pe
 * secundă, pentru că nimeni nu citește cifre de zece ori pe secundă.
 */

export type LapRecord = {
  lap: number
  /** Momentul închiderii turului, în milisecunde. */
  finishedAt: number
  durationS: number | null
  energyWh: number | null
  averageSpeedKph: number | null
}

type LapTracking = {
  lap: number | null
  startedAt: number | null
  energyAtStart: number | null
  distanceAtStart: number | null
}

type TelemetryStore = {
  connection: ConnectionState
  vehicleId: string | null
  sessionId: string | null
  latest: Sample | null
  quality: Record<string, SignalQuality>
  alarms: Alarm[]
  stats: StreamStats
  serverTime: string | null
  /** Diferența ceas browser - ceas server, în ms. Pozitiv = browserul e înainte. */
  clientClockOffsetMs: number
  recordingSessionId: string | null
  invalidFrames: number
  lastFrameAt: number | null
  catalog: SignalDefinition[]
  catalogByKey: Record<string, SignalDefinition>
  laps: LapRecord[]
  lapTracking: LapTracking
  /** Alarme confirmate local, ca să nu mai atragă atenția vizual. */
  acknowledged: string[]

  setConnection: (connection: ConnectionState) => void
  setCatalog: (signals: SignalDefinition[]) => void
  applyFrame: (frame: TelemetryFrame) => void
  countInvalidFrame: () => void
  acknowledgeAlarm: (alarmId: string) => void
  reset: () => void
}

const initialLapTracking: LapTracking = {
  lap: null,
  startedAt: null,
  energyAtStart: null,
  distanceAtStart: null,
}

export const useTelemetryStore = create<TelemetryStore>((set) => ({
  connection: 'connecting',
  vehicleId: null,
  sessionId: null,
  latest: null,
  quality: {},
  alarms: [],
  stats: EMPTY_STATS,
  serverTime: null,
  clientClockOffsetMs: 0,
  recordingSessionId: null,
  invalidFrames: 0,
  lastFrameAt: null,
  catalog: [],
  catalogByKey: {},
  laps: [],
  lapTracking: initialLapTracking,
  acknowledged: [],

  setConnection: (connection) => set({ connection }),

  setCatalog: (signals) =>
    set({
      catalog: signals,
      catalogByKey: Object.fromEntries(
        signals.map((signal) => [signal.key, signal]),
      ),
    }),

  applyFrame: (frame) =>
    set((state) => {
      const serverMs = new Date(frame.server_time).getTime()

      return {
        vehicleId: frame.vehicle_id,
        sessionId: frame.session_id,
        latest: frame.latest,
        quality: frame.quality,
        alarms: frame.alarms,
        stats: frame.stats,
        serverTime: frame.server_time,
        clientClockOffsetMs: Number.isFinite(serverMs)
          ? Date.now() - serverMs
          : state.clientClockOffsetMs,
        recordingSessionId: frame.recording_session_id,
        lastFrameAt: Date.now(),
        ...trackLaps(state, frame.latest),
      }
    }),

  countInvalidFrame: () =>
    set((state) => ({ invalidFrames: state.invalidFrames + 1 })),

  acknowledgeAlarm: (alarmId) =>
    set((state) =>
      state.acknowledged.includes(alarmId)
        ? state
        : { acknowledged: [...state.acknowledged, alarmId] },
    ),

  reset: () =>
    set({
      latest: null,
      quality: {},
      alarms: [],
      stats: EMPTY_STATS,
      laps: [],
      lapTracking: initialLapTracking,
      acknowledged: [],
      invalidFrames: 0,
    }),
}))

/**
 * Închide un tur când `lap_number` crește și reține consumul, durata și viteza
 * medie. Fără asta, „consum pe tur" din documentul de arhitectură ar cere fie un
 * endpoint dedicat, fie recalcularea întregului istoric la fiecare cadru.
 */
function trackLaps(
  state: TelemetryStore,
  sample: Sample | null,
): Partial<TelemetryStore> {
  if (!sample) return {}

  const lap = sample.signals.lap_number
  if (lap === undefined) return {}

  const time = new Date(sample.server_received_at).getTime()
  const energy = sample.signals.energy_consumed_wh ?? null
  const distance = sample.signals.distance_km ?? null
  const tracking = state.lapTracking

  const restart = {
    lap,
    startedAt: time,
    energyAtStart: energy,
    distanceAtStart: distance,
  }

  if (tracking.lap === null) return { lapTracking: restart }
  if (lap <= tracking.lap) return {}

  const durationS =
    tracking.startedAt === null ? null : (time - tracking.startedAt) / 1000
  const energyWh =
    energy === null || tracking.energyAtStart === null
      ? null
      : energy - tracking.energyAtStart
  const distanceKm =
    distance === null || tracking.distanceAtStart === null
      ? null
      : distance - tracking.distanceAtStart

  const record: LapRecord = {
    lap: tracking.lap,
    finishedAt: time,
    durationS,
    energyWh,
    averageSpeedKph:
      distanceKm !== null && durationS !== null && durationS > 0
        ? (distanceKm / durationS) * 3600
        : null,
  }

  return { laps: [...state.laps, record].slice(-60), lapTracking: restart }
}
