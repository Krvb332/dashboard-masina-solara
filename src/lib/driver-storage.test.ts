import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import {
  driverStorage,
  driverSyncStatus,
  flushDriverState,
  resetDriverStorage,
} from './driver-storage'
import { safeStorage } from './safe-storage'

/**
 * Ce apără testele de aici: problema raportată din boxă — „pilotul adăugat pe
 * un ecran nu apare pe celălalt" — și felul în care degradăm când serverul nu
 * răspunde. Adaptorul este singurul loc din care piloții ajung pe server și
 * singurul care decide ce se arată când nu ajung.
 */

const fetchDriverState = vi.fn()
const saveDriverState = vi.fn()

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchDriverState: () => fetchDriverState(),
  saveDriverState: (state: unknown, rev: number) => saveDriverState(state, rev),
}))

const KEY = 'tucn-drivers'

/** Un instantaneu în forma pe care o serializează zustand. */
function snapshot(names: string[]): string {
  return JSON.stringify({
    state: {
      profiles: names.map((name) => ({ id: name, name })),
      stints: [],
      activeDriverId: null,
      activeStintId: null,
      autoCreate: true,
    },
    version: 1,
  })
}

function envelope(rev: number, names: string[]) {
  return {
    rev,
    updated_at: null,
    state: {
      profiles: names.map((name) => ({ id: name, name })),
      stints: [],
      activeDriverId: null,
      activeStintId: null,
      autoCreate: true,
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetDriverStorage()
  safeStorage().removeItem(KEY)
  fetchDriverState.mockReset()
  saveDriverState.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Deschiderea paginii, până la capăt: fără ea nu se trimite nimic pe server,
 * fiindcă până la prima citire starea din store este cea implicită, nu una pe
 * care a produs-o cineva.
 */
async function hidrateaza(rev = 1, names: string[] = []): Promise<void> {
  fetchDriverState.mockResolvedValueOnce(envelope(rev, names))
  await driverStorage.getItem(KEY)
}

describe('citirea la deschiderea paginii', () => {
  it('ia piloții de pe server, nu din browserul acestui ecran', async () => {
    // Exact cazul raportat: ecranul ăsta nu a văzut niciodată pilotul, dar
    // altcineva l-a adăugat de pe alt calculator.
    fetchDriverState.mockResolvedValue(envelope(4, ['Andrei Pop']))

    const raw = await driverStorage.getItem(KEY)

    expect(JSON.parse(raw as string).state.profiles[0].name).toBe('Andrei Pop')
    expect(driverSyncStatus().state).toBe('synced')
  })

  it('păstrează copia locală, ca următoarea deschidere să aibă de unde porni', async () => {
    fetchDriverState.mockResolvedValue(envelope(4, ['Andrei Pop']))

    await driverStorage.getItem(KEY)

    const cache = safeStorage().getItem(KEY)
    expect(JSON.parse(cache as string).state.profiles[0].name).toBe(
      'Andrei Pop',
    )
  })

  it('cade pe copia locală când serverul nu răspunde, și spune asta', async () => {
    safeStorage().setItem(KEY, snapshot(['Maria Ionescu']))
    fetchDriverState.mockRejectedValue(new Error('fără rețea'))

    const raw = await driverStorage.getItem(KEY)

    expect(JSON.parse(raw as string).state.profiles[0].name).toBe(
      'Maria Ionescu',
    )
    // Nu „salvat": ce se vede este doar al acestui ecran.
    expect(driverSyncStatus().state).toBe('offline')
    expect(driverSyncStatus().reason).toBeTruthy()
  })

  it('urcă lista locală rămasă din perioada „doar în browser"', async () => {
    // Serverul este gol (rev 0) pentru că funcția abia a fost instalată, dar
    // ecranul ăsta are piloții de dinainte. A-i ignora ar arăta, la prima
    // deschidere după actualizare, exact ca o ștergere a tot istoricul.
    safeStorage().setItem(KEY, snapshot(['Vlad Dumitru']))
    fetchDriverState.mockResolvedValue(envelope(0, []))
    saveDriverState.mockResolvedValue(envelope(1, ['Vlad Dumitru']))

    const raw = await driverStorage.getItem(KEY)
    expect(JSON.parse(raw as string).state.profiles[0].name).toBe(
      'Vlad Dumitru',
    )

    await flushDriverState()
    expect(saveDriverState).toHaveBeenCalledOnce()
    expect(saveDriverState.mock.calls[0][0].profiles[0].name).toBe(
      'Vlad Dumitru',
    )
  })

  it('o copie locală coruptă nu împiedică citirea de pe server', async () => {
    safeStorage().setItem(KEY, '{nu e json')
    fetchDriverState.mockResolvedValue(envelope(2, ['Andrei Pop']))

    const raw = await driverStorage.getItem(KEY)

    expect(JSON.parse(raw as string).state.profiles[0].name).toBe('Andrei Pop')
  })
})

describe('scrierea către server', () => {
  it('NU trimite starea implicită de dinainte de citire', async () => {
    // Defectul măsurat: zustand scrie în stocare și înainte de hidratare, iar
    // starea de atunci este cea implicită — listă goală. Trimisă pe server,
    // ea ștergea piloții reali ai echipei, și o făcea cu succes aparent.
    saveDriverState.mockResolvedValue(envelope(1, []))

    driverStorage.setItem(KEY, snapshot([]))
    await vi.advanceTimersByTimeAsync(10_000)

    expect(saveDriverState).not.toHaveBeenCalled()
  })

  it('trimite abia după ce a citit ce e pe server', async () => {
    fetchDriverState.mockResolvedValue(envelope(3, ['Andrei Pop']))
    saveDriverState.mockResolvedValue(envelope(4, ['Andrei Pop', 'nou']))

    driverStorage.setItem(KEY, snapshot([]))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(saveDriverState).not.toHaveBeenCalled()

    await driverStorage.getItem(KEY)
    driverStorage.setItem(KEY, snapshot(['Andrei Pop', 'nou']))
    await vi.advanceTimersByTimeAsync(3000)

    expect(saveDriverState).toHaveBeenCalledOnce()
    expect(saveDriverState.mock.calls[0][1]).toBe(3)
  })

  it('scrie local imediat, ca o reîncărcare rapidă să nu piardă nimic', async () => {
    await hidrateaza()
    driverStorage.setItem(KEY, snapshot(['Andrei Pop']))

    // Fără să fi trecut vreo întârziere și fără nicio cerere plecată.
    expect(safeStorage().getItem(KEY)).toBe(snapshot(['Andrei Pop']))
    expect(saveDriverState).not.toHaveBeenCalled()
  })

  it('adună schimbările dese într-o singură cerere', async () => {
    await hidrateaza()
    saveDriverState.mockResolvedValue(envelope(1, ['c']))

    // Motorul de statistici actualizează contoarele de cinci ori pe secundă;
    // tot atâtea cereri pe secundă, de pe fiecare ecran, ar fi absurd.
    driverStorage.setItem(KEY, snapshot(['a']))
    driverStorage.setItem(KEY, snapshot(['b']))
    driverStorage.setItem(KEY, snapshot(['c']))

    await vi.advanceTimersByTimeAsync(3000)

    expect(saveDriverState).toHaveBeenCalledOnce()
    // Ultima stare, nu prima: cererea o poartă pe cea curentă.
    expect(saveDriverState.mock.calls[0][0].profiles[0].name).toBe('c')
  })

  it('trimite revizia primită de la server, ca scrierea să fie verificabilă', async () => {
    fetchDriverState.mockResolvedValue(envelope(7, []))
    await driverStorage.getItem(KEY)
    saveDriverState.mockResolvedValue(envelope(8, ['a']))

    driverStorage.setItem(KEY, snapshot(['a']))
    await vi.advanceTimersByTimeAsync(3000)

    expect(saveDriverState).toHaveBeenCalledWith(expect.anything(), 7)
  })

  it('reîncearcă după o eroare de rețea, fără să piardă instantaneul', async () => {
    await hidrateaza()
    saveDriverState.mockRejectedValueOnce(new Error('fără rețea'))
    saveDriverState.mockResolvedValueOnce(envelope(1, ['a']))

    driverStorage.setItem(KEY, snapshot(['a']))
    await vi.advanceTimersByTimeAsync(3000)

    expect(driverSyncStatus().state).toBe('offline')

    await vi.advanceTimersByTimeAsync(10_000)

    expect(saveDriverState).toHaveBeenCalledTimes(2)
    expect(driverSyncStatus().state).toBe('synced')
  })

  it('la conflict de revizie nu se impune peste scrierea celuilalt ecran', async () => {
    await hidrateaza()
    saveDriverState.mockRejectedValue(new ApiError('conflict', 409))
    fetchDriverState.mockResolvedValue(envelope(9, ['al altui ecran']))

    driverStorage.setItem(KEY, snapshot(['al meu']))
    await vi.advanceTimersByTimeAsync(3000)

    // O singură încercare: reîncercarea oarbă ar transforma două ecrane
    // deschise simultan într-un război de suprascrieri.
    expect(saveDriverState).toHaveBeenCalledOnce()
    expect(driverSyncStatus().reason).toMatch(/Alt ecran/)

    // Revizia s-a actualizat, deci următoarea scriere pornește de la cea bună.
    saveDriverState.mockReset()
    saveDriverState.mockResolvedValue(envelope(10, ['al meu']))
    driverStorage.setItem(KEY, snapshot(['al meu']))
    await vi.advanceTimersByTimeAsync(3000)

    expect(saveDriverState).toHaveBeenCalledWith(expect.anything(), 9)
  })

  it('golirea la cerere trimite imediat, fără să aștepte întârzierea', async () => {
    await hidrateaza()
    saveDriverState.mockResolvedValue(envelope(1, ['a']))

    driverStorage.setItem(KEY, snapshot(['a']))
    await flushDriverState()

    // Fila se poate închide acum: nu a rămas nimic netrimis.
    expect(saveDriverState).toHaveBeenCalledOnce()
  })

  it('nu trimite nimic dacă nu s-a schimbat nimic', async () => {
    await flushDriverState()
    expect(saveDriverState).not.toHaveBeenCalled()
  })
})
