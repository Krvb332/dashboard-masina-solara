import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_TOTALS, type AnalyticsTotals } from '../lib/analytics'
import { initialsFor } from '../lib/driver-profiles'
import { safeStorage } from '../lib/safe-storage'
import {
  DRIVER_STORAGE_KEY,
  resetDriverStore,
  useDriverStore,
} from './driver-store'

/**
 * Ce apără testele de aici: energia unui pilot nu are voie să se piardă la
 * schimbul de la volan și nici să se amestece cu a următorului. Contoarele sunt
 * globale pe sesiune, deci corectitudinea depinde în întregime de linia de bază
 * reținută la urcarea în mașină.
 */

function totals(overrides: Partial<AnalyticsTotals> = {}): AnalyticsTotals {
  return { ...EMPTY_TOTALS, ...overrides }
}

function context(overrides: Partial<AnalyticsTotals> = {}, now = 1000) {
  return {
    totals: totals(overrides),
    now,
    vehicleId: 'solar-car-01',
    sessionId: 'race-1',
  }
}

const store = () => useDriverStore.getState()

beforeEach(() => {
  safeStorage().removeItem(DRIVER_STORAGE_KEY)
  resetDriverStore()
})

describe('crearea profilurilor', () => {
  it('creează manual un pilot, cu inițiale și culoare', () => {
    const profile = store().createProfile('Andrei Pop')

    expect(profile.name).toBe('Andrei Pop')
    expect(profile.shortName).toBe('AP')
    expect(profile.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(profile.auto).toBe(false)
    expect(store().profiles).toHaveLength(1)
  })

  it('creează tot lotul dintr-o listă de nume', () => {
    const created = store().importRoster([
      'Andrei Pop',
      'Maria Ionescu',
      'Vlad Dumitru',
    ])

    expect(created).toHaveLength(3)
    expect(store().profiles.map((profile) => profile.name)).toEqual([
      'Andrei Pop',
      'Maria Ionescu',
      'Vlad Dumitru',
    ])
  })

  it('reimportarea aceleiași liste nu dublează piloții', () => {
    store().importRoster(['Andrei Pop', 'Maria Ionescu'])
    const again = store().importRoster([
      '  andrei pop  ',
      'Maria Ionescu',
      'Vlad Dumitru',
      '',
    ])

    expect(again).toHaveLength(1)
    expect(store().profiles).toHaveLength(3)
  })

  it('fiecare pilot primește altă culoare, în ordinea adăugării', () => {
    store().importRoster(['A B', 'C D', 'E F'])
    const colors = store().profiles.map((profile) => profile.color)
    expect(new Set(colors).size).toBe(3)
  })

  it('inițialele funcționează și pentru un singur cuvânt', () => {
    expect(initialsFor('Pilot 2')).toBe('P2')
    expect(initialsFor('Andrei')).toBe('AI')
    expect(initialsFor('   ')).toBe('??')
  })
})

describe('crearea automată', () => {
  it('la primul flux se creează singur un pilot și i se deschide stintul', () => {
    const id = store().ensureDriver(context())

    expect(id).not.toBeNull()
    expect(store().profiles).toHaveLength(1)
    expect(store().profiles[0].name).toBe('Pilot 1')
    expect(store().profiles[0].auto).toBe(true)
    expect(store().stints).toHaveLength(1)
    expect(store().activeStintId).toBe(store().stints[0].id)
  })

  it('nu inventează un pilot nou dacă lotul există deja', () => {
    store().importRoster(['Andrei Pop', 'Maria Ionescu'])
    const id = store().ensureDriver(context())

    expect(store().profiles).toHaveLength(2)
    expect(id).toBe(store().profiles[0].id)
  })

  it('apelarea repetată nu deschide stinturi în plus', () => {
    store().ensureDriver(context())
    store().ensureDriver(context({}, 2000))
    store().ensureDriver(context({}, 3000))

    expect(store().stints).toHaveLength(1)
  })

  it('crearea automată poate fi oprită', () => {
    store().setAutoCreate(false)
    const id = store().ensureDriver(context())

    expect(id).toBeNull()
    expect(store().profiles).toHaveLength(0)
    expect(store().stints).toHaveLength(0)
  })

  it('redenumirea unui pilot automat îl scoate din categoria „automat”', () => {
    store().ensureDriver(context())
    const id = store().profiles[0].id

    store().renameProfile(id, 'Andrei Pop')

    expect(store().profiles[0].name).toBe('Andrei Pop')
    expect(store().profiles[0].shortName).toBe('AP')
    expect(store().profiles[0].auto).toBe(false)
    expect(store().stints[0].driverName).toBe('Andrei Pop')
  })
})

describe('schimbarea pilotului', () => {
  it('închide stintul precedent cu datele lui și îl deschide pe următorul', () => {
    const [first, second] = store().importRoster([
      'Andrei Pop',
      'Maria Ionescu',
    ])

    store().selectDriver(first.id, context({}, 1000))
    store().recordTotals(
      context(
        { distanceKm: 12, energyConsumedWh: 240, activeSeconds: 900 },
        4000,
      ),
    )

    // Schimbul de pilot: contoarele globale sunt deja la 12 km și 240 Wh.
    store().selectDriver(
      second.id,
      context(
        { distanceKm: 12, energyConsumedWh: 240, activeSeconds: 900 },
        5000,
      ),
    )

    const stints = store().stints
    expect(stints).toHaveLength(2)

    const closed = stints[0]
    expect(closed.driverId).toBe(first.id)
    expect(closed.endedAt).toBe(5000)
    expect(closed.summary.distanceKm).toBeCloseTo(12, 9)
    expect(closed.summary.energyConsumedWh).toBeCloseTo(240, 9)
    expect(closed.summary.whPerKm).toBeCloseTo(20, 9)

    const open = stints[1]
    expect(open.driverId).toBe(second.id)
    expect(open.endedAt).toBeNull()
    expect(open.baseline.distanceKm).toBeCloseTo(12, 9)
    expect(open.summary.distanceKm).toBe(0)
  })

  it('al doilea pilot primește doar ce a consumat el', () => {
    const [first, second] = store().importRoster([
      'Andrei Pop',
      'Maria Ionescu',
    ])

    store().selectDriver(first.id, context({}, 1000))
    store().selectDriver(
      second.id,
      context({ distanceKm: 12, energyConsumedWh: 240 }, 5000),
    )
    store().recordTotals(
      context(
        { distanceKm: 20, energyConsumedWh: 440, activeSeconds: 1500 },
        9000,
      ),
    )

    const open = store().stints[1]
    expect(open.summary.distanceKm).toBeCloseTo(8, 9)
    expect(open.summary.energyConsumedWh).toBeCloseTo(200, 9)
    expect(open.summary.whPerKm).toBeCloseTo(25, 9)
  })

  it('reselectarea aceluiași pilot nu taie stintul în două', () => {
    const [first] = store().importRoster(['Andrei Pop'])
    store().selectDriver(first.id, context({}, 1000))
    store().selectDriver(first.id, context({ distanceKm: 5 }, 3000))

    expect(store().stints).toHaveLength(1)
  })

  it('coborârea din mașină închide stintul și lasă volanul liber', () => {
    const [first] = store().importRoster(['Andrei Pop'])
    store().selectDriver(first.id, context({}, 1000))
    store().endStint(context({ distanceKm: 7, energyConsumedWh: 175 }, 6000))

    expect(store().activeDriverId).toBeNull()
    expect(store().activeStintId).toBeNull()
    expect(store().stints[0].endedAt).toBe(6000)
    expect(store().stints[0].summary.whPerKm).toBeCloseTo(25, 9)
  })
})

describe('tăierea stintului la resetarea contoarelor', () => {
  it('păstrează ce s-a consumat și repornește de la zero', () => {
    const [first] = store().importRoster(['Andrei Pop'])
    store().selectDriver(first.id, context({}, 1000))
    store().recordTotals(
      context({ distanceKm: 9, energyConsumedWh: 180 }, 4000),
    )

    store().splitStint(context({ distanceKm: 9, energyConsumedWh: 180 }, 5000))

    expect(store().stints).toHaveLength(2)
    expect(store().stints[0].summary.distanceKm).toBeCloseTo(9, 9)
    expect(store().stints[1].baseline.distanceKm).toBe(0)
    expect(store().stints[1].driverId).toBe(first.id)
    expect(store().activeStintId).toBe(store().stints[1].id)
  })

  it('fără stint activ nu se creează unul din nimic', () => {
    store().splitStint(context({ distanceKm: 9 }, 5000))
    expect(store().stints).toHaveLength(0)
  })

  it('un stint în care nu s-a acumulat nimic este rebazat, nu tăiat', () => {
    const [first] = store().importRoster(['Andrei Pop'])
    store().selectDriver(first.id, context({}, 1000))

    // Cazul de la pornirea unei sesiuni: contoarele sunt încă zero.
    store().splitStint(context({}, 2000))

    expect(store().stints).toHaveLength(1)
    expect(store().stints[0].endedAt).toBeNull()
    expect(store().stints[0].baseline.distanceKm).toBe(0)
  })
})

describe('reîncărcarea paginii în mijlocul cursei', () => {
  it('bilanțul stintului nu se pierde când acumulatorul repornește de la zero', () => {
    const [first] = store().importRoster(['Andrei Pop'])
    store().selectDriver(first.id, context({}, 1000))
    store().recordTotals(
      context(
        { distanceKm: 42, energyConsumedWh: 900, activeSeconds: 3600 },
        4000,
      ),
    )

    const inainte = store().stints[0].summary
    expect(inainte.distanceKm).toBeCloseTo(42, 9)

    // F5: stinturile vin din stocare, contoarele repornesc de la zero.
    store().recordTotals(context({}, 5000))

    expect(store().stints[0].summary.distanceKm).toBeCloseTo(42, 9)
    expect(store().stints[0].summary.energyConsumedWh).toBeCloseTo(900, 9)
  })

  it('tăierea de după reîncărcare păstrează bilanțul măsurat', () => {
    const [first] = store().importRoster(['Andrei Pop'])
    store().selectDriver(first.id, context({}, 1000))
    store().recordTotals(
      context(
        { distanceKm: 42, energyConsumedWh: 900, activeSeconds: 3600 },
        4000,
      ),
    )

    store().splitStint(context({}, 6000))

    expect(store().stints).toHaveLength(2)
    // Stintul vechi își păstrează cursa, cel nou pornește curat.
    expect(store().stints[0].summary.distanceKm).toBeCloseTo(42, 9)
    expect(store().stints[0].endedAt).toBe(6000)
    expect(store().stints[1].summary.distanceKm).toBe(0)
    expect(store().stints[1].endedAt).toBeNull()

    // Cumulul pilotului rămâne întreg.
    expect(store().aggregate(first.id).distanceKm).toBeCloseTo(42, 9)
  })

  it('schimbarea pilotului după reîncărcare nu îl păgubește pe cel care coboară', () => {
    const [first, second] = store().importRoster([
      'Andrei Pop',
      'Maria Ionescu',
    ])
    store().selectDriver(first.id, context({}, 1000))
    store().recordTotals(
      context(
        { distanceKm: 30, energyConsumedWh: 600, activeSeconds: 2400 },
        4000,
      ),
    )

    store().selectDriver(second.id, context({}, 7000))

    expect(store().stints[0].summary.distanceKm).toBeCloseTo(30, 9)
    expect(store().aggregate(first.id).whPerKm).toBeCloseTo(20, 9)
  })
})

describe('cumulul pe pilot', () => {
  it('adună toate stinturile aceluiași pilot', () => {
    const [first, second] = store().importRoster([
      'Andrei Pop',
      'Maria Ionescu',
    ])

    store().selectDriver(first.id, context({}, 1000))
    store().selectDriver(
      second.id,
      context(
        { distanceKm: 10, energyConsumedWh: 200, activeSeconds: 600 },
        2000,
      ),
    )
    store().selectDriver(
      first.id,
      context(
        { distanceKm: 25, energyConsumedWh: 600, activeSeconds: 1500 },
        3000,
      ),
    )
    store().endStint(
      context(
        { distanceKm: 35, energyConsumedWh: 800, activeSeconds: 2100 },
        4000,
      ),
    )

    const andrei = store().aggregate(first.id)
    expect(andrei.stints).toBe(2)
    // 10 km în primul stint, 10 km în al treilea.
    expect(andrei.distanceKm).toBeCloseTo(20, 9)
    expect(andrei.energyConsumedWh).toBeCloseTo(400, 9)
    expect(andrei.whPerKm).toBeCloseTo(20, 9)

    const maria = store().aggregate(second.id)
    expect(maria.stints).toBe(1)
    expect(maria.distanceKm).toBeCloseTo(15, 9)
    expect(maria.whPerKm).toBeCloseTo(400 / 15, 9)
  })

  it('cel mai bun consum ignoră stinturile prea scurte', () => {
    const [first, second] = store().importRoster([
      'Andrei Pop',
      'Maria Ionescu',
    ])

    store().selectDriver(first.id, context({}, 1000))
    // Primul stint: 100 m cu 10 Wh, adică 100 Wh/km. Prea scurt ca să conteze —
    // o urcare în mașină de zece secunde nu este un record de eficiență.
    store().selectDriver(
      second.id,
      context({ distanceKm: 0.1, energyConsumedWh: 10 }, 2000),
    )
    store().selectDriver(
      first.id,
      context({ distanceKm: 0.1, energyConsumedWh: 10 }, 3000),
    )
    // Al doilea stint al lui Andrei: 10 km cu 200 Wh, adică 20 Wh/km.
    store().endStint(context({ distanceKm: 10.1, energyConsumedWh: 210 }, 4000))

    const andrei = store().aggregate(first.id)
    expect(andrei.stints).toBe(2)
    expect(andrei.bestWhPerKm).toBeCloseTo(20, 9)
  })

  it('ștergerea unui profil nu șterge energia măsurată', () => {
    const [first] = store().importRoster(['Andrei Pop'])
    store().selectDriver(first.id, context({}, 1000))
    store().endStint(context({ distanceKm: 5, energyConsumedWh: 100 }, 2000))

    store().removeProfile(first.id)

    expect(store().profiles).toHaveLength(0)
    expect(store().stints).toHaveLength(1)
    expect(store().aggregate(first.id).distanceKm).toBeCloseTo(5, 9)
  })

  it('ștergerea unui pilot aflat la volan îi închide stintul deschis', () => {
    const [first] = store().importRoster(['Andrei Pop'])
    store().selectDriver(first.id, context({}, 1000))
    store().recordTotals(
      context({ distanceKm: 5, energyConsumedWh: 100 }, 2000),
    )

    store().removeProfile(first.id)

    expect(store().activeDriverId).toBeNull()
    expect(store().activeStintId).toBeNull()
    // Stintul nu are voie să rămână „în curs" pentru un pilot care nu mai există.
    expect(store().stints[0].endedAt).not.toBeNull()
    expect(store().stints[0].summary.distanceKm).toBeCloseTo(5, 9)
  })
})

describe('persistență', () => {
  it('piloții și stinturile supraviețuiesc unei reîmprospătări', () => {
    store().createProfile('Andrei Pop')
    store().ensureDriver(context())

    const saved = safeStorage().getItem(DRIVER_STORAGE_KEY)
    expect(saved).not.toBeNull()

    const parsed = JSON.parse(saved as string)
    expect(parsed.state.profiles).toHaveLength(1)
    expect(parsed.state.stints).toHaveLength(1)
  })
})
