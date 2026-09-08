import { describe, expect, it } from 'vitest'
import { backoffDelay } from './ws-client'

describe('backoffDelay', () => {
  it('crește exponențial cu numărul de încercări', () => {
    const fixed = () => 0.5 // fără jitter, ca să comparăm valorile de bază

    expect(backoffDelay(0, fixed)).toBe(250)
    expect(backoffDelay(1, fixed)).toBe(500)
    expect(backoffDelay(2, fixed)).toBe(1000)
    expect(backoffDelay(3, fixed)).toBe(2000)
  })

  it('se plafonează la cinci secunde', () => {
    const fixed = () => 0.5
    expect(backoffDelay(20, fixed)).toBe(5000)
  })

  it('adaugă jitter în jurul valorii de bază', () => {
    // Jitterul împrăștie reconectările: dacă toate tabletele din pitlane
    // repornesc simultan, nu trebuie să lovească serverul în același moment.
    expect(backoffDelay(2, () => 0)).toBe(750)
    expect(backoffDelay(2, () => 1)).toBe(1250)
  })

  it('nu întoarce niciodată valori negative', () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(backoffDelay(attempt, () => 0)).toBeGreaterThan(0)
    }
  })
})
