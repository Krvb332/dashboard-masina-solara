import { describe, expect, it } from 'vitest'
import { speedFromFixes, type GpsFix } from './gps'
import { makeSample } from '../test/synthetic'

/**
 * Audit D6: viteza dedusă din două fixuri consecutive.
 *
 * Panoul de verificare a mapării compară viteza raportată cu cea dedusă din
 * ultimele două fixuri, la 0,1 s distanță. La 45 km/h mașina face 1,25 m între
 * ele — sub dispersia unui receptor obișnuit — deci deducerea este dominată de
 * zgomot, nu de mișcare.
 */

function fixesWithNoise(noiseM: number, periodMs: number): GpsFix[] {
  const fixes: GpsFix[] = []
  for (let index = 0; index < 200; index += 1) {
    const sample = makeSample(index, { gpsNoiseM: noiseM, periodMs, seed: 3 })
    fixes.push({
      timeMs: new Date(sample.server_received_at).getTime(),
      latitude: sample.signals.gps_latitude_deg,
      longitude: sample.signals.gps_longitude_deg,
      altitude: sample.signals.gps_altitude_m,
      hdop: 1,
      satellites: 10,
      fixQuality: 1,
    })
  }
  return fixes
}

function mismatchFraction(fixes: GpsFix[], realKph: number): number {
  let mismatches = 0
  let pairs = 0
  for (let index = 1; index < fixes.length; index += 1) {
    const speed = speedFromFixes(fixes[index - 1], fixes[index])
    if (speed === null) continue
    pairs += 1
    if (Math.abs(speed * 3.6 - realKph) / realKph > 0.25) mismatches += 1
  }
  return mismatches / Math.max(1, pairs)
}

describe('viteza din fixuri consecutive (D6)', () => {
  it('control: fără zgomot, viteza dedusă la 0,1 s este cea reală', () => {
    expect(mismatchFraction(fixesWithNoise(0, 100), 45)).toBe(0)
  })

  it('control: cu 1,5 m zgomot dar fixuri la 2 s distanță, verdictul rămâne corect', () => {
    expect(mismatchFraction(fixesWithNoise(1.5, 2000), 45)).toBeLessThan(0.1)
  })

  it.fails(
    'D6 (defect confirmat): cu 1,5 m zgomot la 0,1 s, verdictul de nepotrivire nu este fals în majoritatea cazurilor',
    () => {
      expect(mismatchFraction(fixesWithNoise(1.5, 100), 45)).toBeLessThan(0.1)
    },
  )

  it('măsurătoare: cât de des ar semnala panoul o nepotrivire falsă', () => {
    const at100 = mismatchFraction(fixesWithNoise(1.5, 100), 45)
    const at2000 = mismatchFraction(fixesWithNoise(1.5, 2000), 45)
    console.info(
      `[audit D6] 45 km/h, zgomot ±1,5 m: nepotriviri false ${(at100 * 100).toFixed(0)} % la 0,1 s între fixuri, ${(at2000 * 100).toFixed(0)} % la 2 s`,
    )
    expect(at100).toBeGreaterThanOrEqual(0)
  })
})
