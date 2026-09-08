import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebSocketSource } from './websocket-source'
import type { ConnectionStatus, TelemetryHandlers } from './telemetry-source'

/** WebSocket minimal, controlabil din teste. */
class FakeSocket {
  static instances: FakeSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  closed = false
  url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  close() {
    this.closed = true
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }

  emitRaw(data: string) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

const validFrame = {
  schema_version: 1,
  vehicle_id: 'tucn-solar-01',
  session_id: 'test',
  timestamp: '2026-07-27T10:00:00.000Z',
  sequence: 1,
  signals: { battery_soc_pct: 76.2 },
}

function setup() {
  const frames: unknown[] = []
  const statuses: ConnectionStatus[] = []
  const invalid: string[] = []
  const alarms: unknown[] = []

  const handlers: TelemetryHandlers = {
    onFrame: (frame) => frames.push(frame),
    onAlarms: (list) => alarms.push(...list),
    onStatus: (status) => statuses.push(status),
    onInvalid: (reason) => invalid.push(reason),
  }

  const source = createWebSocketSource({
    url: 'ws://localhost:8000/ws/telemetry',
    handlers,
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
  })

  return { source, frames, statuses, invalid, alarms }
}

describe('createWebSocketSource', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('raportează „connected" abia după primul mesaj valid', () => {
    const { source, statuses } = setup()
    source.start()

    const socket = FakeSocket.instances[0]!
    socket.onopen?.()
    expect(statuses).not.toContain('connected')

    socket.emit(validFrame)
    expect(statuses).toContain('connected')

    source.stop()
  })

  it('transmite cadrele validate mai departe', () => {
    const { source, frames } = setup()
    source.start()

    FakeSocket.instances[0]!.emit(validFrame)

    expect(frames).toEqual([validFrame])
    source.stop()
  })

  it('acceptă și forma cu plic', () => {
    const { source, frames, alarms } = setup()
    source.start()

    const socket = FakeSocket.instances[0]!
    socket.emit({ type: 'telemetry', frame: validFrame })
    socket.emit({
      type: 'alarms',
      alarms: [{ id: 'a', severity: 'warning', title: 'Test' }],
    })

    expect(frames).toEqual([validFrame])
    expect(alarms).toHaveLength(1)
    source.stop()
  })

  it('respinge mesajele care nu trec de schemă, fără să cadă', () => {
    const { source, frames, invalid } = setup()
    source.start()

    const socket = FakeSocket.instances[0]!
    socket.emitRaw('{ nu este json }')
    socket.emit({ schema_version: 1 })
    socket.emit(validFrame)

    expect(invalid).toHaveLength(2)
    expect(frames).toEqual([validFrame])
    source.stop()
  })

  it('reconectează cu backoff după închiderea conexiunii', () => {
    const { source, statuses } = setup()
    source.start()

    FakeSocket.instances[0]!.onclose?.({ code: 1006, reason: '' })
    expect(statuses).toContain('reconnecting')
    expect(FakeSocket.instances).toHaveLength(1)

    // Prima reîncercare are loc după cel mult 1 s (500 ms plus jitter).
    vi.advanceTimersByTime(1_000)
    expect(FakeSocket.instances).toHaveLength(2)

    source.stop()
  })

  it('crește intervalul dintre reîncercări la eșecuri repetate', () => {
    const { source } = setup()
    source.start()

    for (let attempt = 0; attempt < 4; attempt += 1) {
      FakeSocket.instances.at(-1)!.onclose?.({ code: 1006, reason: '' })
      vi.advanceTimersByTime(1_000)
    }

    // Cu backoff, al patrulea interval depășește deja o secundă, deci nu s-au
    // deschis patru conexiuni noi în patru secunde.
    expect(FakeSocket.instances.length).toBeLessThan(5)
    source.stop()
  })

  it('nu mai reconectează după stop', () => {
    const { source } = setup()
    source.start()

    const socket = FakeSocket.instances[0]!
    source.stop()
    expect(socket.closed).toBe(true)

    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
