import { describe, expect, it } from 'vitest'
import { conditionLabel } from './weather-conditions'

describe('numele stărilor vremii', () => {
  it('înlocuiește traducerea greșită a furnizorului pentru „clear”', () => {
    // Descrierea de mai jos este exact ce a întors furnizorul într-un răspuns
    // real: verbul „a șterge" la imperativ, în loc de starea cerului.
    expect(conditionLabel('CLEAR', 'Ștergeți')).toBe('Senin')
  })

  it('dă același nume aceleiași stări, indiferent de endpoint', () => {
    const dinCondițiiCurente = conditionLabel(
      'MOSTLY_CLEAR',
      'În mare parte însorit',
    )
    const dinPrognoză = conditionLabel(
      'MOSTLY_CLEAR',
      'Cer senin, periodic înnorat',
    )

    expect(dinCondițiiCurente).toBe(dinPrognoză)
    expect(dinCondițiiCurente).toBe('În mare parte senin')
  })

  it('acoperă stările care schimbă decizia din boxă', () => {
    expect(conditionLabel('THUNDERSTORM', null)).toMatch(
      /descărcări electrice/i,
    )
    expect(conditionLabel('HEAVY_RAIN', null)).toBe('Ploaie puternică')
    expect(conditionLabel('CLOUDY', null)).toBe('Înnorat')
    expect(conditionLabel('HAIL', null)).toBe('Grindină')
  })

  it('păstrează descrierea furnizorului pentru un tip necunoscut', () => {
    expect(conditionLabel('TIP_NOU_INVENTAT', 'ceva nou')).toBe('ceva nou')
    expect(conditionLabel(null, 'doar descriere')).toBe('doar descriere')
  })

  it('întoarce null când nu știe nimic — nu presupune o stare', () => {
    expect(conditionLabel(null, null)).toBeNull()
    expect(conditionLabel(undefined, undefined)).toBeNull()
    expect(conditionLabel('TYPE_UNSPECIFIED', '   ')).toBeNull()
  })
})
