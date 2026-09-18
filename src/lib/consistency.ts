/**
 * Verificări de coerență între semnale.
 *
 * Un semnal poate sosi, poate fi proaspăt și poate fi complet greșit: o
 * tensiune scalată de zece ori, o putere raportată în deciwați, o temperatură
 * în zecimi de grad. Starea de calitate nu prinde nimic din toate astea —
 * valoarea este în domeniu și e recentă.
 *
 * Ce prinde greșelile de scalare este redundanța fizică: mașina trimite și
 * puterea, și tensiunea, și curentul; și suma MPPT, și puterea solară totală;
 * și celula minimă, și cea maximă, și dezechilibrul. Fiecare pereche trebuie să
 * se confirme reciproc, iar când nu o face, una dintre ele este mapată greșit.
 *
 * Funcțiile sunt pure ca să poată fi testate: panoul le doar afișează.
 */

import { speedKphFromRpm } from './telemetry-math'

export type ValueLookup = (key: string) => number | null

export type ConsistencyStatus = 'ok' | 'mismatch' | 'unknown'

export type ConsistencyCheck = {
  key: string
  label: string
  /** Ce ar trebui să fie, calculat din alte semnale. */
  expected: number | null
  /** Ce raportează mașina. */
  actual: number | null
  unit: string
  decimals: number
  /** Abatere relativă acceptată, în procente. */
  tolerancePct: number
  /** Abatere absolută acceptată — contează la valori mici, unde relativul explodează. */
  toleranceAbs: number
  /** Ce înseamnă o nepotrivire, în cuvintele cuiva care va căuta cauza. */
  hint: string
}

export type ConsistencyResult = ConsistencyCheck & {
  status: ConsistencyStatus
  /** Diferența absolută dintre așteptat și raportat. */
  deviation: number | null
}

function sum(lookup: ValueLookup, keys: string[]): number | null {
  let total = 0
  let seen = 0

  for (const key of keys) {
    const value = lookup(key)
    if (value === null) continue
    total += value
    seen += 1
  }

  // O sumă parțială ar acuza pe nedrept: dacă doar trei din patru MPPT
  // raportează, totalul „lipsă" este un senzor tăcut, nu o mapare greșită.
  return seen === keys.length ? total : null
}

function difference(
  lookup: ValueLookup,
  minus: string,
  from: string,
): number | null {
  const a = lookup(from)
  const b = lookup(minus)
  if (a === null || b === null) return null
  return a - b
}

function product(
  lookup: ValueLookup,
  first: string,
  second: string,
): number | null {
  const a = lookup(first)
  const b = lookup(second)
  if (a === null || b === null) return null
  return a * b
}

/** Perechile redundante pe care le confruntăm. */
export function buildChecks(lookup: ValueLookup): ConsistencyCheck[] {
  return [
    {
      key: 'battery_power',
      label: 'Putere pachet față de U · I',
      expected: product(lookup, 'battery_voltage_v', 'battery_current_a'),
      actual: lookup('battery_power_w'),
      unit: 'W',
      decimals: 0,
      tolerancePct: 8,
      toleranceAbs: 60,
      hint: 'Tensiunea, curentul sau puterea au altă scalare decât cea declarată în catalog.',
    },
    {
      key: 'solar_power',
      label: 'Putere solară față de suma MPPT',
      // Mașina are două convertoare; totalul solar trebuie să fie suma lor.
      expected: sum(lookup, ['mppt1_power_w', 'mppt2_power_w']),
      actual: lookup('solar_power_w'),
      unit: 'W',
      decimals: 0,
      tolerancePct: 6,
      toleranceAbs: 25,
      hint: 'Unul dintre cele două convertoare MPPT lipsește din sumă sau raportează în alte unități.',
    },
    {
      key: 'cell_delta',
      label: 'Dezechilibru celule față de max − min',
      expected: difference(lookup, 'cell_voltage_min_v', 'cell_voltage_max_v'),
      actual: lookup('cell_voltage_delta_v'),
      unit: 'V',
      decimals: 3,
      tolerancePct: 10,
      toleranceAbs: 0.01,
      hint: 'Extremele și dezechilibrul vin din cadre BMS diferite; unul dintre ele este citit greșit.',
    },
    {
      key: 'battery_temp_delta',
      label: 'Delta temperatură față de max − min',
      expected: difference(lookup, 'battery_temp_min_c', 'battery_temp_max_c'),
      actual: lookup('battery_temp_delta_c'),
      unit: '°C',
      decimals: 1,
      tolerancePct: 12,
      toleranceAbs: 1,
      hint: 'Una dintre temperaturi este mapată de pe alt senzor decât cel presupus.',
    },
    {
      key: 'pack_voltage',
      label: 'Tensiune pachet față de suma celulelor',
      expected: sum(
        lookup,
        Array.from(
          { length: 32 },
          (_, index) => `cell_${String(index + 1).padStart(2, '0')}_v`,
        ),
      ),
      actual: lookup('battery_voltage_v'),
      unit: 'V',
      decimals: 1,
      tolerancePct: 4,
      toleranceAbs: 2,
      hint: 'Numărul de celule din catalog nu corespunde pachetului montat, sau o celulă este citită de două ori.',
    },
    {
      key: 'speed_source',
      label: 'Viteză raportată (firmware) față de viteză GNSS',
      // Rămâne „fără date" cât timp mașina nu are receptor GNSS; când există,
      // este singura confruntare a vitezei cu o sursă independentă de roată.
      expected: lookup('gps_speed_kph'),
      actual: lookup('vehicle_speed_kph'),
      unit: 'km/h',
      decimals: 1,
      tolerancePct: 15,
      toleranceAbs: 3,
      hint: 'Viteza din firmware (turație × circumferință) nu se potrivește cu cea a receptorului GNSS: circumferința configurată pe placă nu este a anvelopei, sau coordonatele nu sunt în grade zecimale.',
    },
    {
      key: 'wheel_speed',
      label: 'Viteză raportată (firmware) față de turație × Ø 548 mm',
      // Firmware-ul calculează `vehicle_speed_kph` din aceeași turație, cu
      // circumferința configurată pe placă. Refăcând calculul aici cu
      // D = 0,548 m (vezi `speedKphFromRpm`), verificarea compară de fapt cei
      // doi factori rpm→km/h: al plăcii și al dashboardului.
      expected: speedKphFromRpm(lookup('motor_rpm')),
      actual: lookup('vehicle_speed_kph'),
      unit: 'km/h',
      decimals: 1,
      tolerancePct: 10,
      toleranceAbs: 3,
      hint: 'Factorul rpm→km/h din firmware nu corespunde roții de 548 mm presupuse de dashboard (sau raportului de transmisie 1:1). Una dintre cele două circumferințe este greșită; distanța și consumul specific moștenesc eroarea.',
    },
  ]
}

/**
 * Clasifică fiecare verificare.
 *
 * `unknown` nu este o trecere: înseamnă că unul dintre semnale nu a sosit, deci
 * perechea nu a putut fi confruntată. Panoul îl arată ca atare, ca absența să
 * nu fie citită drept confirmare.
 */
export function classify(check: ConsistencyCheck): ConsistencyResult {
  const { expected, actual } = check

  if (
    expected === null ||
    actual === null ||
    !Number.isFinite(expected) ||
    !Number.isFinite(actual)
  ) {
    return { ...check, status: 'unknown', deviation: null }
  }

  const deviation = Math.abs(expected - actual)
  const allowed = Math.max(
    check.toleranceAbs,
    (Math.abs(expected) * check.tolerancePct) / 100,
  )

  return {
    ...check,
    status: deviation <= allowed ? 'ok' : 'mismatch',
    deviation,
  }
}

export function runConsistencyChecks(lookup: ValueLookup): ConsistencyResult[] {
  return buildChecks(lookup).map(classify)
}

export type ConsistencySummary = {
  ok: number
  mismatch: number
  unknown: number
  total: number
}

export function summarizeConsistency(
  results: ConsistencyResult[],
): ConsistencySummary {
  return {
    ok: results.filter((result) => result.status === 'ok').length,
    mismatch: results.filter((result) => result.status === 'mismatch').length,
    unknown: results.filter((result) => result.status === 'unknown').length,
    total: results.length,
  }
}
