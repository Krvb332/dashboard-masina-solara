import { create } from 'zustand'

/** Modul aranjare este global: butonul stă în antet, grilele în pagini. */
export const useLayoutEdit = create<{
  editing: boolean
  /** Câte grile sunt montate; antetul ascunde butonul pe paginile fără grilă. */
  grids: number
  toggle: () => void
}>((set) => ({
  editing: false,
  grids: 0,
  toggle: () => set((state) => ({ editing: !state.editing })),
}))
