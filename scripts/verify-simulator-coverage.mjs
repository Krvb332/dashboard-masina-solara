#!/usr/bin/env node
/**
 * Verifică faptul că simulatorul emite fiecare semnal din catalog și că
 * semnalele redundante pe care le produce sunt coerente între ele.
 *
 * Fără asta, un semnal adăugat în catalog ar apărea în dashboard ca
 * „nerecepționat" în dezvoltare, iar cine îl caută ar pierde o oră întrebându-se
 * dacă e o problemă de frontend, de server sau de simulator.
 *
 * **Cerință de mediu:** un interpretor Python 3.10 sau mai nou. Serverul cere
 * oricum Python 3.13, deci nu adaugă o dependență nouă proiectului; scriptul îl
 * caută singur și spune clar dacă nu îl găsește. Restul verificărilor din
 * `GATES.md` rulează pe Node pur.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SERVER = join(ROOT, 'server')

/**
 * Candidații, în ordinea preferinței. Mediul virtual al serverului primul: dacă
 * echipa l-a creat, acolo este interpretorul cu care rulează serviciul.
 */
const CANDIDATES = [
  join(SERVER, '.venv', 'bin', 'python'),
  join(SERVER, '.venv', 'Scripts', 'python.exe'),
  'python3.14',
  'python3.13',
  'python3.12',
  'python3.11',
  'python3.10',
  'python3',
  'python',
]

const PROBE = 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'

function findPython() {
  for (const candidate of CANDIDATES) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (!existsSync(candidate)) continue
    }
    const result = spawnSync(candidate, ['-c', PROBE], { encoding: 'utf8' })
    if (result.status === 0) return candidate
  }
  return null
}

/**
 * Scriptul rulat în Python. Compară cheile emise cu cele din catalog și
 * confruntă perechile redundante, cu aceleași toleranțe ca `src/lib/consistency.ts`.
 */
const SCRIPT = String.raw`
import json, math, random, sys

sys.path.insert(0, sys.argv[1])

from app.signals import BY_KEY
import simulator.simulate as sim

state = sim.CarState()
rng = random.Random(7)

# Câteva sute de pași: temperaturile și contoarele au nevoie de timp ca să iasă
# din valorile inițiale, iar un singur eșantion nu ar spune nimic despre ele.
for _ in range(600):
    signals = sim.step(state, 0.1, rng)

catalog = set(BY_KEY)
emitted = set(signals)

problems = []
for key in sorted(catalog - emitted):
    problems.append("semnalul '%s' este in catalog dar simulatorul nu il emite" % key)
for key in sorted(emitted - catalog):
    problems.append("simulatorul emite '%s', care nu exista in catalog" % key)

# --- domeniul declarat -----------------------------------------------------
for key, value in sorted(signals.items()):
    signal = BY_KEY.get(key)
    if signal is None:
        continue
    if not math.isfinite(value):
        problems.append("semnalul '%s' are valoarea %r" % (key, value))
        continue
    if signal.min is not None and signal.max is not None:
        span = signal.max - signal.min
        tol = span * 0.2
        if value < signal.min - tol or value > signal.max + tol:
            problems.append(
                "semnalul '%s' = %.4f iese din domeniul declarat [%s, %s]"
                % (key, value, signal.min, signal.max)
            )

# --- coerenta perechilor redundante ---------------------------------------
def near(name, expected, actual, pct, absolute):
    allowed = max(absolute, abs(expected) * pct / 100.0)
    if abs(expected - actual) > allowed:
        problems.append(
            "%s: asteptat %.4f, raportat %.4f (abatere %.4f, permis %.4f)"
            % (name, expected, actual, abs(expected - actual), allowed)
        )

near(
    "putere pachet fata de U*I",
    signals["battery_voltage_v"] * signals["battery_current_a"],
    signals["battery_power_w"],
    8, 60,
)
near(
    "putere solara fata de suma MPPT",
    sum(signals["mppt%d_power_w" % index] for index in range(1, 5)),
    signals["solar_power_w"],
    6, 25,
)
cells = [signals["cell_%02d_v" % index] for index in range(1, 33)]
near("celula minima", min(cells), signals["cell_voltage_min_v"], 1, 0.002)
near("celula maxima", max(cells), signals["cell_voltage_max_v"], 1, 0.002)
near(
    "dezechilibru celule",
    max(cells) - min(cells),
    signals["cell_voltage_delta_v"],
    10, 0.01,
)
near("tensiune pachet fata de suma celulelor", sum(cells), signals["battery_voltage_v"], 4, 2)
near(
    "delta temperatura",
    signals["battery_temp_max_c"] - signals["battery_temp_min_c"],
    signals["battery_temp_delta_c"],
    12, 1,
)
near("viteza GNSS", signals["gps_speed_kph"], signals["vehicle_speed_kph"], 15, 3)

# Indicii extremelor trebuie sa arate chiar spre celulele extreme.
if cells.index(min(cells)) + 1 != int(signals["cell_min_index"]):
    problems.append("cell_min_index nu arata spre celula minima")
if cells.index(max(cells)) + 1 != int(signals["cell_max_index"]):
    problems.append("cell_max_index nu arata spre celula maxima")

# Altitudinea trebuie sa varieze pe parcursul unui tur, altfel profilul de
# elevatie si calculul de pantă nu pot fi verificate deloc.
#
# Tot aici verificam si viteza dedusa din POZITII consecutive, nu din campul
# gps_speed_kph: acela vine din aceeasi variabila ca vehicle_speed_kph, deci
# compararea lor nu ar demonstra ca traseul GPS chiar inainteaza cu viteza
# raportata. Exact aceasta scapare a ascuns o eroare reala in simulator.
altitudini = []
abateri = []
proba = sim.CarState()
proba_rng = random.Random(3)
anterior = None
for _ in range(4000):
    esantion = sim.step(proba, 0.1, proba_rng)
    altitudini.append(esantion["gps_altitude_m"])
    if anterior is not None and esantion["vehicle_speed_kph"] > 5:
        lat_m = (esantion["gps_latitude_deg"] - anterior["gps_latitude_deg"]) * 111320.0
        lon_m = (
            (esantion["gps_longitude_deg"] - anterior["gps_longitude_deg"])
            * 111320.0
            * math.cos(math.radians(esantion["gps_latitude_deg"]))
        )
        gps_kph = math.hypot(lat_m, lon_m) * 36.0
        abateri.append(
            abs(gps_kph - esantion["vehicle_speed_kph"]) / esantion["vehicle_speed_kph"] * 100.0
        )
    anterior = esantion

if max(altitudini) - min(altitudini) < 5.0:
    problems.append(
        "altitudinea variaza cu doar %.2f m pe parcurs" % (max(altitudini) - min(altitudini))
    )

if not abateri:
    problems.append("nu s-a putut compara viteza dedusa din pozitii cu cea raportata")
else:
    medie = sum(abateri) / len(abateri)
    if medie > 5.0:
        problems.append(
            "traseul GPS inainteaza cu alta viteza decat cea raportata: abatere medie %.1f %%"
            % medie
        )
    if max(abateri) > 25.0:
        problems.append(
            "viteza dedusa din pozitii difera cu pana la %.1f %% de cea raportata"
            % max(abateri)
        )

print(json.dumps({
    "catalog": len(catalog),
    "emise": len(emitted),
    "probleme": problems,
}, ensure_ascii=False))
`

function main() {
  const python = findPython()

  if (python === null) {
    console.error(
      'Nu am găsit un interpretor Python 3.10 sau mai nou. Verificarea acoperirii ' +
        'simulatorului are nevoie de el, la fel ca serviciul de telemetrie. ' +
        'Instalează Python 3.13 sau creează mediul virtual din server/ ' +
        '(python -m venv .venv), apoi rulează din nou.',
    )
    process.exitCode = 1
    return
  }

  const result = spawnSync(python, ['-c', SCRIPT, SERVER], {
    encoding: 'utf8',
    cwd: ROOT,
  })

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || 'Rulare eșuată.')
    process.exitCode = 1
    return
  }

  let report
  try {
    report = JSON.parse(result.stdout.trim().split('\n').pop())
  } catch (error) {
    console.error('Răspuns neinterpretabil de la Python:\n' + result.stdout)
    console.error(String(error))
    process.exitCode = 1
    return
  }

  console.log(`Interpretor: ${python}`)
  console.log(
    `Catalog: ${report.catalog} semnale. Simulator: ${report.emise} semnale.`,
  )

  if (report.probleme.length > 0) {
    console.error('\nProbleme:')
    for (const problem of report.probleme) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  console.log('VERIFICARE SIMULATOR OK')
}

main()
