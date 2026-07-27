import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Curățarea automată a Testing Library se înregistrează doar când `globals`
// este activat în configurație. Aici nu este, deci o legăm explicit — altfel
// randările se acumulează în DOM și interogările găsesc elemente rămase din
// testele anterioare.
afterEach(() => {
  cleanup()
})
