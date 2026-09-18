#!/usr/bin/env node
/**
 * Verifică maparea semnalelor între catalogul serverului și dashboard.
 *
 * Frontendul își construiește interfața din `GET /api/v1/signals`. Când un
 * component cere o cheie care nu există în catalog, nu se întâmplă nimic
 * zgomotos: cardul afișează „—" la fel ca pentru un senzor tăcut. Diferența
 * dintre „senzorul nu răspunde" și „cheia este scrisă greșit" dispare exact
 * când ai nevoie de ea, în pitlane.
 *
 * Scriptul de față face diferența vizibilă la commit, nu la cursă. Rulează pe
 * Node pur, fără interpretor Python: catalogul este citit textual din
 * `server/app/signals.py`.
 *
 * Ce verifică:
 *  1. fiecare cheie folosită în `src/` există în catalog;
 *  2. grupurile folosite de semnale sunt declarate în `GROUP_LABELS` și în
 *     enumerarea Zod din frontend;
 *  3. celulele individuale respectă tiparul pe care îl caută `CellGrid`;
 *  4. fiecare sursă de senzori din `sensor-sources.ts` are cel puțin un semnal;
 *  5. cheile din panourile cu enumerări (`signal-groups.ts`) există.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseGroupLabels, parseSignalCatalog } from './lib/parse-signals.mjs'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * Cheile reale au întotdeauna cel puțin o liniuță de subliniere. Filtrul
 * elimină potrivirile accidentale de tipul `signals.map` sau `.length`, fără să
 * ceară o listă de excepții care s-ar învechi.
 */
const KEY_SHAPE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/

/** Prefixul mărimilor calculate în browser. Nu vin de la server, deci nu se caută în catalog. */
const DERIVED_PREFIX = 'calc_'

/**
 * Chei trimise de serverul live sub alt nume decât în catalogul de referință.
 * Panourile care le cer le rezolvă la rulare din catalogul primit, deci nu
 * sunt greșeli de scriere.
 */
const LIVE_ALIASES = new Map([['temp_teensy_c', 'teensy_temp_c']])

/** Fișiere care declară semnale fictive: testele și fixture-urile lor. */
function isExcluded(path) {
  return (
    path.includes('.test.') ||
    path.includes('/test/') ||
    path.endsWith('derived-buffer.ts')
  )
}

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

/** Tiparele prin care un component numește un semnal. */
const PATTERNS = [
  { name: 'signalKey', regex: /signalKey=["']([a-zA-Z0-9_]+)["']/g },
  { name: 'useSignal', regex: /useSignal\(\s*['"]([a-zA-Z0-9_]+)['"]/g },
  { name: 'toSeries', regex: /toSeries\(\s*['"]([a-zA-Z0-9_]+)['"]/g },
  { name: 'fresh', regex: /fresh\(\s*[^,]+,\s*['"]([a-zA-Z0-9_]+)['"]\s*\)/g },
  { name: 'lookup', regex: /lookup\(\s*['"]([a-zA-Z0-9_]+)['"]\s*\)/g },
  { name: 'signals.', regex: /signals\.([a-zA-Z0-9_]+)/g },
  // Lista de semnale termice din `analytics.ts`: `{ key: 'x', warn: n, crit: n }`.
  // Tiparul cere `warn:` imediat după, ca să nu prindă identificatorii de
  // verificare din `consistency.ts`, care nu sunt chei de semnal.
  {
    name: 'THERMAL_KEYS',
    regex: /\bkey:\s*['"]([a-zA-Z0-9_]+)['"]\s*,\s*warn:/g,
  },
  // Constante de tipul `const X_SIGNAL = 'cheie'` pasate mai departe la
  // `useSignal(X_SIGNAL)`: literalul nu apare în apel, deci trebuie prins aici.
  { name: 'SIGNAL const', regex: /_SIGNAL\s*=\s*['"]([a-zA-Z0-9_]+)['"]/g },
]

/** `const X_SIGNALS = ['a', 'b']` — lista de chei încercate pe rând. */
const SIGNALS_ARRAY_PATTERN = /_SIGNALS\s*=\s*\[([^\]]*)\]/g

/** `signalKeys={[...]}` conține o listă, nu o singură cheie. */
const ARRAY_PATTERN = /signalKeys=\{\[([\s\S]*?)\]\}/g
const QUOTED = /['"]([a-zA-Z0-9_]+)['"]/g

function collectReferences(files) {
  const references = new Map()

  const record = (key, file, pattern) => {
    if (!KEY_SHAPE.test(key)) return
    if (key.startsWith(DERIVED_PREFIX)) return
    const entry = references.get(key) ?? []
    entry.push(`${relative(ROOT, file)} (${pattern})`)
    references.set(key, entry)
  }

  for (const file of files) {
    const source = readFileSync(file, 'utf8')

    for (const { name, regex } of PATTERNS) {
      regex.lastIndex = 0
      let match
      while ((match = regex.exec(source)) !== null) record(match[1], file, name)
    }

    ARRAY_PATTERN.lastIndex = 0
    let block
    while ((block = ARRAY_PATTERN.exec(source)) !== null) {
      QUOTED.lastIndex = 0
      let quoted
      while ((quoted = QUOTED.exec(block[1])) !== null) {
        record(quoted[1], file, 'signalKeys')
      }
    }

    SIGNALS_ARRAY_PATTERN.lastIndex = 0
    while ((block = SIGNALS_ARRAY_PATTERN.exec(source)) !== null) {
      QUOTED.lastIndex = 0
      let quoted
      while ((quoted = QUOTED.exec(block[1])) !== null) {
        record(quoted[1], file, 'SIGNALS const')
      }
    }
  }

  return references
}

/** Cheile numite explicit în `sensor-sources.ts` și `signal-groups.ts`. */
function collectStructuralKeys() {
  const keys = new Set()

  for (const file of [
    'src/lib/sensor-sources.ts',
    'src/lib/signal-groups.ts',
  ]) {
    const source = readFileSync(join(ROOT, file), 'utf8')
    QUOTED.lastIndex = 0
    let match
    while ((match = QUOTED.exec(source)) !== null) {
      if (KEY_SHAPE.test(match[1])) keys.add(match[1])
    }
  }

  return keys
}

/** Prefixele pe care `sensor-sources.ts` le folosește ca surse. */
const SOURCE_PREFIXES = [
  'motor_',
  'battery_',
  'gps_',
  'tpms_',
  'temp_',
  'mppt',
  'teensy_',
]

function main() {
  const catalog = parseSignalCatalog(join(ROOT, 'server/app/signals.py'))
  const keys = new Set(catalog.map((signal) => signal.key))
  const groups = parseGroupLabels(join(ROOT, 'server/app/signals.py'))

  const problems = []

  if (catalog.length !== keys.size) {
    problems.push('Catalogul conține chei duplicate.')
  }

  // 1. referințele din interfață
  const files = walk(SRC).filter((file) => !isExcluded(file))
  const references = collectReferences(files)

  for (const [key, places] of references) {
    if (keys.has(key)) continue
    const alias = LIVE_ALIASES.get(key)
    if (alias !== undefined && keys.has(alias)) continue
    problems.push(
      `Cheia „${key}" este folosită în interfață dar lipsește din catalog: ${places.join(', ')}`,
    )
  }

  // 2. grupuri
  for (const signal of catalog) {
    if (groups[signal.group] === undefined) {
      problems.push(
        `Semnalul „${signal.key}" declară grupul „${signal.group}", care nu are etichetă în GROUP_LABELS.`,
      )
    }
  }

  const zod = readFileSync(join(ROOT, 'src/schemas/telemetry.ts'), 'utf8')
  const zodBlock = /signalGroupSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(zod)
  if (zodBlock === null) {
    problems.push('Nu am găsit signalGroupSchema în src/schemas/telemetry.ts.')
  } else {
    const declared = new Set(
      [...zodBlock[1].matchAll(/'([a-z]+)'/g)].map((match) => match[1]),
    )
    for (const group of Object.keys(groups)) {
      if (!declared.has(group)) {
        problems.push(
          `Grupul „${group}" există pe server dar nu în enumerarea Zod din frontend.`,
        )
      }
    }
    for (const group of declared) {
      if (groups[group] === undefined) {
        problems.push(
          `Grupul „${group}" există în frontend dar nu în GROUP_LABELS de pe server.`,
        )
      }
    }
  }

  // 3. celulele individuale, așa cum le caută CellGrid
  const cellPattern = /^cell_\d{2}_v$/
  const cells = [...keys].filter((key) => cellPattern.test(key)).sort()
  if (cells.length === 0) {
    problems.push(
      'Catalogul nu conține nicio celulă individuală (cell_NN_v); grila de celule ar rămâne goală.',
    )
  } else {
    for (let index = 0; index < cells.length; index += 1) {
      const expected = `cell_${String(index + 1).padStart(2, '0')}_v`
      if (cells[index] !== expected) {
        problems.push(
          `Celulele nu sunt numerotate continuu: am găsit „${cells[index]}" unde așteptam „${expected}".`,
        )
        break
      }
    }
  }

  // 4. fiecare sursă are semnale
  for (const prefix of SOURCE_PREFIXES) {
    const found = [...keys].filter((key) => key.startsWith(prefix))
    if (found.length === 0) {
      problems.push(
        `Nicio cheie nu începe cu „${prefix}"; sursa corespunzătoare din sensor-sources.ts ar dispărea din interfață.`,
      )
    }
  }

  // 5. cheile structurale din panourile cu enumerări
  for (const key of collectStructuralKeys()) {
    if (keys.has(key)) continue
    if (cellPattern.test(key)) continue
    problems.push(
      `Cheia „${key}" este numită în sensor-sources.ts sau signal-groups.ts dar lipsește din catalog.`,
    )
  }

  const referenced = [...references.keys()].filter((key) => keys.has(key))

  console.log(
    `Catalog: ${catalog.length} semnale, ${Object.keys(groups).length} grupuri.`,
  )
  console.log(
    `Interfață: ${references.size} chei distincte, ${referenced.length} confirmate în catalog.`,
  )
  console.log(`Celule individuale: ${cells.length}.`)

  if (problems.length > 0) {
    console.error('\nProbleme de mapare:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  console.log('VERIFICARE MAPARE OK')
}

main()
