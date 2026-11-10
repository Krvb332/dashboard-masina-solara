import { z } from 'zod'
import { safeStorage } from './safe-storage'

/**
 * Aranjarea panourilor unei pagini: ordine, lățimi și ce este ascuns.
 *
 * Se ține în stocarea locală, pe pagină. Codul paginii rămâne sursa de adevăr
 * pentru *ce* panouri există; aici stă doar ce a schimbat omul din fața
 * ecranului.
 */

/** Lățimea unui panou, în coloane dintr-o grilă de 6. */
export const SPANS = [2, 3, 4, 6] as const
export type Span = (typeof SPANS)[number]

const layoutSchema = z.object({
  order: z.array(z.string()),
  spans: z.record(z.string(), z.union(SPANS.map((span) => z.literal(span)))),
  hidden: z.array(z.string()),
})

export type PanelLayout = z.infer<typeof layoutSchema>

export const EMPTY_LAYOUT: PanelLayout = { order: [], spans: {}, hidden: [] }

const storageKey = (page: string) => `tucn:layout:${page}`

export function loadLayout(page: string): PanelLayout {
  try {
    const raw = safeStorage().getItem(storageKey(page))
    if (raw === null) return EMPTY_LAYOUT
    return layoutSchema.parse(JSON.parse(raw))
  } catch {
    // O aranjare stricată nu are voie să lase pagina goală.
    return EMPTY_LAYOUT
  }
}

export function saveLayout(page: string, layout: PanelLayout): void {
  if (layout === EMPTY_LAYOUT) safeStorage().removeItem(storageKey(page))
  else safeStorage().setItem(storageKey(page), JSON.stringify(layout))
}

/**
 * Mută `fromId` pe locul lui `toId`. Mutat înainte, ajunge după țintă; mutat
 * înapoi, ajunge în fața ei — adică exact locul peste care a fost lăsat.
 */
export function moveItem(
  order: string[],
  fromId: string,
  toId: string,
): string[] {
  const from = order.indexOf(fromId)
  const to = order.indexOf(toId)
  if (from < 0 || to < 0 || from === to) return order
  const next = order.slice()
  next.splice(from, 1)
  next.splice(to, 0, fromId)
  return next
}

export function nextSpan(span: Span): Span {
  return SPANS[(SPANS.indexOf(span) + 1) % SPANS.length]
}

/**
 * Împacă ordinea salvată cu panourile pe care pagina le are acum.
 *
 * `saved` vine din stocarea locală și poate fi veche: între timp codul a putut
 * scoate panouri sau adăuga unele noi. `current` este ordinea implicită, din
 * cod. Rezultatul trebuie să conțină fiecare id din `current` exact o dată.
 */
export function reconcileOrder(saved: string[], current: string[]): string[] {
  if (saved.length === 0) return current
  const known = saved.filter((id) => current.includes(id))
  // Panourile adăugate în cod după salvare apar la coadă: aranjarea făcută de
  // om rămâne neatinsă, iar noutatea se vede fără să mute nimic din loc.
  return [...known, ...current.filter((id) => !saved.includes(id))]
}
