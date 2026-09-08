import { serverMessageSchema } from '../schemas/telemetry'
import type { TelemetryHandlers, TelemetrySource } from './telemetry-source'

const INITIAL_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 15_000
const BACKOFF_FACTOR = 1.8

/** ±20% jitter, ca mai multe stații din pitlane să nu reconecteze simultan. */
function withJitter(delayMs: number): number {
  return Math.round(delayMs * (0.8 + Math.random() * 0.4))
}

export type WebSocketSourceOptions = {
  url: string
  handlers: TelemetryHandlers
  /** Injectabil pentru teste. */
  createSocket?: (url: string) => WebSocket
}

/**
 * Client WebSocket cu reconectare automată.
 *
 * Reconectarea folosește backoff exponențial cu jitter și repornește imediat
 * când browserul semnalează revenirea rețelei. Conexiunea este considerată
 * stabilă abia după primul mesaj valid, deci un server care acceptă conexiunea
 * dar nu trimite nimic nu resetează backoff-ul.
 */
export function createWebSocketSource({
  url,
  handlers,
  createSocket = (target) => new WebSocket(target),
}: WebSocketSourceOptions): TelemetrySource {
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let backoffMs = INITIAL_BACKOFF_MS
  let stopped = true
  let hasReceivedMessage = false

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function scheduleReconnect(reason: string) {
    if (stopped || reconnectTimer !== null) return

    const delay = withJitter(backoffMs)
    backoffMs = Math.min(backoffMs * BACKOFF_FACTOR, MAX_BACKOFF_MS)

    handlers.onStatus(
      'reconnecting',
      `${reason} · reîncercare în ${(delay / 1000).toFixed(1)} s`,
    )

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function handleMessage(event: MessageEvent) {
    if (typeof event.data !== 'string') {
      handlers.onInvalid('Cadru binar primit; se așteaptă JSON.')
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(event.data)
    } catch {
      handlers.onInvalid('JSON invalid.')
      return
    }

    const parsed = serverMessageSchema.safeParse(payload)
    if (!parsed.success) {
      handlers.onInvalid(parsed.error.issues[0]?.message ?? 'Schemă necunoscută.')
      return
    }

    if (!hasReceivedMessage) {
      hasReceivedMessage = true
      backoffMs = INITIAL_BACKOFF_MS
      handlers.onStatus('connected')
    }

    const message = parsed.data
    if ('type' in message && message.type === 'alarms') {
      handlers.onAlarms(message.alarms)
    } else if ('type' in message && message.type === 'telemetry') {
      handlers.onFrame(message.frame)
    } else {
      handlers.onFrame(message)
    }
  }

  function connect() {
    if (stopped) return

    handlers.onStatus('connecting', url)
    hasReceivedMessage = false

    let next: WebSocket
    try {
      next = createSocket(url)
    } catch (error) {
      scheduleReconnect(
        error instanceof Error ? error.message : 'URL WebSocket invalid',
      )
      return
    }

    socket = next

    next.onopen = () => {
      // Conexiunea este deschisă, dar așteptăm primul mesaj valid înainte de a
      // raporta „conectat" și de a reseta backoff-ul.
      handlers.onStatus('connecting', 'Conexiune deschisă, se așteaptă date')
    }

    next.onmessage = handleMessage

    next.onerror = () => {
      // `onclose` urmează întotdeauna după `onerror`; reconectarea se face acolo.
      handlers.onStatus('error', 'Eroare de transport')
    }

    next.onclose = (event) => {
      if (socket === next) socket = null
      scheduleReconnect(
        event.reason || `Conexiune închisă (cod ${event.code})`,
      )
    }
  }

  function handleOnline() {
    if (stopped || socket) return
    clearReconnectTimer()
    backoffMs = INITIAL_BACKOFF_MS
    connect()
  }

  return {
    kind: 'websocket',
    describe: url,

    start() {
      if (!stopped) return
      stopped = false
      globalThis.addEventListener?.('online', handleOnline)
      connect()
    },

    stop() {
      stopped = true
      globalThis.removeEventListener?.('online', handleOnline)
      clearReconnectTimer()

      if (socket) {
        const closing = socket
        socket = null
        closing.onopen = null
        closing.onmessage = null
        closing.onerror = null
        closing.onclose = null
        closing.close()
      }

      handlers.onStatus('idle')
    },
  }
}
