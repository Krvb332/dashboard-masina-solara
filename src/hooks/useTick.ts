import { useEffect, useState } from 'react'

/**
 * Un ceas local care re-randează la interval fix.
 *
 * Necesar pentru afișarea vechimii ultimei valori: dacă mașina tace, nu mai
 * vine niciun cadru care să declanșeze re-randarea, iar „acum 2 s" ar rămâne
 * înghețat pe ecran exact când vechimea contează cel mai mult.
 */
export function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
