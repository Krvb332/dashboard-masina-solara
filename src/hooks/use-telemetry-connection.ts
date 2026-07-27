import { useEffect } from 'react'
import { env } from '../config/env'
import { createSimulatorSource } from '../lib/simulator-source'
import type { TelemetryHandlers, TelemetrySource } from '../lib/telemetry-source'
import { createWebSocketSource } from '../lib/websocket-source'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Pornește sursa de telemetrie și o leagă de store.
 *
 * Se montează o singură dată, în layoutul aplicației. Cadrele sunt înregistrate
 * la rata plină, dar publicate în React cel mult de `env.uiRefreshHz` ori pe
 * secundă; bucla de publicare rulează independent de sosirea mesajelor, ca
 * ultimul cadru să ajungă în interfață chiar dacă fluxul se oprește imediat
 * după el.
 */
export function useTelemetryConnection(): void {
  const sourceKind = useTelemetryStore((state) => state.sourceKind)

  useEffect(() => {
    const store = useTelemetryStore.getState()

    const handlers: TelemetryHandlers = {
      onFrame: (frame) => useTelemetryStore.getState().ingestFrame(frame),
      onAlarms: (alarms) => useTelemetryStore.getState().setServerAlarms(alarms),
      onStatus: (status, detail) =>
        useTelemetryStore.getState().setStatus(status, detail),
      onInvalid: (reason) => useTelemetryStore.getState().reportInvalid(reason),
    }

    const useWebSocket = sourceKind === 'websocket' && env.wsUrl !== ''
    const source: TelemetrySource = useWebSocket
      ? createWebSocketSource({ url: env.wsUrl, handlers })
      : createSimulatorSource({ handlers, hz: env.uiRefreshHz })

    if (sourceKind === 'websocket' && !useWebSocket) {
      store.setStatus('error', 'VITE_WS_URL nu este configurat')
    }

    store.setSource(source.kind, source.describe)
    source.start()

    const flushTimer = setInterval(
      () => useTelemetryStore.getState().commit(),
      1_000 / env.uiRefreshHz,
    )

    return () => {
      clearInterval(flushTimer)
      source.stop()
    }
  }, [sourceKind])
}
