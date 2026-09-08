import { create } from 'zustand'
import type { SessionInfo } from '../schemas/telemetry'

/**
 * Modul de vizualizare: date live sau redarea unei sesiuni înregistrate.
 *
 * Distincția este stare globală pentru că afectează întreaga interfață - în
 * pitlane, confundarea unei înregistrări cu datele live este o greșeală
 * costisitoare, deci modul „replay" trebuie să fie vizibil peste tot.
 */

export type ViewMode = 'live' | 'replay'
export const REPLAY_SPEEDS = [1, 2, 10] as const
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]

type SessionStore = {
  mode: ViewMode
  session: SessionInfo | null
  speed: ReplaySpeed
  playing: boolean
  /** Poziția curentă în înregistrare, în milisecunde de la începutul ei. */
  positionMs: number
  durationMs: number
  loading: boolean
  error: string | null

  setMode: (mode: ViewMode) => void
  setSession: (session: SessionInfo | null) => void
  setSpeed: (speed: ReplaySpeed) => void
  setPlaying: (playing: boolean) => void
  setPosition: (positionMs: number) => void
  setDuration: (durationMs: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  exitReplay: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  mode: 'live',
  session: null,
  speed: 1,
  playing: false,
  positionMs: 0,
  durationMs: 0,
  loading: false,
  error: null,

  setMode: (mode) => set({ mode }),
  setSession: (session) => set({ session }),
  setSpeed: (speed) => set({ speed }),
  setPlaying: (playing) => set({ playing }),
  setPosition: (positionMs) => set({ positionMs }),
  setDuration: (durationMs) => set({ durationMs }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  exitReplay: () =>
    set({
      mode: 'live',
      session: null,
      playing: false,
      positionMs: 0,
      durationMs: 0,
      error: null,
    }),
}))
