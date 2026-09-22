import { useEffect, useRef } from 'react'
import { analytics } from '../lib/analytics'
import { pushDerived } from '../lib/derived-buffer'
import { registerAnalyticsControl } from '../lib/analytics-control'
import { useAnalyticsStore } from '../stores/analytics-store'
import {
  driversHydrated,
  useDriversHydrated,
  useDriverStore,
} from '../stores/driver-store'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Motorul de statistici: leagă fluxul de telemetrie de acumulator, de seriile
 * derivate și de stintul pilotului aflat la volan.
 *
 * Se montează o singură dată, în shell, lângă `useTelemetryStream`. Dacă ar fi
 * montat în pagina de statistici, contoarele ar reporni de fiecare dată când
 * cineva navighează în altă parte — iar bilanțul unei curse de opt ore n-are
 * voie să depindă de ce pagină e deschisă.
 *
 * Ritmuri: acumulatorul primește eșantioane la 5 Hz (destul pentru integrarea
 * puterii, ieftin pentru browser), iar interfața primește snapshot-uri la 2 Hz.
 *
 * În timpul redării unei sesiuni motorul stă: integrează pe ceasul browserului,
 * iar o redare la 10× sau pe pauză ar aduna energie care nu s-a consumat.
 * Redarea are propriul acumulator, condus de `ReplayDriver` la timpul virtual
 * al eșantioanelor, și publică în aceleași store-uri și buffere.
 */

/** Ritmul de acumulare. */
const SAMPLE_INTERVAL_MS = 200
/** Ritmul de publicare către interfață. */
const PUBLISH_INTERVAL_MS = 500

export function useAnalyticsEngine(): void {
  const publish = useAnalyticsStore((state) => state.publish)

  useEffect(() => {
    let lastPublish = 0

    const tick = () => {
      if (useSessionStore.getState().mode !== 'live') return

      const telemetry = useTelemetryStore.getState()
      const now = Date.now()

      analytics.update({ timeMs: now, quality: telemetry.quality })

      const drivers = useDriverStore.getState()
      const context = {
        totals: analytics.totals,
        vehicleId: telemetry.vehicleId,
        sessionId: telemetry.sessionId,
        now,
      }

      // Cineva conduce mașina din momentul în care curg date; dacă nu a fost
      // ales un pilot, se creează unul automat, ca stintul să nu se piardă.
      //
      // Dar nu înainte ca lista de piloți să sosească de la server: până
      // atunci store-ul e gol pentru că nu știm încă, nu pentru că nu există
      // nimeni. Un ecran deschis în timpul cursei ar inventa altfel „Pilot 2"
      // peste pilotul real și ar tăia stintul în curs în două.
      //
      // Numai apelurile către piloți așteaptă; acumulatorul și graficele merg
      // mai departe, fiindcă nu depind de cine e la volan.
      if (driversHydrated()) {
        if (telemetry.latest !== null) drivers.ensureDriver(context)
        drivers.recordTotals(context)
      }

      if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
        lastPublish = now
        const snapshot = analytics.snapshot()
        pushDerived(now, snapshot)
        publish(snapshot, now)
      }
    }

    const timer = setInterval(tick, SAMPLE_INTERVAL_MS)
    const unregister = registerAnalyticsControl({
      totals: () => analytics.totals,
      reset: () => {
        analytics.reset()
        useAnalyticsStore.getState().clear()
      },
    })

    return () => {
      clearInterval(timer)
      unregister()
    }
  }, [publish])

  // Sesiune nouă sau mașină nouă înseamnă altă cursă: contoarele precedente
  // nu au ce căuta în bilanțul ei.
  const sessionId = useTelemetryStore((state) => state.sessionId)
  const vehicleId = useTelemetryStore((state) => state.vehicleId)
  // Ultima sesiune LIVE văzută. În replay, store-ul poartă id-ul sesiunii
  // redate; fără memoria asta, intrarea și ieșirea din replay ar tăia stintul
  // pilotului și ar pune pe zero contoarele cursei în curs, de două ori.
  const lastLiveKey = useRef<string | null>(null)
  // Ca valoare reactivă, nu ca simplă verificare: efectul de mai jos rulează
  // doar când se schimbă sesiunea sau mașina. Dacă piloții sosesc de la server
  // DUPĂ ce au sosit acelea — cazul obișnuit, rețeaua e mai lentă decât
  // primul cadru — o verificare neresctivă ar ieși o dată, devreme, și
  // tăierea stintului nu s-ar mai face niciodată pentru sesiunea aceea.
  const hydrated = useDriversHydrated()

  useEffect(() => {
    if (sessionId === null && vehicleId === null) return
    if (useSessionStore.getState().mode !== 'live') return
    // Aceeași regulă ca mai sus: fără piloții de pe server, tăierea ar lucra
    // pe un stint care încă nu a fost încărcat.
    if (!hydrated) return

    const key = `${vehicleId ?? ''}|${sessionId ?? ''}`
    if (lastLiveKey.current === key) return
    lastLiveKey.current = key

    const drivers = useDriverStore.getState()
    // Stintul în curs se închide cu bilanțul lui și se redeschide pe zero,
    // altfel diferența de contoare ar deveni negativă și s-ar rotunji la zero.
    drivers.splitStint({ totals: analytics.totals, sessionId, vehicleId })

    analytics.reset()
    useAnalyticsStore.getState().clear()
  }, [hydrated, sessionId, vehicleId])
}
