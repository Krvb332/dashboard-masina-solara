/**
 * Verifică raportul de audit `docs/audit-performanta.md`.
 *
 * Fiecare ipoteză din plan (B1, B2, P1–P5, D1–D8, S1–S4) trebuie să aibă un
 * rând în tabelul de verdicte cu un verdict explicit; ipotezele confirmate sau
 * măsurate trebuie să poarte cel puțin o cifră cu unitate. Scriptul tipărește
 * `AUDIT_REPORT_OK` doar după ce toate verificările trec.
 *
 * Control negativ: rulat pe un fișier fără una dintre ipoteze, sau cu un
 * verdict lipsă, iese cu cod 1 — vezi `--self-test`.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HYPOTHESES = [
  'B1', 'B2',
  'P1', 'P2', 'P3', 'P4', 'P5',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8',
  'S1', 'S2', 'S3', 'S4',
]
const VERDICTS = ['confirmat', 'infirmat', 'parțial', 'limitare']
const NUMBER_WITH_UNIT =
  /\d[\d.,]*\s?(?:%|ms|µs|s\b|Hz|KB|MB|GB|Wh|km|m\b|mesaje\/s|rânduri\/s|MB\/s|re-randări)/u

function check(markdown) {
  const errors = []
  const tableRows = markdown
    .split('\n')
    .filter((line) => line.startsWith('|'))

  for (const id of HYPOTHESES) {
    const row = tableRows.find((line) => new RegExp(`^\\|\\s*\\*{0,2}${id}\\*{0,2}\\s*\\|`).test(line))
    if (!row) {
      errors.push(`lipsește rândul din tabel pentru ${id}`)
      continue
    }
    const cells = row.split('|').map((cell) => cell.trim())
    const verdictCell = cells[2] ?? ''
    const verdict = VERDICTS.find((word) => verdictCell.toLowerCase().includes(word))
    if (!verdict) {
      errors.push(`${id}: verdictul nu este unul dintre ${VERDICTS.join(', ')} („${verdictCell}")`)
      continue
    }
    if (!NUMBER_WITH_UNIT.test(row)) {
      errors.push(`${id}: rândul nu conține nicio cifră cu unitate`)
    }
  }
  return errors
}

function selfTest() {
  const good = HYPOTHESES.map((id) => `| ${id} | confirmat | 12 ms |`).join('\n')
  const missing = HYPOTHESES.slice(1).map((id) => `| ${id} | confirmat | 12 ms |`).join('\n')
  const noVerdict = HYPOTHESES.map((id) => `| ${id} | ${id === 'D3' ? 'de văzut' : 'confirmat'} | 12 ms |`).join('\n')
  const noNumber = HYPOTHESES.map((id) => `| ${id} | confirmat | ${id === 'S2' ? 'fără cifră' : '12 ms'} |`).join('\n')

  if (check(good).length !== 0) throw new Error('controlul pozitiv a picat')
  if (check(missing).length === 0) throw new Error('controlul negativ (rând lipsă) nu a picat')
  if (check(noVerdict).length === 0) throw new Error('controlul negativ (fără verdict) nu a picat')
  if (check(noNumber).length === 0) throw new Error('controlul negativ (fără cifră) nu a picat')
  console.log('self-test OK: controalele negative pică, cel pozitiv trece')
}

const args = process.argv.slice(2)
if (args.includes('--self-test')) {
  selfTest()
}

const path = resolve(args.find((arg) => !arg.startsWith('--')) ?? 'docs/audit-performanta.md')
const errors = check(readFileSync(path, 'utf8'))
if (errors.length > 0) {
  for (const error of errors) console.error(`EROARE: ${error}`)
  process.exit(1)
}
console.log(`${HYPOTHESES.length} ipoteze cu verdict și cifre în ${path}`)
console.log('AUDIT_REPORT_OK')
