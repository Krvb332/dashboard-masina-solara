import { useEffect, useState } from 'react'

/**
 * Ceas care avansează la interval fix.
 *
 * Vechimea datelor trebuie să crească vizibil chiar și când nu mai sosește
 * niciun mesaj — exact situația în care operatorul are cea mai mare nevoie de
 * indicator. Un `Date.now()` citit la randare nu ar face asta, pentru că fără
 * mesaje noi nu există randare.
 */
export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
