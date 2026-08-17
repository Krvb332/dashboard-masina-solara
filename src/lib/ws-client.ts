import { fetchHistory } from './api'
import {
  telemetryFrameSchema,
  type Sample,
  type TelemetryFrame,
} from '../schemas/telemetry'

/**
 * Clientul WebSocket, independent de React.
 *
 * Trei lucruri contează într-un pitlane, în ordinea asta:
 *  1. să se reconecteze singur, cu backoff, fără să inunde serverul;
 *  2. să observe o conexiune moartă chiar dacă socketul nu s-a închis - de
 *     aceea există un watchdog pe cadre, nu doar handlerul `onclose`;
 *  3. la revenire, să recupereze golul din grafic (backfill din istoric).
 */

export type ConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export const PROTOCOL = 'telemetry.v1'

const BACKOFF_MIN_MS = 250
const BACKOFF_MAX_MS = 5000
const BACKOFF_FACTOR = 2
const JITTER = 0.25
/** Fără niciun cadru atâta timp, considerăm conexiunea moartă. */
const WATCHDOG_MS = 3000

export type TelemetryClientOptions = {
  url: string
  token?: string
  onFrame: (frame: TelemetryFrame) => void
  onState: (state: ConnectionState) => void
  /** Eșantioanele recuperate după o reconectare. */
  onBackfill?: (samples: Sample[]) => void
  /** Un cadru care nu trece validarea Zod. */
  onInvalid?: (error: unknown) => void
}

export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_MIN_MS * BACKOFF_FACTOR ** Math.max(0, attempt),
  )
  const spread = base * JITTER
  return Math.round(base - spread + random() * spread * 2)
}

export class TelemetryClient {
  private socket: WebSocket | null = null
  private attempt = 0
  private closedByUser = false
  private hasConnectedOnce = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null
  private lastServerReceivedAt: string | null = null

  private readonly options: TelemetryClientOptions

  constructor(options: TelemetryClientOptions) {
    this.options = options
  }

  connect(): void {
    this.closedByUser = false
    this.open()
  }

  close(): void {
    this.closedByUser = true
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.options.onState('disconnected')
  }

  /** Trimite un mesaj către server (de exemplu confirmarea unei alarme). */
  send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }

  private open(): void {
    this.options.onState(this.hasConnectedOnce ? 'reconnecting' : 'connecting')

    const protocols = [PROTOCOL]
    if (this.options.token) protocols.push(`bearer.${this.options.token}`)

    let socket: WebSocket
    try {
      socket = new WebSocket(this.options.url, protocols)
    } catch (error) {
      this.options.onInvalid?.(error)
      this.scheduleReconnect()
      return
    }

    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
      this.hasConnectedOnce = true
      this.options.onState('connected')
      this.armWatchdog()
      void this.backfill()
    }

    socket.onmessage = (event) => {
      this.armWatchdog()
      this.handleMessage(event.data)
    }

    socket.onerror = () => {
      // `onclose` urmează întotdeauna; reconectarea se decide acolo.
    }

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      this.scheduleReconnect()
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return

    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch (error) {
      this.options.onInvalid?.(error)
      return
    }

    const result = telemetryFrameSchema.safeParse(parsed)
    if (!result.success) {
      this.options.onInvalid?.(result.error)
      return
    }

    if (result.data.latest) {
      this.lastServerReceivedAt = result.data.latest.server_received_at
    }
    this.options.onFrame(result.data)
  }

  /** Recuperează eșantioanele pierdute cât timp conexiunea a fost întreruptă. */
  private async backfill(): Promise<void> {
    if (!this.lastServerReceivedAt || !this.options.onBackfill) return

    try {
      const samples = await fetchHistory({
        since: this.lastServerReceivedAt,
        limit: 3000,
      })
      if (samples.length > 0) this.options.onBackfill(samples)
    } catch (error) {
      this.options.onInvalid?.(error)
    }
  }

  private armWatchdog(): void {
    if (this.watchdogTimer !== null) clearTimeout(this.watchdogTimer)

    this.watchdogTimer = setTimeout(() => {
      // Socketul pare deschis, dar nu mai vin cadre: îl închidem noi, ca să
      // pornească reconectarea în loc să rămânem blocați într-o stare falsă.
      this.socket?.close()
    }, WATCHDOG_MS)
  }

  private scheduleReconnect(): void {
    this.clearTimers()
    if (this.closedByUser) return

    this.options.onState(this.hasConnectedOnce ? 'reconnecting' : 'connecting')
    const delay = backoffDelay(this.attempt)
    this.attempt += 1

    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }
}
