import type { GpsFix } from './gps'
import { telemetryBuffer } from './telemetry-buffer'

/**
 * Reface fixurile GPS din seriile separate ale bufferului de telemetrie.
 *
 * Fiecare semnal este stocat individual, ca serie proprie. Un fix are sens doar
 * cu latitudinea și longitudinea din exact același moment, așa că împerecherea
 * se face pe timp exact, nu pe cel mai apropiat eșantion: o interpolare între
 * două momente ar inventa o poziție în care mașina nu a fost.
 */

/** La 10 Hz, 6000 de puncte înseamnă ultimele zece minute. */
export const FIX_HISTORY_POINTS = 6000

export function collectFixes(limit = FIX_HISTORY_POINTS): GpsFix[] {
  const latitudes = telemetryBuffer.toSeries(
    'gps_latitude_deg',
    undefined,
    limit,
  )
  const longitudes = new Map(
    telemetryBuffer.toSeries('gps_longitude_deg', undefined, limit),
  )
  const altitudes = new Map(
    telemetryBuffer.toSeries('gps_altitude_m', undefined, limit),
  )
  const hdops = new Map(telemetryBuffer.toSeries('gps_hdop', undefined, limit))
  const satellites = new Map(
    telemetryBuffer.toSeries('gps_satellites', undefined, limit),
  )
  const fixQuality = new Map(
    telemetryBuffer.toSeries('gps_fix_quality', undefined, limit),
  )

  const fixes: GpsFix[] = []

  for (const [timeMs, latitude] of latitudes) {
    const longitude = longitudes.get(timeMs)
    if (longitude === undefined) continue

    fixes.push({
      timeMs,
      latitude,
      longitude,
      altitude: altitudes.get(timeMs) ?? null,
      hdop: hdops.get(timeMs) ?? null,
      satellites: satellites.get(timeMs) ?? null,
      fixQuality: fixQuality.get(timeMs) ?? null,
    })
  }

  return fixes
}
