import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { API_TOKEN, WS_URL, fetchCatalog } from '../lib/api'
import { pushSample, pushSamples, resetBuffer } from '../lib/telemetry-buffer'
import { TelemetryClient } from '../lib/ws-client'
import type { TelemetryFrame } from '../schemas/telemetry'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Conectează aplicația la fluxul live. Se montează o singură dată, în shell.
 *
 * Datele curg pe două benzi cu ritmuri diferite:
 *  - eșantioanele intră în bufferul de serii temporale imediat ce sosesc, ca
 *    graficele să fie fluide;
 *  - store-ul React este actualizat la ~5 Hz, pentru că textul citit de om nu
 *    are nevoie de mai mult, iar re-randarea la 10 Hz a întregii pagini este
 *    risipă curată.
 */

const STORE_INTERVAL_MS = 200

export function useTelemetryStream(): void {
  const setConnection = useTelemetryStore((state) => state.setConnection)
  const applyFrame = useTelemetryStore((state) => state.applyFrame)
  const countInvalidFrame = useTelemetryStore(
    (state) => state.countInvalidFrame,
  )
  const setCatalog = useTelemetryStore((state) => state.setCatalog)

  const pendingFrame = useRef<TelemetryFrame | null>(null)
  const lastPushedAt = useRef<string | null>(null)

  const { data: catalog } = useQuery({
    queryKey: ['signal-catalog'],
    queryFn: fetchCatalog,
    staleTime: Infinity,
    retry: 3,
  })

  useEffect(() => {
    if (catalog) setCatalog(catalog.signals)
  }, [catalog, setCatalog])

  useEffect(() => {
    const client = new TelemetryClient({
      url: WS_URL,
      token: API_TOKEN || undefined,
      onState: setConnection,
      onInvalid: () => countInvalidFrame(),

      onFrame: (frame) => {
        // În timpul redării unei sesiuni, fluxul live rămâne conectat, dar nu
        // are voie să scrie peste ce se redă.
        if (useSessionStore.getState().mode !== 'live') return

        if (frame.type === 'snapshot') {
          resetBuffer()
          pushSamples(frame.history)
          lastPushedAt.current =
            frame.history.at(-1)?.server_received_at ?? null
        } else if (
          frame.latest &&
          frame.latest.server_received_at !== lastPushedAt.current
        ) {
          // Serverul retrimite ultima stare cunoscută chiar dacă mașina a
          // amuțit; fără verificarea asta am adăuga puncte false în grafic.
          pushSample(frame.latest)
          lastPushedAt.current = frame.latest.server_received_at
        }

        pendingFrame.current = frame
      },

      onBackfill: (samples) => {
        if (useSessionStore.getState().mode !== 'live') return
        pushSamples(samples)
        lastPushedAt.current = samples.at(-1)?.server_received_at ?? null
      },
    })

    client.connect()

    const timer = setInterval(() => {
      const frame = pendingFrame.current
      if (frame === null) return
      pendingFrame.current = null
      applyFrame(frame)
    }, STORE_INTERVAL_MS)

    return () => {
      clearInterval(timer)
      client.close()
    }
  }, [applyFrame, countInvalidFrame, setConnection])
}
