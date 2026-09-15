import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { EMPTY_TOTALS, type AnalyticsTotals } from '../lib/analytics'
import {
  aggregateFor,
  colorFor,
  initialsFor,
  makeId,
  makeProfile,
  nextAutoName,
  summarize,
  type DriverAggregate,
  type DriverProfile,
  type DriverStint,
} from '../lib/driver-profiles'
import { safeStorage } from '../lib/safe-storage'

/**
 * Piloții și stinturile lor.
 *
 * Trei moduri de a ajunge la un profil, pentru că în pitlane apar toate trei:
 *
 *  - **manual**, înainte de cursă — `createProfile`;
 *  - **în masă**, dintr-o listă de nume — `importRoster`, când echipa își
 *    trece tot lotul dintr-o dată;
 *  - **automat**, la primul flux de date — `ensureDriver`. Cineva a urcat în
 *    mașină și a pornit, iar datele curg. Fără profil automat, energia acelui
 *    stint s-ar pierde; „Pilot 1" se poate redenumi oricând după, iar stintul
 *    rămâne atașat aceluiași identificator.
 *
 * Schimbarea pilotului este o singură operație atomică: stintul precedent se
 * închide cu bilanțul lui complet, cel nou se deschide pe contoarele curente.
 * Nu există o stare intermediară în care mașina merge fără pilot atribuit.
 *
 * Datele se păstrează în `localStorage`: o reîmprospătare a paginii în mijlocul
 * cursei nu are voie să șteargă istoricul piloților.
 */

/** Cheia sub care se salvează piloții. Expusă pentru teste și pentru export. */
export const DRIVER_STORAGE_KEY = 'tucn-drivers'

export type DriverContext = {
  /** Contoarele acumulatorului de statistici în acest moment. */
  totals: AnalyticsTotals
  vehicleId?: string | null
  sessionId?: string | null
  now?: number
}

type DriverStore = {
  profiles: DriverProfile[]
  stints: DriverStint[]
  activeDriverId: string | null
  activeStintId: string | null
  /** Crearea automată a unui pilot la primul flux poate fi oprită. */
  autoCreate: boolean

  createProfile: (name: string, note?: string) => DriverProfile
  importRoster: (names: string[]) => DriverProfile[]
  renameProfile: (id: string, name: string) => void
  setNote: (id: string, note: string) => void
  removeProfile: (id: string) => void
  setAutoCreate: (enabled: boolean) => void

  /** Schimbă pilotul: închide stintul curent și deschide unul nou. */
  selectDriver: (driverId: string, context: DriverContext) => void
  /** Coborâre din mașină fără urcarea altcuiva. */
  endStint: (context: DriverContext) => void
  /**
   * Închide stintul curent și deschide altul, pentru același pilot, pe
   * contoare goale. Se folosește când acumulatorul se resetează sub el:
   * sesiune nouă sau golirea afișajului.
   */
  splitStint: (context: DriverContext) => void
  /**
   * Garantează că există un pilot la volan când curg date. Întoarce
   * identificatorul pilotului activ, sau `null` dacă auto-crearea e oprită.
   */
  ensureDriver: (context: DriverContext) => string | null
  /** Actualizează contoarele stintului activ. Apelat la ritm redus. */
  recordTotals: (context: DriverContext) => void

  clearHistory: () => void
  aggregate: (driverId: string) => DriverAggregate
}

function openStint(
  profile: DriverProfile,
  context: DriverContext,
): DriverStint {
  const now = context.now ?? Date.now()
  const totals = context.totals

  return {
    id: makeId('stint', now),
    driverId: profile.id,
    driverName: profile.name,
    vehicleId: context.vehicleId ?? null,
    sessionId: context.sessionId ?? null,
    startedAt: now,
    endedAt: null,
    baseline: { ...totals },
    latest: { ...totals },
    summary: summarize(totals, totals),
  }
}

/** Stintul a strâns ceva măsurabil de la deschiderea lui? */
function hasAccumulated(stint: DriverStint, totals: AnalyticsTotals): boolean {
  const delta = summarize(stint.baseline, totals)
  return (
    delta.distanceKm > 0 ||
    delta.energyConsumedWh > 0 ||
    delta.energySolarWh > 0 ||
    delta.durationS > 0
  )
}

/**
 * Contoarele primite sunt în urma celor pe care stintul le-a văzut deja?
 *
 * Se întâmplă la reîncărcarea paginii: stinturile trăiesc în `localStorage`, dar
 * acumulatorul de statistici trăiește în memorie și repornește de la zero. Fără
 * verificarea asta, prima actualizare de după reîncărcare ar recalcula bilanțul
 * stintului din contoare goale și ar șterge tot ce a consumat pilotul până
 * atunci — o oră de cursă dispărută dintr-o apăsare pe F5.
 */
function totalsWentBackwards(
  stint: DriverStint,
  totals: AnalyticsTotals,
): boolean {
  return (
    totals.distanceKm < stint.latest.distanceKm ||
    totals.energyConsumedWh < stint.latest.energyConsumedWh ||
    totals.activeSeconds < stint.latest.activeSeconds
  )
}

/**
 * Închide stintul activ din listă și întoarce lista actualizată.
 *
 * Când contoarele au luat-o de la capăt sub el, bilanțul rămâne cel salvat:
 * este ultimul pe care l-am putut măsura, iar unul recalculat din zerouri ar fi
 * pur și simplu fals.
 */
function closeActive(
  stints: DriverStint[],
  activeStintId: string | null,
  context: DriverContext,
): DriverStint[] {
  if (activeStintId === null) return stints

  const now = context.now ?? Date.now()
  return stints.map((stint) => {
    if (stint.id !== activeStintId) return stint
    if (totalsWentBackwards(stint, context.totals)) {
      return { ...stint, endedAt: now }
    }

    return {
      ...stint,
      endedAt: now,
      latest: { ...context.totals },
      summary: summarize(stint.baseline, context.totals),
    }
  })
}

export const useDriverStore = create<DriverStore>()(
  persist(
    (set, get) => ({
      profiles: [],
      stints: [],
      activeDriverId: null,
      activeStintId: null,
      autoCreate: true,

      createProfile: (name, note = '') => {
        const profile = makeProfile(name, get().profiles.length, { note })
        set((state) => ({ profiles: [...state.profiles, profile] }))
        return profile
      },

      importRoster: (names) => {
        const existing = get().profiles
        const known = new Set(
          existing.map((profile) => profile.name.trim().toLowerCase()),
        )

        const created: DriverProfile[] = []
        for (const name of names) {
          const trimmed = name.trim()
          // Reimportarea aceleiași liste nu are voie să dubleze piloții: după
          // o cursă lungă, un lot dublat ar împărți statisticile în două.
          if (!trimmed || known.has(trimmed.toLowerCase())) continue
          known.add(trimmed.toLowerCase())
          created.push(makeProfile(trimmed, existing.length + created.length))
        }

        if (created.length > 0) {
          set((state) => ({ profiles: [...state.profiles, ...created] }))
        }
        return created
      },

      renameProfile: (id, name) => {
        const trimmed = name.trim()
        if (!trimmed) return

        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === id
              ? {
                  ...profile,
                  name: trimmed,
                  shortName: initialsFor(trimmed),
                  // Un profil redenumit de om nu mai este „creat automat".
                  auto: false,
                }
              : profile,
          ),
          stints: state.stints.map((stint) =>
            stint.driverId === id ? { ...stint, driverName: trimmed } : stint,
          ),
        }))
      },

      setNote: (id, note) =>
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === id ? { ...profile, note } : profile,
          ),
        })),

      removeProfile: (id) =>
        set((state) => {
          const eraLaVolan = state.activeDriverId === id

          return {
            profiles: state.profiles.filter((profile) => profile.id !== id),
            // Stinturile rămân: sunt măsurători, nu proprietăți ale profilului.
            // Un pilot șters din listă nu face energia consumată să dispară.
            // Stintul lui deschis se închide însă aici, altfel ar rămâne pentru
            // totdeauna „în curs" pentru un pilot care nu mai există.
            stints: eraLaVolan
              ? state.stints.map((stint) =>
                  stint.id === state.activeStintId
                    ? { ...stint, endedAt: Date.now() }
                    : stint,
                )
              : state.stints,
            activeDriverId: eraLaVolan ? null : state.activeDriverId,
            activeStintId: eraLaVolan ? null : state.activeStintId,
          }
        }),

      setAutoCreate: (enabled) => set({ autoCreate: enabled }),

      selectDriver: (driverId, context) => {
        const state = get()
        const profile = state.profiles.find((entry) => entry.id === driverId)
        if (profile === undefined) return
        if (state.activeDriverId === driverId && state.activeStintId !== null) {
          return
        }

        const closed = closeActive(state.stints, state.activeStintId, context)
        const stint = openStint(profile, context)

        set({
          stints: [...closed, stint],
          activeDriverId: driverId,
          activeStintId: stint.id,
        })
      },

      endStint: (context) => {
        const state = get()
        if (state.activeStintId === null) return

        set({
          stints: closeActive(state.stints, state.activeStintId, context),
          activeDriverId: null,
          activeStintId: null,
        })
      },

      splitStint: (context) => {
        const state = get()
        if (state.activeStintId === null || state.activeDriverId === null) {
          return
        }

        const profile = state.profiles.find(
          (entry) => entry.id === state.activeDriverId,
        )
        if (profile === undefined) return

        const current = state.stints.find(
          (stint) => stint.id === state.activeStintId,
        )

        // Un stint în care nu s-a acumulat nimic nu merită păstrat: la
        // pornirea unei sesiuni, tăierea ar lăsa în istoric o intrare goală
        // pentru fiecare repornire. Îi rescriem linia de bază în loc să-l
        // închidem — dar numai dacă nu are deja un bilanț salvat, altfel l-am
        // șterge exact în cazul reîncărcării de pagină.
        if (
          current !== undefined &&
          !totalsWentBackwards(current, context.totals) &&
          !hasAccumulated(current, context.totals)
        ) {
          set({
            stints: state.stints.map((stint) =>
              stint.id === current.id
                ? {
                    ...stint,
                    baseline: { ...EMPTY_TOTALS },
                    latest: { ...EMPTY_TOTALS },
                    summary: summarize(EMPTY_TOTALS, EMPTY_TOTALS),
                  }
                : stint,
            ),
          })
          return
        }

        const closed = closeActive(state.stints, state.activeStintId, context)
        // Stintul nou pornește de la zero, fiindcă acolo pornește și
        // acumulatorul care îl alimentează de acum înainte.
        const fresh = openStint(profile, {
          ...context,
          totals: { ...EMPTY_TOTALS },
        })

        set({
          stints: [...closed, fresh],
          activeStintId: fresh.id,
        })
      },

      ensureDriver: (context) => {
        const state = get()
        if (state.activeDriverId !== null && state.activeStintId !== null) {
          return state.activeDriverId
        }
        if (!state.autoCreate) return null

        // Dacă există deja profiluri, urcăm primul pilot din listă în loc să
        // inventăm încă un „Pilot N" la fiecare repornire a dashboardului.
        const existing = state.profiles[0]
        if (existing !== undefined) {
          get().selectDriver(existing.id, context)
          return existing.id
        }

        const profile = makeProfile(
          nextAutoName(state.profiles),
          state.profiles.length,
          { auto: true, now: context.now },
        )
        const stint = openStint(profile, context)

        set({
          profiles: [...state.profiles, profile],
          stints: [...state.stints, stint],
          activeDriverId: profile.id,
          activeStintId: stint.id,
        })
        return profile.id
      },

      recordTotals: (context) => {
        const state = get()
        if (state.activeStintId === null) return

        const current = state.stints.find(
          (stint) => stint.id === state.activeStintId,
        )
        // Contoare în urmă înseamnă că acumulatorul a repornit sub stint (o
        // reîncărcare de pagină). Bilanțul rămâne cel salvat până când
        // `splitStint` taie stintul curat; a-l rescrie acum ar șterge cursa.
        if (
          current === undefined ||
          totalsWentBackwards(current, context.totals)
        ) {
          return
        }

        set({
          stints: state.stints.map((stint) =>
            stint.id === state.activeStintId
              ? {
                  ...stint,
                  latest: { ...context.totals },
                  summary: summarize(stint.baseline, context.totals),
                }
              : stint,
          ),
        })
      },

      clearHistory: () =>
        set({ stints: [], activeDriverId: null, activeStintId: null }),

      aggregate: (driverId) => aggregateFor(driverId, get().stints),
    }),
    {
      name: DRIVER_STORAGE_KEY,
      version: 1,
      // Nu `localStorage` direct: vezi `lib/safe-storage.ts` pentru de ce el
      // poate lipsi sau arunca chiar și într-un browser obișnuit.
      storage: createJSONStorage(() => safeStorage()),
      // Funcțiile nu se serializează, iar stintul activ trebuie să
      // supraviețuiască unei reîmprospătări în mijlocul cursei.
      partialize: (state) => ({
        profiles: state.profiles,
        stints: state.stints,
        activeDriverId: state.activeDriverId,
        activeStintId: state.activeStintId,
        autoCreate: state.autoCreate,
      }),
    },
  ),
)

/** Profilul de la volan acum, dacă există. */
export function activeDriver(): DriverProfile | null {
  const state = useDriverStore.getState()
  return (
    state.profiles.find((profile) => profile.id === state.activeDriverId) ??
    null
  )
}

/** Stintul deschis acum, dacă există. */
export function activeStint(): DriverStint | null {
  const state = useDriverStore.getState()
  return state.stints.find((stint) => stint.id === state.activeStintId) ?? null
}

/** Golește complet starea. Folosit de teste, nu de interfață. */
export function resetDriverStore(): void {
  useDriverStore.setState({
    profiles: [],
    stints: [],
    activeDriverId: null,
    activeStintId: null,
    autoCreate: true,
  })
}

export const EMPTY_DRIVER_CONTEXT: DriverContext = { totals: EMPTY_TOTALS }

export { colorFor }
