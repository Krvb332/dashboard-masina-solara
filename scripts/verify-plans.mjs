#!/usr/bin/env node
/**
 * Verifică faptul că planurile de integrare acoperă fiecare semnal nou.
 *
 * Un plan care omite trei chei nu arată incomplet: arată exact ca unul complet,
 * până când cineva îl urmează și descoperă în pitlane că trei carduri rămân
 * goale. Scriptul compară lista de semnale adăugate față de referință cu ce
 * numesc efectiv cele două documente.
 *
 * Cheile generate în serie (`cell_01_v` … `cell_32_v`) se acceptă printr-un
 * reprezentant explicit plus tiparul descris în text: a le enumera pe toate
 * treizeci și două în proză ar face documentul mai greu de citit fără să adauge
 * nimic.
 *
 * Rulează pe Node pur.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSignalCatalog } from './lib/parse-signals.mjs'

const PLANS = [
  {
    path: 'docs/plan-server-semnale-noi.md',
    label: 'planul pentru server',
    /** Secțiuni pe care planul trebuie să le acopere, ca text căutat literal. */
    required: [
      'chassis',
      'board',
      'GROUP_LABELS',
      'signalGroupSchema',
      'verify-signal-mapping.mjs',
      'verify-catalog-additive.mjs',
    ],
  },
  {
    path: 'docs/plan-teensy-semnale-noi.md',
    label: 'planul pentru Teensy',
    required: [
      'ddmm.mmmm',
      'GGA',
      'GSA',
      'sequence',
      'MITSUBA_ERROR_BITS',
      'schema_version',
    ],
  },
]

/** Cheile generate în serie: un reprezentant în text este de ajuns. */
const SERIES = [
  {
    pattern: /^cell_\d{2}_v$/,
    representative: 'cell_01_v',
    description: 'celulele individuale',
  },
]

function baselineCatalog() {
  const main = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'main'], {
    encoding: 'utf8',
  })
  const reference = main.status === 0 ? 'main' : 'HEAD'

  const show = spawnSync(
    'git',
    ['show', `${reference}:server/app/signals.py`],
    {
      encoding: 'utf8',
    },
  )
  if (show.status !== 0) return null

  const directory = mkdtempSync(join(tmpdir(), 'plan-baseline-'))
  const path = join(directory, 'signals.py')
  writeFileSync(path, show.stdout, 'utf8')
  return {
    keys: new Set(parseSignalCatalog(path).map((s) => s.key)),
    reference,
  }
}

function main() {
  const problems = []

  for (const plan of PLANS) {
    if (!existsSync(plan.path)) {
      problems.push(`Lipsește ${plan.path}.`)
    }
  }

  if (problems.length > 0) {
    console.error('Probleme:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  const baseline = baselineCatalog()
  if (baseline === null) {
    console.error(
      'Nu am putut citi catalogul de referință din Git. Verificarea are nevoie ' +
        'de un depozit cu cel puțin un commit care conține server/app/signals.py.',
    )
    process.exitCode = 1
    return
  }

  const current = parseSignalCatalog('server/app/signals.py')
  const added = current
    .map((signal) => signal.key)
    .filter((key) => !baseline.keys.has(key))

  if (added.length === 0) {
    console.error(
      'Nu am găsit niciun semnal adăugat față de referință. Verificarea nu ar ' +
        'demonstra nimic despre acoperirea planurilor, deci o raportez ca eșec.',
    )
    process.exitCode = 1
    return
  }

  const texts = PLANS.map((plan) => ({
    ...plan,
    text: readFileSync(plan.path, 'utf8'),
  }))

  const combined = texts.map((plan) => plan.text).join('\n')

  const missing = []
  const seriesCovered = new Set()
  let explicit = 0
  let viaSeries = 0

  for (const key of added) {
    const series = SERIES.find((entry) => entry.pattern.test(key))

    if (series !== undefined) {
      if (combined.includes(key)) {
        explicit += 1
        continue
      }
      if (combined.includes(series.representative)) {
        seriesCovered.add(series.description)
        viaSeries += 1
        continue
      }
      missing.push(`${key} (seria „${series.description}")`)
      continue
    }

    if (combined.includes(key)) explicit += 1
    else missing.push(key)
  }

  for (const plan of texts) {
    for (const needle of plan.required) {
      if (!plan.text.includes(needle)) {
        problems.push(`${plan.label} nu menționează „${needle}".`)
      }
    }

    // Un plan trebuie să spună și ce se întâmplă când un senzor tace.
    if (!/nu are voie|omite|lipse/i.test(plan.text)) {
      problems.push(
        `${plan.label} nu explică ce se trimite când un senzor nu răspunde.`,
      )
    }
  }

  console.log(`Referință: ${baseline.reference}`)
  console.log(`Semnale adăugate: ${added.length}`)
  console.log(`Numite explicit în planuri: ${explicit}`)
  if (viaSeries > 0) {
    console.log(
      `Acoperite prin tipar de serie: ${viaSeries} (${[...seriesCovered].join(', ')})`,
    )
  }
  console.log(`Neacoperite: ${missing.length}`)

  if (missing.length > 0) {
    problems.push(`Semnale neacoperite de niciun plan: ${missing.join(', ')}`)
  }

  if (problems.length > 0) {
    console.error('\nProbleme:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  console.log('VERIFICARE PLANURI OK')
}

main()
