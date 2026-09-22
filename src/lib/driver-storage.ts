import type { StateStorage } from 'zustand/middleware'
import { ApiError, fetchDriverState, saveDriverState } from './api'
import { safeStorage } from './safe-storage'

/**
 * Unde trăiesc piloții: pe server, cu o copie locală ca plasă de siguranță.
 *
 * `localStorage` singur ținea lista în browserul fiecărui ecran. În boxă asta
 * se vedea ca „piloții nu se salvează": laptopul din pitwall, telefonul
 * inginerului și ecranul mare deschideau aceeași adresă și vedeau fiecare
 * altceva, iar un calculator deschis prima oară pornea gol, ca și cum nimeni
 * nu ar fi condus vreodată. Serverul care servește interfața ține acum și
 * lista, deci toate ecranele văd aceiași piloți.
 *
 * Copia locală rămâne, dar și-a schimbat rolul: nu mai este sursa de adevăr,
 * ci ce arătăm cât timp serverul nu răspunde. Un dashboard care ar rămâne gol
 * pentru că legătura a căzut două secunde ar fi mai prost decât unul care
 * arată ultima stare cunoscută și spune că e veche.
 *
 * ## De ce scrierile către server sunt întârziate
 *
 * Zustand scrie în stocare la FIECARE schimbare de stare, iar motorul de
 * statistici actualizează contoarele stintului de cinci ori pe secundă. Local
 * asta nu costă nimic. Trimise pe rețea ca atare, ar fi cinci cereri pe
 * secundă, de pe fiecare ecran deschis — pentru o informație care în realitate
 * se schimbă de câteva ori pe cursă. Scrierea locală rămâne imediată; cea
 * către server se adună și pleacă o dată la câteva secunde, plus imediat ce
 * pagina se ascunde, ca ultima schimbare să nu se piardă la închiderea filei.
 */

/** Cât așteptăm, după o schimbare, înainte să trimitem instantaneul. */
const SYNC_DEBOUNCE_MS = 2500

/** După o scriere eșuată, cât așteptăm înainte de reîncercare. */
const RETRY_DELAY_MS = 8000

export type DriverSyncState =
  /** Încă nu s-a încercat nimic: pagina abia s-a deschis. */
  | 'idle'
  /** Citim sau scriem chiar acum. */
  | 'syncing'
  /** Ultima operație a reușit: ce se vede este ce știe serverul. */
  | 'synced'
  /** Serverul nu răspunde; lucrăm din copia locală, doar pe ecranul ăsta. */
  | 'offline'

type Listener = (status: DriverSyncStatus) => void

export type DriverSyncStatus = {
  state: DriverSyncState
  /** Ultima sincronizare reușită, în milisecunde. */
  lastSyncedAt: number | null
  /** Motivul ultimei eșuări, pentru interfață. */
  reason: string | null
}

let status: DriverSyncStatus = {
  state: 'idle',
  lastSyncedAt: null,
  reason: null,
}

const listeners = new Set<Listener>()

export function driverSyncStatus(): DriverSyncStatus {
  return status
}

export function onDriverSyncChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setStatus(next: Partial<DriverSyncStatus>): void {
  status = { ...status, ...next }
  for (const listener of listeners) listener(status)
}

/**
 * Revizia de la care pornește următoarea scriere. Vine din ultimul răspuns al
 * serverului; `0` înseamnă „nu am citit încă nimic de acolo".
 */
let revision = 0

/**
 * Am terminat de citit starea de la server?
 *
 * Până atunci, ce are store-ul în el sunt valorile implicite — listă goală,
 * nimeni la volan — nu o stare pe care cineva a produs-o. Trimisă pe server,
 * ea ȘTERGE piloții reali ai echipei, iar scrierea arată ca un succes.
 * Măsurat: fără garda asta, o deschidere de pagină a scris pe server o stare
 * cu nouă stinturi și zero piloți, peste lista bună.
 */
let hydrated = false

/** Ultimul instantaneu primit de la `setItem`, în forma serializată de zustand. */
let pending: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** O scriere este în zbor: nu pornim a doua peste ea. */
let inFlight = false

/** Ce ține zustand în stocare: starea plus versiunea ei de schemă. */
type PersistedShape = {
  state?: Record<string, unknown>
  version?: number
}

function parse(raw: string | null): PersistedShape | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as PersistedShape)
      : null
  } catch {
    // Copie locală coruptă: o tratăm ca lipsă, nu ca eroare fatală.
    return null
  }
}

/**
 * Adaptorul pe care îl primește `persist`.
 *
 * `getItem` întoarce o promisiune, deci hidratarea devine asincronă: store-ul
 * pornește pe valorile implicite și se umple când răspunde serverul. Cine are
 * nevoie să știe când s-a terminat folosește `useDriverStore.persist.hasHydrated()`.
 */
export const driverStorage: StateStorage = {
  async getItem(name) {
    const local = safeStorage().getItem(name)
    setStatus({ state: 'syncing' })

    try {
      const envelope = await fetchDriverState()
      revision = envelope.rev
      hydrated = true

      // Serverul nu are încă nimic scris (instalare nouă, prima pornire), dar
      // ecranul ăsta are o listă locală rămasă din perioada în care piloții
      // trăiau doar în browser. O păstrăm și o urcăm: altfel prima deschidere
      // după actualizare ar arăta ca o ștergere a tot istoricul.
      if (envelope.rev === 0 && local !== null) {
        setStatus({ state: 'synced', lastSyncedAt: Date.now(), reason: null })
        schedule(local)
        return local
      }

      const merged = JSON.stringify({
        state: envelope.state,
        version: parse(local)?.version ?? 1,
      })
      safeStorage().setItem(name, merged)
      setStatus({ state: 'synced', lastSyncedAt: Date.now(), reason: null })
      return merged
    } catch (error) {
      // Și aici: citirea s-a încheiat, chiar dacă prost. Scrierile de acum
      // înainte pornesc de la o stare pe care cineva chiar a văzut-o, iar
      // reîncercările au de unde relua.
      hydrated = true
      setStatus({
        state: 'offline',
        reason:
          error instanceof ApiError
            ? `Serverul a răspuns ${error.status}.`
            : 'Serverul nu răspunde.',
      })
      // Ultima stare cunoscută pe ACEST ecran. Mai bună decât una goală, dar
      // nu este cea partajată — interfața spune asta explicit.
      return local
    }
  },

  setItem(name, value) {
    // Local, imediat: o reîncărcare a paginii la o secundă după schimbarea
    // pilotului nu are voie să depindă de o cerere de rețea încă neplecată.
    safeStorage().setItem(name, value)
    // Pe server, doar după ce știm ce e acolo. Zustand scrie în stocare și
    // înainte de hidratare, iar starea de atunci este cea implicită: goală.
    if (hydrated) schedule(value)
  },

  removeItem(name) {
    safeStorage().removeItem(name)
    pending = null
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  },
}

function schedule(value: string): void {
  pending = value
  if (timer !== null) return
  timer = setTimeout(() => {
    timer = null
    void flush()
  }, SYNC_DEBOUNCE_MS)
}

/**
 * Trimite instantaneul curent. Publică pentru cazurile în care nu se poate
 * aștepta întârzierea: fila se ascunde, utilizatorul pleacă de pe pagină.
 */
export async function flushDriverState(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  await flush()
}

async function flush(): Promise<void> {
  if (pending === null || inFlight || !hydrated) return

  const payload = parse(pending)?.state
  if (payload === undefined) {
    pending = null
    return
  }

  inFlight = true
  const trimis = pending
  pending = null
  setStatus({ state: 'syncing' })

  try {
    const envelope = await saveDriverState(
      payload as Parameters<typeof saveDriverState>[0],
      revision,
    )
    revision = envelope.rev
    setStatus({ state: 'synced', lastSyncedAt: Date.now(), reason: null })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // Altcineva a scris între timp. Nu ne impunem peste el: citim ce e acum
      // pe server la următoarea deschidere a paginii, iar scrierea noastră se
      // reia de la revizia corectă. Reîncercarea oarbă în buclă ar transforma
      // două ecrane deschise simultan într-un război de suprascrieri.
      try {
        const current = await fetchDriverState()
        revision = current.rev
        setStatus({
          state: 'synced',
          lastSyncedAt: Date.now(),
          reason: 'Alt ecran a schimbat piloții; starea lui a rămas.',
        })
      } catch {
        setStatus({ state: 'offline', reason: 'Serverul nu răspunde.' })
      }
    } else {
      setStatus({
        state: 'offline',
        reason:
          error instanceof ApiError
            ? `Serverul a răspuns ${error.status}.`
            : 'Serverul nu răspunde.',
      })
      // Punem înapoi ce nu s-a scris și reîncercăm mai târziu — dar numai dacă
      // între timp nu a apărut ceva mai nou, care îl înlocuiește oricum.
      if (pending === null) pending = trimis
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          void flush()
        }, RETRY_DELAY_MS)
      }
    }
  } finally {
    inFlight = false
  }
}

/**
 * Trimite ce a rămas nescris când pagina se ascunde sau se închide.
 *
 * `visibilitychange` este evenimentul pe care browserele mobile îl dau cu
 * adevărat la închiderea filei; `beforeunload` nu se declanșează pe iOS. Le
 * ascultăm pe amândouă.
 */
export function watchDriverStateFlush(): () => void {
  if (typeof document === 'undefined') return () => undefined

  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushDriverState()
  }
  const onUnload = () => void flushDriverState()

  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onUnload)

  return () => {
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onUnload)
  }
}

/** Golește starea internă. Pentru teste, nu pentru interfață. */
export function resetDriverStorage(): void {
  revision = 0
  hydrated = false
  pending = null
  inFlight = false
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  status = { state: 'idle', lastSyncedAt: null, reason: null }
}
