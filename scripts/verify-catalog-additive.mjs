#!/usr/bin/env node
/**
 * Verifică faptul că modificările aduse catalogului de semnale sunt **aditive**.
 *
 * Etichetele, unitățile, zecimalele și pragurile semnalelor existente descriu
 * mașina reală: au fost stabilite din fișele senzorilor și din experiența
 * echipei. Adăugarea unor semnale noi nu are voie să le atingă, oricât de
 * tentant ar fi „să le facă mai consecvente" — un prag mutat în tăcere schimbă
 * momentul în care sună o alarmă în cursă.
 *
 * Referința este versiunea din `main` (sau din `HEAD`, dacă `main` nu există
 * local). Scriptul compară definiție cu definiție, câmp cu câmp.
 *
 * Rulează pe Node pur: catalogul este citit textual, cu același parser folosit
 * de celelalte verificări.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseGroupLabels, parseSignalCatalog } from './lib/parse-signals.mjs'

const CATALOG_PATH = 'server/app/signals.py'

/**
 * Semnale scoase deliberat din catalog, cu motivul. Scriptul apără catalogul de
 * dispariții *accidentale*; o retragere decisă de echipă se consemnează aici,
 * ca verificarea să rămână strictă pentru tot restul.
 */
/**
 * Praguri schimbate deliberat, decise de echipă. Fiecare intrare spune exact ce
 * câmp, de la ce valoare la ce valoare; orice altă modificare a unui câmp
 * protejat rămâne o eroare.
 */
const APPROVED_CHANGES = [
  {
    keys: /^cell_\d{2}_v$|^cell_voltage_max_v$/,
    field: 'warn_above',
    from: 4.15,
    to: 4.25,
    reason: 'echipa: până la 4,25 V nu este o problemă (18.09.2026)',
  },
  {
    keys: /^cell_\d{2}_v$|^cell_voltage_max_v$/,
    field: 'crit_above',
    from: 4.22,
    to: 4.3,
    reason: 'pragul critic urcă odată cu cel de avertizare',
  },
  {
    keys: /^cell_\d{2}_v$|^cell_voltage_(min|max)_v$/,
    field: 'max',
    from: 4.3,
    to: 4.35,
    reason: 'domeniul senzorului trebuie să cuprindă pragul critic',
  },
  {
    keys: /^battery_current_a$/,
    field: 'warn_above',
    from: 75,
    to: 45,
    reason: 'echipa: până la 45 A nu este supracurent (18.09.2026)',
  },
  {
    keys: /^battery_current_a$/,
    field: 'crit_above',
    from: 95,
    to: 56,
    reason: '1,25 × pragul de avertizare, ca pe serverul live',
  },
]

function isApproved(key, field, was, now) {
  return APPROVED_CHANGES.some(
    (change) =>
      change.keys.test(key) &&
      change.field === field &&
      change.from === was &&
      change.to === now,
  )
}

const RETIRED_SIGNALS = new Map([
  ['mppt3_power_w', 'mașina are doar două convertoare MPPT'],
  ['mppt4_power_w', 'mașina are doar două convertoare MPPT'],
])

/** Câmpurile care descriu comportamentul semnalului și nu au voie să se schimbe. */
const PROTECTED_FIELDS = [
  'label',
  'unit',
  'group',
  'decimals',
  'min',
  'max',
  'stale_after_s',
  'warn_below',
  'crit_below',
  'warn_above',
  'crit_above',
  'hysteresis',
  'overview',
  'chartable',
  'color',
]

/** Valorile implicite din dataclass-ul `Signal`, pentru câmpurile omise. */
const DEFAULTS = {
  decimals: 1,
  min: null,
  max: null,
  stale_after_s: 2.0,
  warn_below: null,
  crit_below: null,
  warn_above: null,
  crit_above: null,
  hysteresis: 0.0,
  overview: false,
  chartable: true,
  color: null,
  description: '',
}

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' })
}

function pickBaseline() {
  const explicit = process.argv[2]
  if (explicit) return explicit

  const main = git(['rev-parse', '--verify', '--quiet', 'main'])
  if (main.status === 0) return 'main'

  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (head.status === 0) return 'HEAD'

  return null
}

function fieldOf(signal, field) {
  return signal[field] === undefined ? DEFAULTS[field] : signal[field]
}

function main() {
  const baseline = pickBaseline()

  if (baseline === null) {
    console.error(
      'Nu există niciun commit față de care să compar catalogul. ' +
        'Verificarea are nevoie de un depozit Git cu cel puțin un commit.',
    )
    process.exitCode = 1
    return
  }

  const show = git(['show', `${baseline}:${CATALOG_PATH}`])
  if (show.status !== 0) {
    console.error(
      `Nu am putut citi ${CATALOG_PATH} din „${baseline}": ${show.stderr.trim()}`,
    )
    process.exitCode = 1
    return
  }

  const directory = mkdtempSync(join(tmpdir(), 'catalog-baseline-'))
  const referencePath = join(directory, 'signals.py')
  writeFileSync(referencePath, show.stdout, 'utf8')

  const before = parseSignalCatalog(referencePath)
  const after = parseSignalCatalog(CATALOG_PATH)
  const afterByKey = new Map(after.map((signal) => [signal.key, signal]))

  const beforeGroups = parseGroupLabels(referencePath)
  const afterGroups = parseGroupLabels(CATALOG_PATH)

  const problems = []

  for (const signal of before) {
    const current = afterByKey.get(signal.key)

    if (current === undefined) {
      if (RETIRED_SIGNALS.has(signal.key)) continue
      problems.push(`Semnalul „${signal.key}" a dispărut din catalog.`)
      continue
    }

    for (const field of PROTECTED_FIELDS) {
      const was = fieldOf(signal, field)
      const now = fieldOf(current, field)
      if (was !== now) {
        if (isApproved(signal.key, field, was, now)) continue
        problems.push(
          `Semnalul „${signal.key}": câmpul „${field}" s-a schimbat din ${JSON.stringify(was)} în ${JSON.stringify(now)}.`,
        )
      }
    }
  }

  for (const [group, label] of Object.entries(beforeGroups)) {
    if (afterGroups[group] === undefined) {
      problems.push(`Grupul „${group}" a dispărut din GROUP_LABELS.`)
    } else if (afterGroups[group] !== label) {
      problems.push(
        `Eticheta grupului „${group}" s-a schimbat din „${label}" în „${afterGroups[group]}".`,
      )
    }
  }

  const added = after.length - before.length

  console.log(`Referință: ${baseline}`)
  console.log(
    `Catalog: ${before.length} semnale înainte, ${after.length} acum (${added >= 0 ? '+' : ''}${added}).`,
  )
  console.log(
    `Grupuri: ${Object.keys(beforeGroups).length} înainte, ${Object.keys(afterGroups).length} acum.`,
  )

  if (problems.length > 0) {
    console.error('\nModificări care NU sunt aditive:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  console.log('CATALOG ADITIV OK')
}

main()
