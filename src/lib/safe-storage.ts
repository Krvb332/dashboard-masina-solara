/**
 * Stocare locală care nu poate arunca.
 *
 * `localStorage` nu este garantat: lipsește într-un context fără fereastră,
 * aruncă în ferestrele private ale unor browsere și poate fi blocat din
 * politicile de cookie-uri ale unui laptop de echipă. Un dashboard care cade cu
 * ecran alb în pitlane pentru că nu a putut scrie numele unui pilot ar fi o
 * greșeală de proiectare, nu un accident.
 *
 * Când stocarea reală lipsește, ținem datele într-o hartă în memorie: totul
 * funcționează în sesiunea curentă și se pierde la reîncărcare — degradare
 * previzibilă, nu eroare.
 */

export type KeyValueStorage = {
  getItem: (name: string) => string | null
  setItem: (name: string, value: string) => void
  removeItem: (name: string) => void
}

const memory = new Map<string, string>()

const memoryStorage: KeyValueStorage = {
  getItem: (name) => memory.get(name) ?? null,
  setItem: (name, value) => {
    memory.set(name, value)
  },
  removeItem: (name) => {
    memory.delete(name)
  },
}

/**
 * `localStorage`, dacă există și chiar funcționează.
 *
 * Nu este de ajuns ca obiectul să existe: în modul privat din Safari există și
 * aruncă abia la prima scriere. De aceea proba este o scriere reală, făcută o
 * singură dată, la primul apel.
 */
function detectStorage(): KeyValueStorage {
  try {
    const candidate =
      typeof globalThis !== 'undefined' && 'localStorage' in globalThis
        ? (globalThis as unknown as { localStorage?: KeyValueStorage })
            .localStorage
        : undefined

    if (candidate === undefined || candidate === null) return memoryStorage

    const probe = '__tucn_probe__'
    candidate.setItem(probe, '1')
    candidate.removeItem(probe)
    return candidate
  } catch {
    return memoryStorage
  }
}

let resolved: KeyValueStorage | null = null

export function safeStorage(): KeyValueStorage {
  if (resolved === null) resolved = detectStorage()
  return resolved
}

/** Adevărat când datele se pierd la reîncărcarea paginii. */
export function isMemoryOnly(): boolean {
  return safeStorage() === memoryStorage
}

/** Golește stocarea folosită. Pentru teste, nu pentru interfață. */
export function clearSafeStorage(keys: string[]): void {
  const storage = safeStorage()
  for (const key of keys) storage.removeItem(key)
}
