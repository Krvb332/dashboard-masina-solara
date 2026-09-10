import { describe, expect, it } from 'vitest'
import { emptySnapshot, type AnalyticsSnapshot } from './analytics'
import { buildAdvice, primaryAdvice, sustainableWhPerKm } from './coaching'

/**
 * Recomandările sunt singurul loc din dashboard care îi spune pilotului ce să
 * facă. Două riscuri de evitat: să tacă atunci când chiar există o problemă și
 * să vorbească atunci când nu are date. Testele acoperă ambele direcții.
 */

function snapshot(
  overrides: Partial<AnalyticsSnapshot> = {},
): AnalyticsSnapshot {
  const base = emptySnapshot()
  return {
    ...base,
    live: true,
    // O sesiune care chiar rulează: viteza medie contează doar dacă există
    // eșantioane în spatele ei.
    totals: { ...base.totals, samples: 500, ...(overrides.totals ?? {}) },
    ...overrides,
  }
}

const ids = (snapshotValue: AnalyticsSnapshot, options = {}) =>
  buildAdvice(snapshotValue, options).map((advice) => advice.id)

describe('pragul de echilibru solar', () => {
  it('900 W la 45 km/h susțin 20 Wh/km', () => {
    expect(sustainableWhPerKm(900, 45)).toBe(20)
  })

  it('la mașina oprită pragul nu are sens', () => {
    expect(sustainableWhPerKm(900, 0)).toBeNull()
    expect(sustainableWhPerKm(null, 45)).toBeNull()
  })
})

describe('fără flux', () => {
  it('nu se dă niciun sfat pe baza unor date care nu mai vin', () => {
    expect(buildAdvice(emptySnapshot())).toEqual([])
    expect(primaryAdvice([])).toBeNull()
  })

  it('un snapshot mort nu produce sfaturi nici cu o strategie configurată', () => {
    expect(
      buildAdvice(emptySnapshot(), {
        targetWhPerKm: 18,
        remainingDistanceKm: 200,
      }),
    ).toEqual([])
  })
})

describe('consum peste ce produc panourile', () => {
  it('semnalează depășirea pragului de echilibru', () => {
    const result = ids(
      snapshot({
        recentWhPerKm: 40,
        solarW: 900,
        averageSpeedKph: 45,
        totals: { ...emptySnapshot().totals, samples: 500 },
      }),
    )
    // 900 W la 45 km/h susțin 20 Wh/km; 40 este dublul.
    expect(result).toContain('energy-deficit')
  })

  it('tace când consumul este sub prag', () => {
    const result = ids(
      snapshot({
        recentWhPerKm: 18,
        solarW: 900,
        averageSpeedKph: 45,
        totals: { ...emptySnapshot().totals, samples: 500 },
      }),
    )
    expect(result).not.toContain('energy-deficit')
    expect(result).toContain('on-target')
  })

  it('ținta de strategie se aplică doar când nu există deja un deficit solar', () => {
    const result = ids(
      snapshot({
        recentWhPerKm: 25,
        solarW: null,
        averageSpeedKph: 45,
        totals: { ...emptySnapshot().totals, samples: 500 },
      }),
      { targetWhPerKm: 18 },
    )
    expect(result).toContain('over-target')
    expect(result).not.toContain('energy-deficit')
  })
})

describe('autonomie și baterie', () => {
  it('avertizează critic când energia nu acoperă distanța rămasă', () => {
    const advice = buildAdvice(
      snapshot({ rangeKm: 60, recentWhPerKm: 22, averageSpeedKph: 45 }),
      { remainingDistanceKm: 120 },
    )

    const entry = advice.find((item) => item.id === 'range-short')
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('critical')
    // Cifra din spatele afirmației trebuie să fie în text.
    expect(entry?.detail).toContain('60,0')
    expect(entry?.detail).toContain('120,0')
  })

  it('tace când autonomia acoperă distanța', () => {
    const result = ids(
      snapshot({ rangeKm: 200, recentWhPerKm: 18, averageSpeedKph: 45 }),
      { remainingDistanceKm: 120 },
    )
    expect(result).not.toContain('range-short')
  })

  it('semnalează o baterie care se golește prea repede', () => {
    const result = ids(
      snapshot({
        socPct: 22,
        socRatePctPerMin: -0.6,
        projectedSoc30MinPct: 4,
        recentWhPerKm: 20,
        averageSpeedKph: 45,
      }),
    )
    expect(result).toContain('soc-drop')
  })

  it('o baterie care se încarcă nu declanșează avertizarea', () => {
    const result = ids(
      snapshot({
        socPct: 8,
        socRatePctPerMin: 0.4,
        projectedSoc30MinPct: 9,
        recentWhPerKm: 20,
        averageSpeedKph: 45,
      }),
    )
    expect(result).not.toContain('soc-drop')
  })
})

describe('stil de condus', () => {
  it('explică pilotului că viteza, nu masa, costă energie', () => {
    const result = ids(
      snapshot({
        aeroSharePct: 72,
        economicSpeedKph: 24,
        averageSpeedKph: 60,
        recentWhPerKm: 20,
      }),
    )
    expect(result).toContain('aero-dominant')
  })

  it('semnalează frânările irosite', () => {
    const base = emptySnapshot()
    const result = ids(
      snapshot({
        totals: { ...base.totals, harshBrakeCount: 14 },
        regenRatioPct: 1,
        recentWhPerKm: 20,
        averageSpeedKph: 45,
      }),
    )
    expect(result).toContain('regen-unused')
  })

  it('nu reproșează frânările când recuperarea chiar funcționează', () => {
    const base = emptySnapshot()
    const result = ids(
      snapshot({
        totals: { ...base.totals, harshBrakeCount: 14 },
        regenRatioPct: 12,
        recentWhPerKm: 20,
        averageSpeedKph: 45,
      }),
    )
    expect(result).not.toContain('regen-unused')
  })

  it('semnalează o pedală nervoasă', () => {
    const result = ids(
      snapshot({
        smoothnessScore: 30,
        recentWhPerKm: 20,
        averageSpeedKph: 45,
      }),
    )
    expect(result).toContain('rough-throttle')
  })
})

describe('temperaturi', () => {
  it('avertizează când pragul critic este la mai puțin de cinci minute', () => {
    const advice = buildAdvice(
      snapshot({
        recentWhPerKm: 20,
        averageSpeedKph: 45,
        thermal: [
          {
            key: 'motor_temp_c',
            valueC: 98,
            ratePerMinC: 4,
            headroomPct: 60,
            timeToCritS: 180,
          },
        ],
      }),
    )

    const entry = advice.find((item) => item.id === 'thermal-motor_temp_c')
    expect(entry).toBeDefined()
    expect(entry?.title).toContain('Motorul')
    expect(entry?.detail).toContain('3 min')
  })

  it('nu avertizează pentru o temperatură care urcă lent', () => {
    const result = ids(
      snapshot({
        recentWhPerKm: 20,
        averageSpeedKph: 45,
        thermal: [
          {
            key: 'motor_temp_c',
            valueC: 80,
            ratePerMinC: 0.2,
            headroomPct: 100,
            timeToCritS: 9000,
          },
        ],
      }),
    )
    expect(result).not.toContain('thermal-motor_temp_c')
  })
})

describe('ordinea sfaturilor', () => {
  it('cel mai grav ajunge primul, indiferent de ordinea generării', () => {
    const advice = buildAdvice(
      snapshot({
        rangeKm: 50,
        recentWhPerKm: 40,
        solarW: 900,
        averageSpeedKph: 45,
        smoothnessScore: 20,
      }),
      { remainingDistanceKm: 150 },
    )

    expect(advice.length).toBeGreaterThan(1)
    expect(primaryAdvice(advice)?.level).toBe('critical')
    expect(primaryAdvice(advice)?.id).toBe('range-short')
  })

  it('cu totul în regulă rămâne un singur mesaj, de confirmare', () => {
    const advice = buildAdvice(
      snapshot({
        recentWhPerKm: 16,
        solarW: 900,
        averageSpeedKph: 45,
        smoothnessScore: 92,
      }),
    )

    expect(advice).toHaveLength(1)
    expect(advice[0].level).toBe('good')
  })

  it('fără distanță parcursă, mesajul spune că se strâng date', () => {
    const advice = buildAdvice(snapshot({ recentWhPerKm: null, whPerKm: null }))
    expect(advice).toHaveLength(1)
    expect(advice[0].id).toBe('warming-up')
  })

  it('fiecare sfat vine cu o acțiune concretă, nu doar cu o constatare', () => {
    const advice = buildAdvice(
      snapshot({
        rangeKm: 50,
        recentWhPerKm: 40,
        solarW: 900,
        averageSpeedKph: 45,
        smoothnessScore: 20,
      }),
      { remainingDistanceKm: 150 },
    )

    for (const entry of advice) {
      expect(entry.action.length).toBeGreaterThan(10)
      expect(entry.detail.length).toBeGreaterThan(10)
    }
  })
})
