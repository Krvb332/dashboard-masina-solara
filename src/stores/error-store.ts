import { create } from 'zustand'
import type { Severity } from '../schemas/telemetry'

/**
 * Jurnalul unificat de erori.
 *
 * Alarmele serverului, biții de eroare ai controllerului, starea legăturii și
 * cadrele invalide sunt lucruri diferite în cod, dar pentru omul din pitlane
 * sunt aceeași întrebare: „ce nu e în regulă acum?". Store-ul de față le adună
 * într-o singură listă, cu istoric.
 *
 * Diferența importantă față de `telemetry-store.alarms` este că aici intrările
 * NU dispar când condiția se stinge: rămân marcate ca rezolvate. O eroare care
 * a apărut trei secunde și a dispărut este exact genul de lucru pe care vrei
 * să-l vezi după cursă, nu să-l ratezi pentru că nu te uitai pe ecran atunci.
 */

export type ErrorSource =
  /** Alarmă calculată de server pe praguri. */
  | 'alarm'
  /** Bit din masca de eroare a controllerului Mitsuba. */
  | 'fault'
  /** Starea WebSocketului către serviciul de telemetrie. */
  | 'connection'
  /** Probleme la nivel de flux: cadre invalide, mesaje pierdute. */
  | 'stream'
  /** Un semnal individual raportat ca defect de senzor. */
  | 'signal'

export type ErrorEntry = {
  /** Cheie stabilă: aceeași condiție reapărută nu creează o intrare nouă. */
  id: string
  source: ErrorSource
  severity: Severity
  title: string
  message: string
  /** Prima apariție, în milisecunde (ceas browser). */
  firstAt: number
  /** Ultima dată când condiția a fost încă prezentă. */
  lastAt: number
  /** De câte ori a reapărut după ce se stinsese. */
  occurrences: number
  /** Condiția este încă prezentă acum. */
  active: boolean
  /** Notificarea a fost închisă de utilizator. */
  dismissed: boolean
  /** Intrarea a fost văzută în panou (nu mai contează la insigna „noi"). */
  seen: boolean
}

/** Ce raportează colectorul: partea „de fapt", fără starea de interfață. */
export type ErrorReport = Pick<
  ErrorEntry,
  'id' | 'source' | 'severity' | 'title' | 'message'
>

type ErrorStore = {
  entries: ErrorEntry[]
  panelOpen: boolean

  /**
   * Sincronizează jurnalul cu setul de erori active în acest moment.
   * Ce nu apare în listă este marcat ca rezolvat, nu șters.
   */
  sync: (reports: ErrorReport[], now?: number) => void
  /** Închide notificarea unei intrări (rămâne în panou). */
  dismiss: (id: string) => void
  dismissAll: () => void
  markAllSeen: () => void
  /** Șterge din jurnal intrările care nu mai sunt active. */
  clearResolved: () => void
  clearAll: () => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
}

/** Cât istoric păstrăm. Peste atât, cele mai vechi rezolvate cad primele. */
const MAX_ENTRIES = 200

const severityRank: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

export const useErrorStore = create<ErrorStore>((set) => ({
  entries: [],
  panelOpen: false,

  sync: (reports, now = Date.now()) =>
    set((state) => {
      const reported = new Map(reports.map((report) => [report.id, report]))
      const next: ErrorEntry[] = []
      let changed = false

      for (const entry of state.entries) {
        const report = reported.get(entry.id)

        if (report === undefined) {
          if (entry.active) {
            changed = true
            next.push({ ...entry, active: false })
          } else {
            next.push(entry)
          }
          continue
        }

        reported.delete(report.id)

        // Reapariția unei erori stinse redevine „nouă": notificarea trebuie să
        // se arate din nou, altfel o problemă intermitentă e închisă o dată și
        // nu mai atrage atenția niciodată.
        const reappeared = !entry.active

        if (
          reappeared ||
          entry.severity !== report.severity ||
          entry.message !== report.message
        ) {
          changed = true
          next.push({
            ...entry,
            severity: report.severity,
            title: report.title,
            message: report.message,
            lastAt: now,
            active: true,
            occurrences: reappeared ? entry.occurrences + 1 : entry.occurrences,
            dismissed: reappeared ? false : entry.dismissed,
            seen: reappeared ? false : entry.seen,
          })
          continue
        }

        // Condiție neschimbată: actualizăm `lastAt` fără să declanșăm o
        // re-randare a listei la fiecare cadru.
        entry.lastAt = now
        next.push(entry)
      }

      for (const report of reported.values()) {
        changed = true
        next.push({
          ...report,
          firstAt: now,
          lastAt: now,
          occurrences: 1,
          active: true,
          dismissed: false,
          seen: false,
        })
      }

      if (!changed) return state

      return { entries: trim(next) }
    }),

  dismiss: (id) =>
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === id ? { ...entry, dismissed: true, seen: true } : entry,
      ),
    })),

  dismissAll: () =>
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.dismissed ? entry : { ...entry, dismissed: true },
      ),
    })),

  markAllSeen: () =>
    set((state) =>
      state.entries.every((entry) => entry.seen)
        ? state
        : {
            entries: state.entries.map((entry) =>
              entry.seen ? entry : { ...entry, seen: true },
            ),
          },
    ),

  clearResolved: () =>
    set((state) => ({
      entries: state.entries.filter((entry) => entry.active),
    })),

  clearAll: () => set({ entries: [] }),

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
}))

/** Taie istoricul, sacrificând întâi cele mai vechi intrări rezolvate. */
function trim(entries: ErrorEntry[]): ErrorEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries

  const resolved = entries
    .filter((entry) => !entry.active)
    .sort((first, second) => first.lastAt - second.lastAt)

  const drop = new Set<string>()
  for (const entry of resolved) {
    if (entries.length - drop.size <= MAX_ENTRIES) break
    drop.add(entry.id)
  }

  const kept = entries.filter((entry) => !drop.has(entry.id))
  return kept.length <= MAX_ENTRIES
    ? kept
    : kept.slice(kept.length - MAX_ENTRIES)
}

/**
 * Ordinea de afișare: activele înaintea celor rezolvate, apoi după gravitate,
 * apoi cea mai recentă întâi.
 */
export function sortEntries(entries: ErrorEntry[]): ErrorEntry[] {
  return [...entries].sort(
    (first, second) =>
      Number(second.active) - Number(first.active) ||
      severityRank[first.severity] - severityRank[second.severity] ||
      second.lastAt - first.lastAt,
  )
}
