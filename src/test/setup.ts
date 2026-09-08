import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest rulează fără `globals`, deci curățarea automată din Testing Library nu
// se înregistrează singură. Fără asta, DOM-ul se acumulează între teste și
// interogările găsesc elemente rămase din testul anterior.
afterEach(cleanup)
