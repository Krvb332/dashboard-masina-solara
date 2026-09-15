/**
 * Citește catalogul de semnale din `server/app/signals.py` fără interpretor
 * Python.
 *
 * Scripturile de verificare rulează pe orice mașină pe care există Node, chiar
 * dacă `python3` din PATH este mai vechi decât cel cu care rulează serverul.
 * Catalogul are o formă strictă și repetitivă — apeluri `Signal(...)` cu
 * argumente denumite și valori literale — deci un parser mic este suficient și
 * nu depinde de mediu.
 *
 * Parserul refuză explicit ce nu înțelege: un apel `Signal(...)` care conține o
 * expresie în locul unei valori literale oprește verificarea cu eroare, în loc
 * să fie sărit în tăcere. Un semnal invizibil pentru verificator ar face gate-ul
 * să treacă tocmai când catalogul e greșit.
 */

import { readFileSync } from 'node:fs'

/** Extrage textul dintre parantezele care încep la `open`. */
function readBalanced(source, open) {
  let depth = 0
  let inString = false
  let quote = ''

  for (let index = open; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) inString = false
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      continue
    }

    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }

  throw new Error('Paranteză neînchisă într-un apel Signal(...).')
}

/** Împarte lista de argumente la virgulele de la nivelul zero. */
function splitArguments(body) {
  const parts = []
  let depth = 0
  let inString = false
  let quote = ''
  let start = 0

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]

    if (inString) {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) inString = false
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      continue
    }

    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index))
      start = index + 1
    }
  }

  parts.push(body.slice(start))
  return parts.map((part) => stripComments(part).trim()).filter(Boolean)
}

/** Scoate comentariile `#` de la nivelul zero, păstrând `#` din șiruri. */
function stripComments(text) {
  let inString = false
  let quote = ''

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) inString = false
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      continue
    }

    if (char === '#') return text.slice(0, index)
  }

  return text
}

function parseLiteral(raw, context) {
  const text = raw.trim()

  if (text === 'None') return null
  if (text === 'True') return true
  if (text === 'False') return false

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\')
  }

  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(text)) return Number(text)

  throw new Error(
    `Valoare neinterpretabilă în catalog (${context}): ${text}. ` +
      'Catalogul trebuie să folosească doar literali în apelurile Signal(...).',
  )
}

/** Toate semnalele din catalog, în ordinea din fișier. */
export function parseSignalCatalog(path = 'server/app/signals.py') {
  const source = readFileSync(path, 'utf8')
  const signals = []

  // Numai apelurile din interiorul CATALOG-ului; definiția dataclass-ului și
  // regulile compuse folosesc alte constructoare.
  const catalogStart = source.indexOf('CATALOG: tuple[Signal, ...] = (')
  if (catalogStart === -1) throw new Error('Nu am găsit CATALOG în signals.py.')
  const catalogBody = readBalanced(
    source,
    source.indexOf('(', catalogStart + 'CATALOG: tuple[Signal, ...] ='.length),
  )

  const pattern = /\bSignal\s*\(/g
  let match

  while ((match = pattern.exec(catalogBody)) !== null) {
    const open = match.index + match[0].length - 1
    const body = readBalanced(catalogBody, open)
    const signal = {}

    for (const argument of splitArguments(body)) {
      const equals = argument.indexOf('=')
      if (equals === -1) {
        throw new Error(
          `Argument pozițional într-un apel Signal(...): ${argument}. ` +
            'Catalogul trebuie să folosească doar argumente denumite.',
        )
      }
      const name = argument.slice(0, equals).trim()
      signal[name] = parseLiteral(argument.slice(equals + 1), name)
    }

    if (typeof signal.key !== 'string') {
      throw new Error('Un apel Signal(...) nu are cheie literală.')
    }

    signals.push(signal)
    pattern.lastIndex = open + body.length + 2
  }

  return signals
}

export function signalKeys(path) {
  return parseSignalCatalog(path).map((signal) => signal.key)
}

/** Grupurile declarate în `GROUP_LABELS`. */
export function parseGroupLabels(path = 'server/app/signals.py') {
  const source = readFileSync(path, 'utf8')
  const start = source.indexOf('GROUP_LABELS: dict[str, str] = {')
  if (start === -1) throw new Error('Nu am găsit GROUP_LABELS în signals.py.')

  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end)
  const labels = {}

  for (const line of body.split('\n').slice(1)) {
    const entry = /^\s*"([^"]+)"\s*:\s*"([^"]*)"\s*,?\s*$/.exec(line)
    if (entry) labels[entry[1]] = entry[2]
  }

  return labels
}
