import { beforeEach, describe, expect, it } from 'vitest'
import { collectFixes } from './gps-buffer'
import { BUFFER_CAPACITY, pushSamples, resetBuffer } from './telemetry-buffer'
import { makeSamples } from '../test/synthetic'

/**
 * Audit D1: împerecherea seriilor GPS după decimare.
 *
 * `collectFixes(limit)` cere fiecare serie separat, cu același `limit`, apoi
 * le împerechează pe timp exact. Când bufferul are mai multe puncte decât
 * `limit`, fiecare serie este decimată independent (min/max pe interval), deci
 * nu mai are aceleași momente de timp ca celelalte. Testul folosește zgomot
 * GNSS realist (±1,5 m): pe date perfect netede extremele coincid și defectul
 * nu se vede.
 */

describe('collectFixes pe buffer plin', () => {
  beforeEach(() => {
    resetBuffer()
    pushSamples(makeSamples(BUFFER_CAPACITY, { gpsNoiseM: 1.5, seed: 11 }))
  })

  it('control: fără decimare, fiecare fix are latitudine, longitudine și altitudine', () => {
    const fixes = collectFixes(BUFFER_CAPACITY)
    expect(fixes).toHaveLength(BUFFER_CAPACITY)
    expect(fixes.every((fix) => fix.altitude !== null)).toBe(true)
    expect(fixes.every((fix) => fix.hdop !== null)).toBe(true)
  })

  it.fails(
    'D1 (defect confirmat): cu limită sub capacitate, harta nu pierde fixuri',
    () => {
      // Harta cere 3000 de puncte (TRAIL_POINTS). Decimarea păstrează min/max,
      // deci ar trebui să întoarcă cel puțin ~3000 de perechi lat/lon.
      const fixes = collectFixes(3000)
      expect(fixes.length).toBeGreaterThanOrEqual(2700)
    },
  )

  it.fails(
    'D1 (defect confirmat): fixurile decimate își păstrează altitudinea și HDOP-ul',
    () => {
      const fixes = collectFixes(3000)
      const withAltitude = fixes.filter((fix) => fix.altitude !== null).length
      const withHdop = fixes.filter((fix) => fix.hdop !== null).length
      // Sub 90 % din fixuri cu altitudine înseamnă că urma colorată după
      // elevație devine gri după zece minute de rulare.
      expect(withAltitude / Math.max(1, fixes.length)).toBeGreaterThan(0.9)
      expect(withHdop / Math.max(1, fixes.length)).toBeGreaterThan(0.9)
    },
  )

  it('măsurătoare: câte fixuri și câte altitudini rămân după decimare', () => {
    const fixes = collectFixes(3000)
    const withAltitude = fixes.filter((fix) => fix.altitude !== null).length
    const withHdop = fixes.filter((fix) => fix.hdop !== null).length
    console.info(
      `[audit D1] buffer=${BUFFER_CAPACITY} limit=3000 → fixuri=${fixes.length}, cu altitudine=${withAltitude}, cu HDOP=${withHdop}`,
    )
    expect(fixes.length).toBeGreaterThan(0)
  })
})
