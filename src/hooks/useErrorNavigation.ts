import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { findErrorTarget, locateError } from '../lib/error-locator'
import { useErrorStore, type ErrorEntry } from '../stores/error-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Drumul de la o eroare din jurnal la elementul de pe interfață care a produs-o.
 *
 * Două jumătăți, pentru că navigarea și evidențierea nu se pot întâmpla în
 * același moment: pagina nouă trebuie să se randeze înainte ca elementul să
 * existe. `useGoToErrorSource` schimbă ruta și depune o cerere în store;
 * `useErrorFocus`, montat o singură dată în shell, așteaptă elementul și îl
 * scoate în evidență când apare.
 */

/** Cât așteptăm elementul după schimbarea paginii, în cadre de randare. */
const MAX_FRAMES = 90
/** Cât rămâne evidențiat elementul; trebuie să acopere animația din CSS. */
const HIGHLIGHT_MS = 2600

/**
 * Întoarce o funcție care duce la sursa unei erori. Dacă elementul este deja
 * pe pagina curentă, nu schimbă pagina: o alarmă de baterie văzută de pe
 * pagina de energie se arată acolo, nu te trimite pe prezentarea generală.
 */
export function useGoToErrorSource(): (
  entry: Pick<ErrorEntry, 'id' | 'source' | 'signalKey'>,
) => boolean {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const catalogByKey = useTelemetryStore((state) => state.catalogByKey)
  const requestFocus = useErrorStore((state) => state.requestFocus)

  return useCallback(
    (entry) => {
      const target = locateError(entry, catalogByKey)
      if (!target) return false

      const onThisPage = findErrorTarget(target.selectors) !== null
      if (!onThisPage && pathname !== target.path) {
        void navigate(target.path)
      }
      requestFocus(target.selectors)
      return true
    },
    [catalogByKey, navigate, pathname, requestFocus],
  )
}

/**
 * Se montează o dată, în shell. Când apare o cerere, caută elementul cadru cu
 * cadru (pagina abia se randează), îl derulează în vedere și îl marchează cu
 * `data-error-focus` pentru animația din `index.css`.
 */
export function useErrorFocus(): void {
  const request = useErrorStore((state) => state.focusRequest)

  useEffect(() => {
    if (!request) return

    let frame = 0
    let attempts = 0
    let cleanupHighlight: (() => void) | undefined

    const tick = () => {
      const element = findErrorTarget(request.selectors)
      if (element) {
        cleanupHighlight = revealErrorTarget(element)
        return
      }
      if (++attempts >= MAX_FRAMES) return
      frame = requestAnimationFrame(tick)
    }

    tick()

    return () => {
      cancelAnimationFrame(frame)
      cleanupHighlight?.()
    }
  }, [request])
}

/**
 * Derulează la element și îl evidențiază. Întoarce funcția care ridică
 * evidențierea, ca o cerere nouă să nu lase două elemente aprinse.
 */
export function revealErrorTarget(element: HTMLElement): () => void {
  // Un element dintr-un `<details>` închis există în DOM, dar nu se vede.
  for (
    let details = element.closest('details');
    details;
    details = details.parentElement?.closest('details') ?? null
  ) {
    details.open = true
  }

  const box = highlightBox(element)

  element.scrollIntoView?.({ block: 'center', behavior: 'smooth' })

  // Focalizarea mută și cititorul de ecran la element, nu doar privirea.
  const hadTabIndex = box.hasAttribute('tabindex')
  if (!hadTabIndex) box.setAttribute('tabindex', '-1')
  box.focus({ preventScroll: true })

  box.setAttribute('data-error-focus', '')
  const timer = setTimeout(clear, HIGHLIGHT_MS)

  function clear() {
    clearTimeout(timer)
    box.removeAttribute('data-error-focus')
    if (!hadTabIndex) box.removeAttribute('tabindex')
  }

  return clear
}

/**
 * Valoarea unui semnal este un `span` în linie; inelul se desenează pe cardul
 * sau rândul care o conține, altfel ar încadra doar cifra.
 */
function highlightBox(element: HTMLElement): HTMLElement {
  if (element.tagName !== 'SPAN') return element
  return element.closest<HTMLElement>('li, tr, article, div') ?? element
}
