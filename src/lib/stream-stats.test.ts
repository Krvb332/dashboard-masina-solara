import { describe, expect, it } from 'vitest'
import { EMPTY_STATS, type StreamStats } from '../schemas/telemetry'
import { subtractStats } from './stream-stats'

const stats = (overrides: Partial<StreamStats>): StreamStats => ({
  ...EMPTY_STATS,
  ...overrides,
})

describe('subtractStats', () => {
  it('lasă contoarele neatinse fără linie de bază', () => {
    const current = stats({ received: 357, dropped: 9 })
    expect(subtractStats(current, null)).toEqual(current)
  })

  it('raportează contoarele la momentul resetării', () => {
    const adjusted = subtractStats(
      stats({ received: 400, dropped: 12, duplicates: 4, invalid: 1 }),
      stats({ received: 357, dropped: 9, duplicates: 4, invalid: 1 }),
    )

    expect(adjusted.received).toBe(43)
    expect(adjusted.dropped).toBe(3)
    expect(adjusted.duplicates).toBe(0)
    expect(adjusted.invalid).toBe(0)
  })

  it('nu atinge valorile instantanee', () => {
    const adjusted = subtractStats(
      stats({ received: 400, effective_hz: 9.8, last_sequence: 4001 }),
      stats({ received: 357, effective_hz: 4.1, last_sequence: 3800 }),
    )

    // Frecvența și ultima secvență descriu prezentul, nu o acumulare.
    expect(adjusted.effective_hz).toBe(9.8)
    expect(adjusted.last_sequence).toBe(4001)
  })

  it('renunță la linia de bază când serverul repornește', () => {
    // Contoare mai mici decât linia de bază înseamnă un server nou; altfel
    // afișajul ar rămâne blocat pe zero la nesfârșit.
    const current = stats({ received: 12, dropped: 0 })
    expect(
      subtractStats(current, stats({ received: 357, dropped: 9 })),
    ).toEqual(current)
  })
})
