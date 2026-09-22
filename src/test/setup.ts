import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Vitest rulează fără `globals`, deci curățarea automată din Testing Library nu
// se înregistrează singură. Fără asta, DOM-ul se acumulează între teste și
// interogările găsesc elemente rămase din testul anterior.
afterEach(cleanup)

/**
 * Nicio cerere de rețea reală din teste.
 *
 * Nu este prudență teoretică: piloții se salvează acum pe server, iar suita
 * rulează pe laptopul pe care stă și serverul de telemetrie al echipei. Prima
 * rulare de după acea schimbare a scris piloți inventați de teste („Andrei
 * Pop", „Maria Ionescu") direct în baza de date vie a mașinii, peste ce
 * folosește echipa — și nimic nu a semnalat-o, fiindcă din punctul de vedere
 * al testelor totul a mers perfect.
 *
 * De aceea `fetch` aruncă implicit, cu adresa cerută în mesaj: un test care
 * chiar are nevoie de HTTP își pune propriul dublu și se vede că o face.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url

      return Promise.reject(
        new Error(
          `Cerere de rețea într-un test: ${url}. ` +
            'Testele nu au voie să atingă un server real — pune un dublu ' +
            '(vi.mock) peste modulul care face cererea.',
        ),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})
