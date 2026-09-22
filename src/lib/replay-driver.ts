import { TelemetryAnalytics } from './analytics'
import { fetchHistory, fetchSessionAlarms } from './api'
import { pushDerived, resetDerivedBuffer } from './derived-buffer'
import { QualityTracker } from './quality'
import { pushSample, resetBuffer, sampleTime } from './telemetry-buffer'
import type { Alarm, Sample, SessionInfo } from '../schemas/telemetry'
import { useAnalyticsStore } from '../stores/analytics-store'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Redarea unei sesiuni înregistrate.
 *
 * Regula de bază: replay-ul injectează datele în *aceleași* structuri ca fluxul
 * live - bufferul de serii temporale, bufferul de serii derivate și store-urile.
 * Componentele nu știu în ce mod rulează, deci nu există o a doua cale de cod
 * care să se strice separat.
 *
 * Ceasul redării este cel al eșantioanelor, nu cel al browserului. De aceea
 * driverul are propriul acumulator de statistici, hrănit eșantion cu eșantion
 * la timpul lor virtual: motorul live (`useAnalyticsEngine`) integrează pe
 * `Date.now()`, iar pe o redare la 10× sau pe pauză ar aduna energie care nu
 * s-a consumat și ar desena seriile derivate pe o axă de timp străină de cea a
 * graficelor măsurate.
 *
 * Derularea înapoi nu poate fi „anulată": bilanțurile sunt integrale, deci
 * starea de la minutul 20 nu se obține din cea de la minutul 30. Driverul ține
 * puncte de control ale acumulatorului la interval fix și, la o derulare,
 * pornește de la cel mai apropiat punct dinaintea ferestrei de istoric, refăcând
 * în buffere doar cât afișează graficele. Ca tragerea cursorului să rămână
 * fluidă, derulările cerute în același cadru se contopesc și se aplică o
 * singură dată.
 */

const PAGE_SIZE = 20000
const MAX_SAMPLES = 120000
/** Ritmul de actualizare al textului, ca în modul live. */
const STORE_INTERVAL_MS = 200
/**
 * Ritmul seriilor derivate, în timp virtual. Istoricul reconstruit de server
 * are un eșantion pe secundă, deci mai des de atât ar repeta același punct.
 */
const DERIVED_INTERVAL_MS = 1000
/**
 * Cât istoric se reface în buffere la o derulare: cât ține bufferul live
 * (zece minute), ca graficele și urma GPS să arate la fel în ambele moduri.
 */
const HISTORY_MS = 10 * 60_000
/**
 * Fereastra de serii derivate refăcută la o derulare, cu pasul ei. Un snapshot
 * al acumulatorului costă cam o jumătate de milisecundă; graficele derivate
 * arată cel mult șapte minute, deci nu are rost să calculăm mai mult, iar la
 * doi în secundă un grafic de 800 px are oricum mai multe puncte decât pixeli.
 */
const DERIVED_HISTORY_MS = 7.5 * 60_000
const DERIVED_HISTORY_INTERVAL_MS = 2000
/** Un punct de control la atâtea eșantioane (cinci minute la 1 Hz). */
const CHECKPOINT_EVERY = 300
/**
 * Cât timp fără o nouă derulare înseamnă că omul a lăsat cursorul. Cât trage,
 * seriile derivate nu se calculează: graficele măsurate și cifrele se
 * actualizează la fiecare cadru, iar istoricul derivat, scump, se completează
 * o singură dată, după oprire.
 */
const SETTLE_MS = 150
/** Un pas înainte de cel mult atât își calculează seriile derivate pe loc. */
const DERIVED_INLINE_MS = 30_000

type ExitOptions = {
  /**
   * După ieșire, bufferul live se reumple cu istoricul recent al serverului,
   * ca graficele să nu rămână goale până sosesc date noi. Resetul manual din
   * pagina „Sistem" cere ecran curat, deci îl dezactivează.
   */
  resync?: boolean
}

/** Starea acumulatorului *înainte* de eșantionul cu indexul `cursor`. */
type Checkpoint = {
  cursor: number
  analytics: TelemetryAnalytics
  tracker: QualityTracker
}

/** Ce face driverul când redarea se închide; înregistrat de fluxul live. */
export type ReplayExitHook = () => void

let onExitHook: ReplayExitHook | null = null

/** Chemat de `useTelemetryStream`, ca ieșirea din replay să reumple bufferul live. */
export function registerReplayExitHook(hook: ReplayExitHook): () => void {
  onExitHook = hook
  return () => {
    if (onExitHook === hook) onExitHook = null
  }
}

function scheduleFrame(callback: (now: number) => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const frame = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(frame)
  }
  const timer = setTimeout(() => callback(Date.now()), 16)
  return () => clearTimeout(timer)
}

/**
 * Copie independentă a acumulatorului. Câmpurile lui sunt numere, tablouri,
 * obiecte simple și `Map`-uri, adică exact ce știe `structuredClone`; metodele
 * vin din prototip.
 */
function cloneAnalytics(source: TelemetryAnalytics): TelemetryAnalytics {
  return Object.assign(
    Object.create(TelemetryAnalytics.prototype) as TelemetryAnalytics,
    structuredClone({ ...source }),
  )
}

export class ReplayDriver {
  private samples: Sample[] = []
  private alarms: Alarm[] = []
  private times: number[] = []
  private baseMs = 0
  private cursor = 0
  /** Poziția (ms de la început) până la care sunt construite bufferele. */
  private builtMs = -1
  private cancelTick: (() => void) | null = null
  private cancelSeek: (() => void) | null = null
  private pendingSeekMs: number | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  /** Seriile derivate nu acoperă poziția curentă; se completează la oprire. */
  private derivedStale = false
  private lastTickMs: number | null = null
  private lastStoreMs = 0
  private lastDerivedMs = -Infinity
  private tracker = new QualityTracker()
  private analytics = new TelemetryAnalytics()
  private checkpoints = new Map<number, Checkpoint>()
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
      this.truncated = false
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

      sessions.setSession(session)
      sessions.setMode('replay')
      sessions.setDuration(duration)
      sessions.setPosition(0)
      useTelemetryStore.getState().reset()

      // Primul eșantion, ca interfața să nu rămână goală înainte de „play".
      this.rebuildTo(0)
      this.advanceTo(0, true)
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
    if (sessions.positionMs >= sessions.durationMs) {
      // Redare de la capăt după ce s-a terminat: bufferele țin sfârșitul
      // sesiunii, deci trebuie golite, nu doar mutat cursorul pe zero.
      sessions.setPosition(0)
      this.pendingSeekMs = 0
      this.applyPendingSeek(true)
    }

    sessions.setPlaying(true)
    this.lastTickMs = null
    this.schedule()
  }

  pause(): void {
    useSessionStore.getState().setPlaying(false)
    this.cancelScheduled()
  }

  /**
   * Mută poziția. Cursorul din interfață se actualizează imediat; bufferele se
   * reconstruiesc o singură dată pe cadru, oricâte evenimente trimite
   * slider-ul între timp.
   */
  seek(positionMs: number): void {
    if (this.samples.length === 0) return

    const sessions = useSessionStore.getState()
    const clamped = Math.max(0, Math.min(sessions.durationMs, positionMs))
    sessions.setPosition(clamped)

    this.pendingSeekMs = clamped
    if (this.cancelSeek === null) {
      this.cancelSeek = scheduleFrame(() => {
        this.cancelSeek = null
        this.applyPendingSeek(false)
        this.armSettle()
      })
    }
    this.armSettle()
  }

  /**
   * Aplică acum derularea în așteptare și completează seriile derivate, fără
   * să aștepte cadrul sau oprirea cursorului. Util în teste.
   */
  flush(): void {
    if (this.cancelSeek !== null) {
      this.cancelSeek()
      this.cancelSeek = null
    }
    this.clearSettle()
    this.applyPendingSeek(true)
    if (this.derivedStale) this.fillDerived()
  }

  stop(): void {
    this.cancelScheduled()
    if (this.cancelSeek !== null) {
      this.cancelSeek()
      this.cancelSeek = null
    }
    this.pendingSeekMs = null
    this.clearSettle()
    this.derivedStale = false
    const sessions = useSessionStore.getState()
    sessions.setPlaying(false)
    this.samples = []
    this.times = []
    this.alarms = []
    this.cursor = 0
    this.builtMs = -1
    this.session = null
    this.checkpoints.clear()
    this.tracker.reset()
    this.analytics.reset()
  }

  exit({ resync = true }: ExitOptions = {}): void {
    this.stop()
    resetBuffer()
    resetDerivedBuffer()
    useTelemetryStore.getState().reset()
    useAnalyticsStore.getState().clear()
    useSessionStore.getState().exitReplay()
    if (resync) onExitHook?.()
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
    this.cancelScheduled()
    this.cancelTick = scheduleFrame((now) => this.tick(now))
  }

  private cancelScheduled(): void {
    if (this.cancelTick !== null) {
      this.cancelTick()
      this.cancelTick = null
    }
  }

  private tick(now: number): void {
    this.cancelTick = null
    const sessions = useSessionStore.getState()
    if (!sessions.playing) return

    // O derulare cerută între două cadre se aplică înaintea pasului de redare,
    // altfel pasul ar împinge eșantioane peste o poziție care nu mai e valabilă.
    this.applyPendingSeek(false)

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

  /**
   * Aplică derularea în așteptare. Cu `withDerived` fals (cursorul e încă
   * tras), seriile derivate se sar, în afară de pașii mici înainte, care sunt
   * ieftini; restul se completează la `fillDerived`, după oprire.
   */
  private applyPendingSeek(withDerived: boolean): void {
    if (this.pendingSeekMs === null) return
    const target = this.pendingSeekMs
    this.pendingSeekMs = null

    // Înapoi, sau înainte peste mai mult decât ține fereastra de istoric:
    // bufferele se refac, ca graficele să nu amestece date din viitor cu date
    // din trecut și nici două bucăți de sesiune cu o gaură între ele.
    const rebuild = target < this.builtMs || target - this.builtMs > HISTORY_MS
    if (rebuild) this.rebuildTo(target)

    const derived =
      withDerived || (!rebuild && target - this.builtMs <= DERIVED_INLINE_MS)
    if (!derived) this.derivedStale = true

    // Forțat: după o derulare, textul trebuie să arate poziția nouă imediat,
    // nu peste 200 ms sau, dacă nu mai urmează alt pas, niciodată.
    this.advanceTo(target, true, derived)
  }

  private armSettle(): void {
    this.clearSettle()
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      // Mai e o derulare pe drum: cadrul o aplică, apoi se rearmează.
      if (this.pendingSeekMs !== null) return
      if (this.derivedStale) this.fillDerived()
    }, SETTLE_MS)
  }

  private clearSettle(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
  }

  /** Reface istoricul derivat al poziției curente, după ce cursorul s-a oprit. */
  private fillDerived(): void {
    this.derivedStale = false
    const target = this.builtMs
    if (target < 0) return
    this.rebuildTo(target)
    this.advanceTo(target, true, true)
  }

  /**
   * Golește bufferele și aduce acumulatorul la cel mai apropiat punct de
   * control dinaintea ferestrei de istoric a poziției cerute. `advanceTo`
   * parcurge apoi eșantioanele rămase: toate trec prin acumulator, dar în
   * buffere ajung doar cele din fereastră.
   */
  private rebuildTo(positionMs: number): void {
    resetBuffer()
    resetDerivedBuffer()
    this.builtMs = -1
    this.lastDerivedMs = -Infinity

    const historyFrom = this.baseMs + positionMs - HISTORY_MS
    let best: Checkpoint | null = null
    for (const checkpoint of this.checkpoints.values()) {
      if (this.times[checkpoint.cursor] > historyFrom) continue
      if (best === null || checkpoint.cursor > best.cursor) best = checkpoint
    }

    if (best === null) {
      this.tracker.reset()
      this.analytics.reset()
      this.cursor = 0
      return
    }

    this.tracker = best.tracker.clone()
    this.analytics = cloneAnalytics(best.analytics)
    this.cursor = best.cursor
  }

  /** Împinge în buffere toate eșantioanele de până la poziția virtuală dată. */
  private advanceTo(
    positionMs: number,
    force = false,
    withDerived = true,
  ): void {
    const target = this.baseMs + positionMs
    const historyFrom = target - HISTORY_MS
    const derivedFrom = withDerived ? target - DERIVED_HISTORY_MS : Infinity
    const catalog = useTelemetryStore.getState().catalog

    while (
      this.cursor < this.times.length &&
      this.times[this.cursor] <= target
    ) {
      if (
        this.cursor > 0 &&
        this.cursor % CHECKPOINT_EVERY === 0 &&
        !this.checkpoints.has(this.cursor)
      ) {
        this.checkpoints.set(this.cursor, {
          cursor: this.cursor,
          analytics: cloneAnalytics(this.analytics),
          tracker: this.tracker.clone(),
        })
      }

      const sample = this.samples[this.cursor]
      const time = this.times[this.cursor]
      this.cursor += 1

      // Acumulatorul primește fiecare eșantion la timpul lui, nu la cel al
      // browserului: așa energia și distanța sunt cele ale sesiunii, iar
      // seriile derivate stau pe aceeași axă de timp ca cele măsurate.
      this.tracker.observe(sample, time)
      this.analytics.update({
        timeMs: time,
        quality: this.tracker.compute(catalog, time),
      })

      if (time < historyFrom) continue
      pushSample(sample)

      if (time < derivedFrom) continue
      // Istoricul derivat se reface mai rar decât se redă: un snapshot este
      // scump, iar la derulare contează să ajungem repede la poziția cerută.
      const interval =
        positionMs - this.builtMs > HISTORY_MS || this.builtMs < 0
          ? DERIVED_HISTORY_INTERVAL_MS
          : DERIVED_INTERVAL_MS
      if (time - this.lastDerivedMs >= interval) {
        this.lastDerivedMs = time
        pushDerived(time, this.analytics.snapshot())
      }
    }

    this.builtMs = positionMs

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

    useAnalyticsStore
      .getState()
      .publish(this.analytics.snapshot(), virtualTimeMs)
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
