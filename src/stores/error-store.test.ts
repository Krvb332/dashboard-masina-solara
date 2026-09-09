import { beforeEach, describe, expect, it } from 'vitest'
import { sortEntries, useErrorStore, type ErrorReport } from './error-store'

const alarm: ErrorReport = {
  id: 'alarm:pack-hot',
  source: 'alarm',
  severity: 'critical',
  title: 'Pachet supraîncălzit',
  message: '61 °C peste pragul de 58 °C.',
}

describe('error-store', () => {
  beforeEach(() => {
    useErrorStore.getState().clearAll()
    useErrorStore.getState().setPanelOpen(false)
  })

  it('adaugă o eroare nouă ca activă și nevăzută', () => {
    useErrorStore.getState().sync([alarm], 1000)

    const [entry] = useErrorStore.getState().entries
    expect(entry).toMatchObject({
      id: alarm.id,
      active: true,
      seen: false,
      dismissed: false,
      occurrences: 1,
      firstAt: 1000,
    })
  })

  it('marchează rezolvat, fără să șteargă, când condiția dispare', () => {
    useErrorStore.getState().sync([alarm], 1000)
    useErrorStore.getState().sync([], 2000)

    const [entry] = useErrorStore.getState().entries
    expect(entry.active).toBe(false)
    expect(entry.firstAt).toBe(1000)
  })

  it('reaprinde notificarea închisă când eroarea reapare', () => {
    useErrorStore.getState().sync([alarm], 1000)
    useErrorStore.getState().dismiss(alarm.id)
    useErrorStore.getState().sync([], 2000)
    useErrorStore.getState().sync([alarm], 3000)

    const [entry] = useErrorStore.getState().entries
    expect(entry).toMatchObject({
      active: true,
      dismissed: false,
      seen: false,
      occurrences: 2,
      // Prima apariție rămâne prima apariție.
      firstAt: 1000,
    })
  })

  it('nu creează o intrare nouă cât timp condiția persistă', () => {
    useErrorStore.getState().sync([alarm], 1000)
    useErrorStore.getState().sync([alarm], 1200)
    useErrorStore.getState().sync([alarm], 1400)

    expect(useErrorStore.getState().entries).toHaveLength(1)
  })

  it('păstrează identitatea obiectului când nu s-a schimbat nimic', () => {
    useErrorStore.getState().sync([alarm], 1000)
    const before = useErrorStore.getState().entries
    useErrorStore.getState().sync([alarm], 1200)

    // Fără asta, fiecare cadru primit ar re-randa toată lista de erori.
    expect(useErrorStore.getState().entries).toBe(before)
  })

  it('șterge doar intrările rezolvate', () => {
    useErrorStore.getState().sync([alarm, { ...alarm, id: 'alarm:b' }], 1000)
    useErrorStore.getState().sync([alarm], 2000)
    useErrorStore.getState().clearResolved()

    expect(useErrorStore.getState().entries.map((entry) => entry.id)).toEqual([
      alarm.id,
    ])
  })

  it('ordonează activele înaintea rezolvatelor, apoi după gravitate', () => {
    useErrorStore.getState().sync(
      [
        { ...alarm, id: 'a', severity: 'warning' },
        { ...alarm, id: 'b', severity: 'critical' },
        { ...alarm, id: 'c', severity: 'info' },
      ],
      1000,
    )
    useErrorStore
      .getState()
      .sync([{ ...alarm, id: 'a', severity: 'warning' }], 2000)

    const order = sortEntries(useErrorStore.getState().entries).map(
      (entry) => entry.id,
    )
    expect(order[0]).toBe('a')
    expect(order.slice(1).sort()).toEqual(['b', 'c'])
  })
})
