import type { SignalDefinition } from '../schemas/telemetry'
import type { ErrorEntry } from '../stores/error-store'
import { isFaultCodeSignal, isInCellPanel } from './signal-groups'

/**
 * De unde vine o eroare, tradus în „pe ce pagină și pe ce element".
 *
 * Jurnalul spune *ce* nu e în regulă; întrebarea imediat următoare în boxă este
 * *unde* se vede. O alarmă de temperatură duce la rândul temperaturii, un bit
 * al controllerului la rândul lui din panoul de erori Mitsuba, o legătură
 * întreruptă la panoul cu sănătatea fluxului. Regulile stau aici, într-un
 * singur loc, ca panoul și notificările să nu poată ajunge în locuri diferite
 * pentru aceeași eroare.
 *
 * Elementele se recunosc după atribute de date puse de componentele care le
 * desenează: `data-signal` pe cardul sau rândul unui semnal, `data-fault-bit`
 * pe un bit al controllerului, `data-error-anchor` pe zonele fără semnal.
 */

export type ErrorTarget = {
  /** Ruta paginii pe care se află elementul. */
  path: string
  /** Selectori CSS încercați în ordine; primul care există pe pagină câștigă. */
  selectors: string[]
}

/** Zonele fără semnal propriu, marcate cu `data-error-anchor`. */
export type ErrorAnchor = 'connection' | 'stream-invalid' | 'faults' | 'cells'

/** Pagina de diagnostic: aici stau legătura, fluxul, controllerul și restul. */
const SYSTEM_PATH = '/sistem'

/**
 * Pagina fiecărui grup din catalog. Semnalele marcate `overview` au card pe
 * prezentarea generală și primează; restul urmează grupul.
 */
const GROUP_PATHS: Record<SignalDefinition['group'], string> = {
  status: SYSTEM_PATH,
  energy: '/energie',
  thermal: SYSTEM_PATH,
  motor: SYSTEM_PATH,
  gps: '/traseu',
  chassis: SYSTEM_PATH,
  board: SYSTEM_PATH,
}

/**
 * Semnale al căror loc nu urmează grupul: turul și distanța sunt din grupul
 * „stare generală", dar se citesc pe pagina de traseu, unde au card propriu.
 */
const KEY_PATHS: Record<string, string> = {
  lap_number: '/traseu',
  distance_km: '/traseu',
}

export function anchorSelector(anchor: ErrorAnchor): string {
  return `[data-error-anchor="${anchor}"]`
}

export function signalSelector(key: string): string {
  return `[data-signal="${key.replace(/["\\]/g, '\\$&')}"]`
}

/**
 * Locul unei erori pe interfață, sau `null` când nu are unul (o alarmă fără
 * semnal atașat nu are unde să ducă).
 */
export function locateError(
  entry: Pick<ErrorEntry, 'id' | 'source' | 'signalKey'>,
  catalogByKey: Record<string, SignalDefinition>,
): ErrorTarget | null {
  switch (entry.source) {
    case 'connection':
      return { path: SYSTEM_PATH, selectors: [anchorSelector('connection')] }

    case 'stream':
      return {
        path: SYSTEM_PATH,
        selectors: [anchorSelector('stream-invalid')],
      }

    case 'fault': {
      const bit = entry.id.slice('fault:'.length)
      // Un bit stins nu mai are rând: panoul listează doar biții activi. Cădem
      // pe panou, ca istoricul să ducă totuși undeva.
      return {
        path: SYSTEM_PATH,
        selectors: [`[data-fault-bit="${bit}"]`, anchorSelector('faults')],
      }
    }

    case 'alarm':
    case 'signal': {
      const key =
        entry.signalKey ??
        (entry.source === 'signal' ? entry.id.slice('signal:'.length) : null)
      if (!key) return null
      return locateSignal(key, catalogByKey[key])
    }
  }
}

/** Unde se afișează valoarea unui semnal. */
export function locateSignal(
  key: string,
  definition: SignalDefinition | undefined,
): ErrorTarget {
  const own = signalSelector(key)

  // Codul de eroare nu se afișează ca număr, ci descompus în panoul de biți;
  // rândul din tabelul de calitate rămâne a doua variantă.
  if (isFaultCodeSignal(key)) {
    return { path: SYSTEM_PATH, selectors: [anchorSelector('faults'), own] }
  }

  const selectors = [own]
  // Indicele celulei minime/maxime nu are rând propriu: grila îl arată ca
  // marcaj pe celulă, deci ducem la grilă.
  if (isInCellPanel(key)) selectors.push(anchorSelector('cells'))

  return { path: signalPath(key, definition), selectors }
}

function signalPath(
  key: string,
  definition: SignalDefinition | undefined,
): string {
  const explicit = KEY_PATHS[key]
  if (explicit) return explicit
  if (definition?.overview) return '/'
  return definition ? GROUP_PATHS[definition.group] : SYSTEM_PATH
}

/**
 * Primul element de pe pagina curentă care răspunde unuia dintre selectori.
 * În ordinea selectorilor, nu în ordinea documentului: un selector de rezervă
 * nu are voie să câștige doar pentru că apare mai sus în pagină.
 */
export function findErrorTarget(
  selectors: string[],
  root: ParentNode | null = typeof document === 'undefined' ? null : document,
): HTMLElement | null {
  if (!root) return null
  for (const selector of selectors) {
    const element = root.querySelector(selector)
    if (element instanceof HTMLElement) return element
  }
  return null
}
