#!/usr/bin/env node
/**
 * Rulează un set de teste și confirmă rezultatul printr-un marcaj de succes.
 *
 * Diferența față de `vitest run` simplu: verificarea nu se mulțumește cu un cod
 * de ieșire zero. Citește raportul JSON și cere trei lucruri deodată — zero
 * teste picate, zero teste nerulate și **cel puțin** numărul minim de teste
 * declarat. Fără ultima condiție, un filtru scris greșit care nu potrivește
 * niciun fișier ar putea trece drept succes, iar gate-ul ar certifica o
 * verificare care nu s-a întâmplat.
 *
 * Utilizare:
 *
 *     node scripts/run-tests-gate.mjs <MARCAJ> <minim> <fișier...>
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function main() {
  const [token, minimum, ...files] = process.argv.slice(2)

  if (!token || !minimum || files.length === 0) {
    console.error(
      'Utilizare: node scripts/run-tests-gate.mjs <MARCAJ> <minim> <fișier...>',
    )
    process.exitCode = 1
    return
  }

  const expected = Number(minimum)
  if (!Number.isInteger(expected) || expected <= 0) {
    console.error(
      `Numărul minim de teste trebuie să fie un întreg pozitiv, nu „${minimum}".`,
    )
    process.exitCode = 1
    return
  }

  const directory = mkdtempSync(join(tmpdir(), 'vitest-gate-'))
  const reportPath = join(directory, 'report.json')

  const run = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      '--reporter=json',
      `--outputFile=${reportPath}`,
      ...files,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch {
    console.error(run.stdout || '')
    console.error(run.stderr || '')
    console.error('\nNu am putut citi raportul testelor. Verificarea eșuează.')
    process.exitCode = 1
    return
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }

  const total = report.numTotalTests ?? 0
  const failed = report.numFailedTests ?? 0
  const passed = report.numPassedTests ?? 0
  const pending = report.numPendingTests ?? 0

  console.log(
    `Teste: ${passed} trecute, ${failed} picate, ${pending} sărite, ${total} în total.`,
  )

  const problems = []
  if (run.status !== 0) problems.push(`vitest a ieșit cu codul ${run.status}.`)
  if (failed > 0) problems.push(`${failed} teste au picat.`)
  if (pending > 0) problems.push(`${pending} teste au fost sărite.`)
  if (total < expected) {
    problems.push(
      `Au rulat ${total} teste, dar gate-ul cere cel puțin ${expected}. ` +
        'Fie filtrul de fișiere nu mai potrivește nimic, fie au fost șterse teste.',
    )
  }

  if (problems.length > 0) {
    console.error(run.stdout || '')
    console.error(run.stderr || '')
    console.error('\nProbleme:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  console.log(token)
}

main()
