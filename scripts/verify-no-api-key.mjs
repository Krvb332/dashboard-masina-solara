#!/usr/bin/env node
/**
 * Caută chei API Google scăpate în depozit sau în bundle-ul construit.
 *
 * Secțiunea meteo folosește o cheie Google Maps Platform. Ea trebuie să stea
 * într-un singur loc — `server/.env`, care nu intră în git — și să nu ajungă
 * niciodată nici într-un fișier urmărit, nici în `dist/`, care este exact
 * textul livrat browserului. O cheie publicată este o cheie pierdută: oricine o
 * găsește o poate folosi pe factura echipei.
 *
 * Verificarea are două părți, iar ordinea lor contează:
 *
 *  1. **Controlul pozitiv.** Înainte de a declara că nu există chei, scanerul
 *     își demonstrează sensibilitatea pe un fișier care conține una. Un scaner
 *     stricat raportează „curat" pe orice, inclusiv pe un depozit plin de chei;
 *     fără controlul acesta, „nicio potrivire" nu ar dovedi nimic.
 *  2. **Scanarea propriu-zisă**, peste fișierele urmărite de git plus `dist/`.
 *
 * Cheia de control este compusă din bucăți la rulare, ca fișierul de față — el
 * însuși urmărit de git — să nu conțină un șir care arată ca o cheie.
 *
 * Rulare: `node scripts/verify-no-api-key.mjs`
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Formatul cheilor Google: prefixul `AIza` și 35 de caractere din alfabetul URL-safe. */
const GOOGLE_KEY = /AIza[0-9A-Za-z_-]{35}/g

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Peste atâția octeți fișierul este aproape sigur binar sau generat. */
const MAX_BYTES = 8 * 1024 * 1024

/** Extensii binare: nu au ce ascunde în text și ar umple raportul cu gunoi. */
const BINARY = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.db',
  '.sqlite',
])

function isBinary(path) {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? false : BINARY.has(path.slice(dot).toLowerCase())
}

function readText(path) {
  try {
    if (statSync(path).size > MAX_BYTES) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Ascunde mijlocul unei chei: raportul nu trebuie să publice el însuși secretul. */
function mask(key) {
  return `${key.slice(0, 8)}…${key.slice(-4)} (${key.length} caractere)`
}

function findKeys(text) {
  return [...text.matchAll(GOOGLE_KEY)].map((match) => match[0])
}

// --- 1. controlul pozitiv --------------------------------------------------

function positiveControl() {
  // Compusă din bucăți: literalul complet nu apare nicăieri în acest fișier.
  // Lungimea trebuie să fie exact cea a unei chei reale — 4 + 35 caractere —
  // altfel tiparul ar potrivi doar un prefix, iar controlul ar pica degeaba.
  const control = ['AIza', 'Sy', 'D'].join('') + 'A'.repeat(32)
  const directory = mkdtempSync(join(tmpdir(), 'unlazy-key-control-'))
  const file = join(directory, 'control.txt')
  writeFileSync(file, `cheie de control: ${control}\n`, 'utf8')

  const found = findKeys(readText(file) ?? '')
  if (!found.includes(control)) {
    console.error(
      'CONTROL POZITIV EȘUAT: scanerul nu a găsit cheia pe care tocmai a scris-o.',
    )
    console.error(
      'Absența potrivirilor nu ar dovedi nimic. Verificarea se oprește.',
    )
    return false
  }

  console.log(`Control pozitiv: cheia ${mask(control)} a fost detectată.`)
  return true
}

// --- 2. scanarea -----------------------------------------------------------

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return output.split('\0').filter(Boolean)
}

function builtFiles() {
  try {
    const output = execFileSync(
      'git',
      [
        'ls-files',
        '-z',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--',
        'dist',
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    return output.split('\0').filter(Boolean)
  } catch {
    return []
  }
}

function scan(paths, label) {
  const hits = []

  for (const relative of paths) {
    if (isBinary(relative)) continue
    const text = readText(join(ROOT, relative))
    if (text === null) continue

    for (const key of findKeys(text)) {
      hits.push({ relative, key })
    }
  }

  console.log(
    `${label}: ${paths.length} fișiere scanate, ${hits.length} potriviri.`,
  )
  return hits
}

// --- raport ----------------------------------------------------------------

function main() {
  if (!positiveControl()) process.exit(1)

  const tracked = scan(trackedFiles(), 'Fișiere urmărite de git')
  const built = scan(builtFiles(), 'Bundle construit (dist/)')
  const hits = [...tracked, ...built]

  if (hits.length > 0) {
    console.error('\nCHEI API GĂSITE ÎN DEPOZIT:')
    for (const hit of hits) {
      console.error(`  ${hit.relative}: ${mask(hit.key)}`)
    }
    console.error(
      '\nMută cheia în server/.env (ignorat de git) și revoc-o pe cea expusă',
      'din consola Google Cloud. O cheie care a fost comisă rămâne compromisă',
      'chiar dacă este ștearsă din fișier: istoricul git o păstrează.',
    )
    process.exit(1)
  }

  if (built.length === 0 && builtFiles().length === 0) {
    console.log(
      'Notă: `dist/` nu conține fișiere de scanat. Rulează `npm run build`',
      'înainte, dacă vrei să verifici și bundle-ul livrat browserului.',
    )
  }

  console.log('\nNICIO CHEIE API EXPUSĂ')
  process.exit(0)
}

main()
