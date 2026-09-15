import { bench, describe } from 'vitest'
import {
  anchorStationary,
  elevationProfile,
  inspectFixes,
  trackLengthMeters,
} from './gps'
import { collectFixes } from './gps-buffer'
import {
  BUFFER_CAPACITY,
  pushSamples,
  resetBuffer,
  telemetryBuffer,
} from './telemetry-buffer'
import { projectTrack, type Position } from './track-projection'
import { makeSamples } from '../test/synthetic'

/**
 * Audit P1: lanțul de date al hărții, fără desen.
 *
 * `TrackMap.render` rulează la 10 Hz și reface de fiecare dată: fixuri din
 * buffer, ancorare, proiecție. Bugetul unui cadru la 10 Hz este 100 ms, iar
 * harta împarte firul principal cu graficele și cu React.
 */

resetBuffer()
pushSamples(makeSamples(BUFFER_CAPACITY, { gpsNoiseM: 1.5 }))

function trackMapData(): Position[] {
  const speedByTime = new Map(
    telemetryBuffer.toSeries('vehicle_speed_kph', undefined, 3000),
  )
  return anchorStationary(collectFixes(3000)).map((fix) => ({
    lat: fix.latitude,
    lon: fix.longitude,
    speed: speedByTime.get(fix.timeMs) ?? 0,
    ...(fix.altitude === undefined || fix.altitude === null
      ? {}
      : { elevation: fix.altitude }),
  }))
}

describe('lanțul hărții GPS pe buffer plin (10 minute)', () => {
  bench(
    'TrackMap.render fără canvas: collectFixes(3000) + anchorStationary + projectTrack',
    () => {
      projectTrack(trackMapData(), 800, 420, 18)
    },
  )

  bench('anchorStationary singur, pe 6000 de fixuri', () => {
    anchorStationary(collectFixes())
  })

  bench(
    'ElevationProfile.draw: elevationProfile(anchorStationary(collectFixes()))',
    () => {
      elevationProfile(anchorStationary(collectFixes()))
    },
  )

  bench(
    'GpsMappingPanel: inspectFixes + anchorStationary + elevationProfile + trackLengthMeters',
    () => {
      const fixes = collectFixes()
      inspectFixes(fixes)
      const anchored = anchorStationary(fixes)
      elevationProfile(anchored)
      trackLengthMeters(anchored)
    },
  )
})
