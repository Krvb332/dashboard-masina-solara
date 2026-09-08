import { fetchHistory, fetchSessionAlarms } from './api'
import { QualityTracker } from './quality'
import { pushSample, resetBuffer, sampleTime } from './telemetry-buffer'
import type { Alarm, Sample, SessionInfo } from '../schemas/telemetry'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Redarea unei sesiuni înregistrate.
 *
 * Regula de bază: replay-ul injectează datele în *aceleași* structuri ca fluxul
 * live - bufferul de serii temporale și store-ul de telemetrie. Componentele nu
 * știu în ce mod rulează, deci nu există o a doua cale de cod care să se
 * strice separat.
 */

const PAGE_SIZE = 20000
const MAX_SAMPLES = 120000
/** Ritmul de actualizare al textului, ca în modul live. */
const STORE_INTERVAL_MS = 200

export class ReplayDriver {
  private samples: Sample[] = []
  private alarms: Alarm[] = []
  private times: number[] = []
  private baseMs = 0
  private cursor = 0
  private frame: number | null = null
  private lastTickMs: number | null = null
  private lastStoreMs = 0
  private tracker = new QualityTracker()
  private session: SessionInfo | null = null
  private truncated = false

  get isTruncated(): boolean {
    return this.truncated
  }

  async load(session: SessionInfo): Promise<void> {
    const sessions = useSessionStore.getState()
    sessions.setLoading(true)
    sessions.setError(null)

    try {
      this.stop()
      this.samples = await this.loadAllSamples(session.id)
      this.alarms = await fetchSessionAlarms(session.id).catch(() => [])
      this.times = this.samples.map(sampleTime)
      this.session = session

      if (this.samples.length === 0) {
        sessions.setError('Sesiunea nu conține eșantioane.')
        sessions.setDuration(0)
        return
      }

      this.baseMs = this.times[0]
      const duration = this.times[this.times.length - 1] - this.baseMs

      resetBuffer()
      this.tracker.reset()
      this.cursor = 0

      sessions.setSession(session)
      sessions.setMode('replay')
      sessions.setDuration(duration)
      sessions.setPosition(0)
      useTelemetryStore.getState().reset()

      // Primul eșantion, ca interfața să nu rămână goală înainte de „play".
      this.advanceTo(0)
    } catch (error) {
      sessions.setError(
        error instanceof Error ? error.message : 'Încărcarea a eșuat.',
      )
    } finally {
      sessions.setLoading(false)
    }
  }

  play(): void {
    if (this.samples.length === 0) return

    const sessions = useSessionStore.getState()
    if (sessions.positionMs >= sessions.durationMs) sessions.setPosition(0)

    sessions.setPlaying(true)
    this.lastTickMs = null
    this.schedule()
  }

  pause(): void {
    useSessionStore.getState().setPlaying(false)
    this.cancel()
  }

  seek(positionMs: number): void {
    const sessions = useSessionStore.getState()
    const clamped = Math.max(0, Math.min(sessions.durationMs, positionMs))

    if (clamped < sessions.positionMs) {
      // Derulare înapoi: reconstruim bufferul de la început, ca graficele să nu
      // amestece date din viitor cu date din trecut.
      resetBuffer()
      this.tracker.reset()
      this.cursor = 0
    }

    sessions.setPosition(clamped)
    this.advanceTo(clamped)
  }

  stop(): void {
    this.cancel()
    const sessions = useSessionStore.getState()
    sessions.setPlaying(false)
    this.samples = []
    this.times = []
    this.alarms = []
    this.cursor = 0
    this.session = null
    this.tracker.reset()
  }

  exit(): void {
    this.stop()
    resetBuffer()
    useTelemetryStore.getState().reset()
    useSessionStore.getState().exitReplay()
  }

  private async loadAllSamples(sessionId: string): Promise<Sample[]> {
    const all: Sample[] = []

    for (let offset = 0; offset < MAX_SAMPLES; offset += PAGE_SIZE) {
      const page = await fetchHistory({
        sessionId,
        limit: PAGE_SIZE,
        offset,
      })
      all.push(...page)
      if (page.length < PAGE_SIZE) return all
    }

    this.truncated = true
    return all
  }

  private schedule(): void {
    this.cancel()
    this.frame = requestAnimationFrame((now) => this.tick(now))
  }

  private cancel(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame)
      this.frame = null
    }
  }

  private tick(now: number): void {
    const sessions = useSessionStore.getState()
    if (!sessions.playing) return

    const previous = this.lastTickMs ?? now
    this.lastTickMs = now

    const next = sessions.positionMs + (now - previous) * sessions.speed
    if (next >= sessions.durationMs) {
      sessions.setPosition(sessions.durationMs)
      this.advanceTo(sessions.durationMs, true)
      sessions.setPlaying(false)
      return
    }

    sessions.setPosition(next)
    this.advanceTo(next)
    this.schedule()
  }

  /** Împinge în buffer toate eșantioanele de până la poziția virtuală dată. */
  private advanceTo(positionMs: number, force = false): void {
    const target = this.baseMs + positionMs

    while (
      this.cursor < this.times.length &&
      this.times[this.cursor] <= target
    ) {
      const sample = this.samples[this.cursor]
      pushSample(sample)
      this.tracker.observe(sample, this.times[this.cursor])
      this.cursor += 1
    }

    const now = performance.now()
    if (!force && now - this.lastStoreMs < STORE_INTERVAL_MS) return
    this.lastStoreMs = now

    this.publish(target)
  }

  private publish(virtualTimeMs: number): void {
    const telemetry = useTelemetryStore.getState()
    const latest = this.cursor > 0 ? this.samples[this.cursor - 1] : null
    const serverTime = new Date(virtualTimeMs).toISOString()

    telemetry.applyFrame({
      type: 'frame',
      vehicle_id: this.session?.vehicle_id ?? null,
      session_id: this.session?.id ?? null,
      latest,
      quality: this.tracker.compute(telemetry.catalog, virtualTimeMs),
      alarms: this.alarmsAt(virtualTimeMs),
      stats: {
        ...telemetry.stats,
        received: this.cursor,
        effective_hz: 0,
        last_sequence: latest?.sequence ?? null,
      },
      server_time: serverTime,
      recording_session_id: null,
    })
  }

  private alarmsAt(virtualTimeMs: number): Alarm[] {
    return this.alarms.filter((alarm) => {
      const raised = new Date(alarm.raised_at).getTime()
      if (raised > virtualTimeMs) return false
      if (!alarm.cleared_at) return true
      return new Date(alarm.cleared_at).getTime() > virtualTimeMs
    })
  }
}

export const replayDriver = new ReplayDriver()
