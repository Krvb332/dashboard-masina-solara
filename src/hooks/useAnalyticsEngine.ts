import { useEffect } from 'react'
import { analytics } from '../lib/analytics'
import { pushDerived } from '../lib/derived-buffer'
import { registerAnalyticsControl } from '../lib/analytics-control'
import { useAnalyticsStore } from '../stores/analytics-store'
import { useDriverStore } from '../stores/driver-store'
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
      if (telemetry.latest !== null) drivers.ensureDriver(context)
      drivers.recordTotals(context)

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

  useEffect(() => {
    if (sessionId === null && vehicleId === null) return

    const drivers = useDriverStore.getState()
    // Stintul în curs se închide cu bilanțul lui și se redeschide pe zero,
    // altfel diferența de contoare ar deveni negativă și s-ar rotunji la zero.
    drivers.splitStint({ totals: analytics.totals, sessionId, vehicleId })

    analytics.reset()
    useAnalyticsStore.getState().clear()
  }, [sessionId, vehicleId])
}
