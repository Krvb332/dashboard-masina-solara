#!/usr/bin/env node
/**
 * Verifică referința de traseu: geometria, altitudinea, sincronizarea dintre
 * cele două tabele și faptul că simulatorul emite chiar pe circuit.
 *
 * Scriptul **nu importă** modulele pe care le verifică. Tabelele sunt citite
 * textual, iar geometria este recalculată aici, cu implementare proprie. Nu este
 * duplicare din neglijență, este chiar rostul verificării: dacă ar folosi
 * aceleași funcții, ar confirma doar că ele sunt consecvente cu ele însele. O
 * greșeală de semn în proiecție ar trece neobservată de un test care o folosește
 * ca să calculeze răspunsul așteptat.
 *
 * Utilizare:
 *
 *     node scripts/verify-track-reference.mjs --geometry
 *     node scripts/verify-track-reference.mjs --elevation
 *     node scripts/verify-track-reference.mjs --sync
 *     node scripts/verify-track-reference.mjs --simulator
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const TS_DATA = 'src/lib/track-zolder.ts'
const PY_DATA = 'server/simulator/track_zolder_data.py'
const PYTHON = 'server/.venv/bin/python'

/** Lungimea publicată a circuitului Zolder, în metri. */
const OFFICIAL_LENGTH_M = 4011

/** Coordonatele publicate ale circuitului: 50°59′23″N, 5°15′24″E. */
const PUBLISHED = [50.98972, 5.25667]

/** Cât de departe de linia mediană mai este considerat „pe traseu". */
const CORRIDOR_M = 25

// --- geometrie, implementată independent -----------------------------------

function degreeScales(latitudeDeg) {
  const phi = (latitudeDeg * Math.PI) / 180
  return {
    lat:
      111_132.92 -
      559.82 * Math.cos(2 * phi) +
      1.175 * Math.cos(4 * phi) -
      0.0023 * Math.cos(6 * phi),
    lon:
      111_412.84 * Math.cos(phi) -
      93.5 * Math.cos(3 * phi) +
      0.118 * Math.cos(5 * phi),
  }
}

function haversineMeters(a, b) {
  const radius = 6_371_008.8
  const toRad = (deg) => (deg * Math.PI) / 180
  const h =
    Math.sin(toRad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(toRad(a[0])) *
      Math.cos(toRad(b[0])) *
      Math.sin(toRad(b[1] - a[1]) / 2) ** 2
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Nodurile aduse într-un cadru metric plan, cu distanțe cumulate. */
function buildFrame(nodes) {
  const lats = nodes.map((node) => node[0])
  const lons = nodes.map((node) => node[1])
  const origin = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lons) + Math.max(...lons)) / 2,
  ]
  const scales = degreeScales(origin[0])

  const local = nodes.map((node) => [
    (node[1] - origin[1]) * scales.lon,
    (node[0] - origin[0]) * scales.lat,
  ])

  let length = 0
  const cumulative = [0]
  for (let index = 0; index < local.length; index += 1) {
    const from = local[index]
    const to = local[(index + 1) % local.length]
    length += Math.hypot(to[0] - from[0], to[1] - from[1])
    cumulative.push(length)
  }

  return { origin, scales, local, cumulative, length }
}

/** Distanța de la un punct geografic până la linia mediană, în metri. */
function distanceToTrack(frame, lat, lon) {
  const x = (lon - frame.origin[1]) * frame.scales.lon
  const y = (lat - frame.origin[0]) * frame.scales.lat

  let best = Infinity
  for (let index = 0; index < frame.local.length; index += 1) {
    const from = frame.local[index]
    const to = frame.local[(index + 1) % frame.local.length]
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const lengthSq = dx * dx + dy * dy
    if (lengthSq === 0) continue

    let ratio = ((x - from[0]) * dx + (y - from[1]) * dy) / lengthSq
    ratio = Math.max(0, Math.min(1, ratio))
    best = Math.min(
      best,
      Math.hypot(x - (from[0] + dx * ratio), y - (from[1] + dy * ratio)),
    )
  }
  return best
}

// --- citirea tabelelor -----------------------------------------------------

function readNodes(path, pattern) {
  if (!existsSync(path)) fail(`lipsește fișierul ${path}`)
  const text = readFileSync(path, 'utf8')
  const nodes = []
  for (const match of text.matchAll(pattern)) {
    nodes.push([Number(match[1]), Number(match[2]), Number(match[3])])
  }
  if (nodes.length === 0) {
    fail(`nu am găsit niciun nod în ${path} — s-a schimbat formatul?`)
  }
  return nodes
}

const tsNodes = () =>
  readNodes(
    TS_DATA,
    /^\s*\[(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)\],\s*$/gm,
  )

const pyNodes = () =>
  readNodes(
    PY_DATA,
    /^\s*\((-?\d+\.\d+),\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)\),\s*$/gm,
  )

function tsSectors() {
  const text = readFileSync(TS_DATA, 'utf8')
  const sectors = []
  const pattern =
    /\{\s*name:\s*'([^']+)',\s*ref:\s*(?:'([^']+)'|null),\s*fromIndex:\s*(\d+)\s*\}/g
  for (const match of text.matchAll(pattern)) {
    sectors.push({
      name: match[1],
      ref: match[2] ?? null,
      fromIndex: Number(match[3]),
    })
  }
  return sectors
}

// --- raportare -------------------------------------------------------------

const problems = []

function check(condition, message) {
  if (!condition) problems.push(message)
}

function fail(message) {
  console.error(`EȘEC: ${message}`)
  process.exit(1)
}

function report(token) {
  if (problems.length > 0) {
    console.error('\nProbleme:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(token)
}

// --- verificările ----------------------------------------------------------

function verifyGeometry() {
  const nodes = tsNodes()
  const frame = buildFrame(nodes)

  console.log(`Noduri: ${nodes.length}`)
  check(nodes.length > 100, `prea puține noduri (${nodes.length})`)

  // Bucla nu are voie să repete nodul de start: ar da un segment nul.
  const closure = haversineMeters(nodes[0], nodes[nodes.length - 1])
  console.log(`Ultimul nod la ${closure.toFixed(1)} m de primul`)
  check(closure > 1, 'ultimul nod repetă primul — segment de lungime zero')
  check(
    closure < 300,
    `bucla nu se închide: ${closure.toFixed(1)} m între capete`,
  )

  // Lungimea, măsurată în două feluri independente.
  let spherical = 0
  for (let index = 0; index < nodes.length; index += 1) {
    spherical += haversineMeters(nodes[index], nodes[(index + 1) % nodes.length])
  }
  const deviation = Math.abs(frame.length - OFFICIAL_LENGTH_M) / OFFICIAL_LENGTH_M
  console.log(
    `Lungime: ${frame.length.toFixed(2)} m în cadru local, ` +
      `${spherical.toFixed(2)} m pe sferă; oficial ${OFFICIAL_LENGTH_M} m ` +
      `(abatere ${(deviation * 100).toFixed(2)} %)`,
  )
  check(
    deviation < 0.01,
    `lungimea diferă de cea oficială cu ${(deviation * 100).toFixed(2)} %`,
  )

  // Locul: circuitul este la Heusden-Zolder, nu oriunde.
  const lats = nodes.map((node) => node[0])
  const lons = nodes.map((node) => node[1])
  console.log(
    `Încadrare: ${Math.min(...lats).toFixed(4)}..${Math.max(...lats).toFixed(4)} N, ` +
      `${Math.min(...lons).toFixed(4)}..${Math.max(...lons).toFixed(4)} E`,
  )
  check(Math.min(...lats) > 50.98 && Math.max(...lats) < 51.0, 'latitudine greșită')
  check(Math.min(...lons) > 5.24 && Math.max(...lons) < 5.27, 'longitudine greșită')

  // Originea distanței este linia de start.
  const toStart = haversineMeters(nodes[0], PUBLISHED)
  console.log(
    `Nodul 0 la ${toStart.toFixed(1)} m de coordonatele publicate ale circuitului`,
  )
  check(toStart < 60, `originea este la ${toStart.toFixed(0)} m de start/sosire`)

  // Numerotarea oficială a virajelor, în ordine.
  const refs = tsSectors()
    .map((sector) => sector.ref)
    .filter((ref) => ref !== null)
  const expected = Array.from({ length: 16 }, (_, index) => `T${index + 1}`)
  console.log(`Viraje: ${refs.join(' ')}`)
  check(
    refs.join(' ') === expected.join(' '),
    `numerotarea virajelor nu este T1..T16 în ordine: ${refs.join(' ')}`,
  )

  report('VERIFY-GEOMETRY-OK')
}

function verifyElevation() {
  const nodes = tsNodes()
  const frame = buildFrame(nodes)

  const missing = nodes.filter((node) => !Number.isFinite(node[2]))
  check(missing.length === 0, `${missing.length} noduri fără altitudine`)

  const elevations = nodes.map((node) => node[2])
  const relief = Math.max(...elevations) - Math.min(...elevations)
  console.log(
    `Altitudine: ${Math.min(...elevations).toFixed(1)}..` +
      `${Math.max(...elevations).toFixed(1)} m, relief ${relief.toFixed(1)} m, ` +
      `pe ${nodes.length} noduri fără valori lipsă`,
  )
  check(relief > 10, `relief de doar ${relief.toFixed(1)} m — altitudinea lipsește?`)
  check(relief < 60, `relief de ${relief.toFixed(1)} m — artefact al modelului?`)

  // Bucla închisă: altitudinea trebuie să revină de unde a plecat.
  let steepest = 0
  let steepestAt = 0
  for (let index = 0; index < nodes.length; index += 1) {
    const next = (index + 1) % nodes.length
    const run = Math.hypot(
      frame.local[next][0] - frame.local[index][0],
      frame.local[next][1] - frame.local[index][1],
    )
    if (run < 5) continue
    const grade = Math.abs((nodes[next][2] - nodes[index][2]) / run)
    if (grade > steepest) {
      steepest = grade
      steepestAt = index
    }
  }
  console.log(
    `Cea mai mare pantă între noduri: ${(steepest * 100).toFixed(1)} % ` +
      `(nodul ${steepestAt})`,
  )
  check(steepest < 0.15, `pantă imposibilă de ${(steepest * 100).toFixed(1)} %`)

  report('VERIFY-ELEVATION-OK')
}

function verifySync() {
  const fromTs = tsNodes()
  const fromPy = pyNodes()

  console.log(`TypeScript: ${fromTs.length} noduri; Python: ${fromPy.length} noduri`)
  check(
    fromTs.length === fromPy.length,
    `tabelele au lungimi diferite: ${fromTs.length} față de ${fromPy.length}`,
  )

  let mismatches = 0
  const limit = Math.min(fromTs.length, fromPy.length)
  for (let index = 0; index < limit; index += 1) {
    for (let field = 0; field < 3; field += 1) {
      if (fromTs[index][field] !== fromPy[index][field]) {
        if (mismatches < 5) {
          problems.push(
            `nodul ${index}, câmpul ${field}: ` +
              `${fromTs[index][field]} în TS, ${fromPy[index][field]} în Python`,
          )
        }
        mismatches += 1
      }
    }
  }

  if (mismatches === 0) {
    console.log('Cele două tabele sunt identice, nod cu nod.')
  } else {
    problems.push(`${mismatches} valori diferă între cele două tabele`)
  }

  report('VERIFY-SYNC-OK')
}

function verifySimulator() {
  if (!existsSync(PYTHON)) {
    fail(
      `lipsește interpretorul ${PYTHON}. Creează mediul virtual al serverului ` +
        'înainte de verificare.',
    )
  }

  // Simulatorul rulează chiar el, prin `step`, nu se rescrie modelul aici:
  // ce se verifică este ce ajunge efectiv în telemetrie.
  const script = `
import json, random, sys
sys.path.insert(0, "server")
from simulator.simulate import CarState, step
from simulator.track_zolder import TRACK_LENGTH_M

rng = random.Random(20260917)
state = CarState()
points, speeds = [], []
# Destule secunde pentru mai mult de un tur complet, la orice viteză plauzibilă.
for _ in range(6000):
    frame = step(state, 0.1, rng)
    points.append((frame["gps_latitude_deg"], frame["gps_longitude_deg"]))
    speeds.append(frame["vehicle_speed_kph"])

print(json.dumps({
    "points": points,
    "laps": state.lap,
    "s_m": state.s_m,
    "distance_m": state.distance_m,
    "track_length_m": TRACK_LENGTH_M,
    "speed_min": min(speeds),
    "speed_max": max(speeds),
}))
`

  const run = spawnSync(PYTHON, ['-c', script], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

  if (run.status !== 0) {
    console.error(run.stderr || '')
    fail('simulatorul nu a rulat')
  }

  let result
  try {
    result = JSON.parse(run.stdout)
  } catch {
    console.error(run.stdout?.slice(0, 500) ?? '')
    fail('simulatorul nu a întors JSON')
  }

  const frame = buildFrame(tsNodes())

  // Coordonatele emise trebuie să cadă pe circuitul pe care dashboardul își
  // proiectează fixurile — altfel toată maparea este moartă la prima rulare.
  let worst = 0
  let outside = 0
  for (const [lat, lon] of result.points) {
    const distance = distanceToTrack(frame, lat, lon)
    worst = Math.max(worst, distance)
    if (distance > CORRIDOR_M) outside += 1
  }

  console.log(
    `${result.points.length} fixuri emise; cel mai depărtat la ` +
      `${worst.toFixed(2)} m de linia mediană, ${outside} în afara coridorului ` +
      `de ${CORRIDOR_M} m`,
  )
  check(outside === 0, `${outside} fixuri emise cad în afara circuitului`)
  check(worst < 1, `abatere de ${worst.toFixed(1)} m față de linia mediană`)

  // Distanța parcursă trebuie să fie exact turele complete plus bucata din
  // turul curent. Este o identitate, nu o aproximare: dacă avansul pe traseu
  // și odometrul s-ar desincroniza, aici s-ar vedea imediat.
  //
  // Împărțirea distanței la numărul de ture ar fi fost verificarea comodă și
  // greșită — rularea nu se termină pe linia de start, deci raportul iese
  // sistematic mai mare și ar cere o toleranță largă, în care ar încăpea și o
  // eroare adevărată.
  check(result.laps >= 1, `simulatorul a încheiat doar ${result.laps} tururi`)
  const expected = result.laps * result.track_length_m + result.s_m
  const error = Math.abs(result.distance_m - expected)
  console.log(
    `${result.laps} tururi + ${result.s_m.toFixed(1)} m; odometru ` +
      `${result.distance_m.toFixed(2)} m, geometrie ${expected.toFixed(2)} m ` +
      `(diferență ${error.toFixed(3)} m)`,
  )
  check(
    error < 1,
    `odometrul și poziția pe traseu diferă cu ${error.toFixed(2)} m`,
  )

  // Viteza trebuie să varieze: pe geometria reală, șicanele încetinesc mașina.
  console.log(
    `Viteză între ${result.speed_min.toFixed(1)} și ${result.speed_max.toFixed(1)} km/h`,
  )
  check(
    result.speed_max - result.speed_min > 20,
    'viteza nu variază — traseul nu îi impune nimic',
  )

  report('VERIFY-SIMULATOR-OK')
}

// --- intrare ---------------------------------------------------------------

const mode = process.argv[2]
const modes = {
  '--geometry': verifyGeometry,
  '--elevation': verifyElevation,
  '--sync': verifySync,
  '--simulator': verifySimulator,
}

if (!(mode in modes)) {
  console.error(
    `Utilizare: node scripts/verify-track-reference.mjs ${Object.keys(modes).join('|')}`,
  )
  process.exit(1)
}

modes[mode]()
