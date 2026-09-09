import type { SignalQuality } from '../schemas/telemetry'

/**
 * Sursele de date de pe mașină, așa cum le vede placa Teensy.
 *
 * Serverul stochează măsurătorile pe surse (`/api/v1/devices/{id}/counts`
 * întoarce exact cheile de mai jos), dar pe WebSocket ajung semnale
 * individuale. Gruparea de aici reface legătura: din 104 semnale proaspete sau
 * nu, spunem câte *plăci și magistrale* mai răspund.
 *
 * Distincția contează în pitlane: „87 din 104 semnale" nu spune nimic, pe când
 * „GPS-ul a căzut" trimite pe cineva cu o cheie în mână la conectorul potrivit.
 */

export type SensorSource = {
  key: string
  label: string
  /** Semnalul aparține sursei dacă potrivește acest test. */
  matches: (signalKey: string) => boolean
}

const startsWith =
  (...prefixes: string[]) =>
  (key: string) =>
    prefixes.some((prefix) => key.startsWith(prefix))

const oneOf =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key)

/** Ordinea este cea în care apar pe ecran. */
export const SENSOR_SOURCES: readonly SensorSource[] = [
  {
    key: 'motor',
    label: 'Controller motor',
    matches: (key) =>
      startsWith('motor_', 'regen_')(key) ||
      oneOf(
        'throttle_pct',
        'power_mode',
        'drive_action',
        'digi_sw_position',
      )(key),
  },
  {
    key: 'bms',
    label: 'BMS',
    matches: (key) =>
      startsWith('battery_')(key) ||
      oneOf(
        'cell_voltage_min_v',
        'cell_voltage_max_v',
        'cell_voltage_delta_v',
        'cell_min_index',
        'cell_max_index',
      )(key),
  },
  {
    // Tensiunile per celulă vin într-un cadru separat de restul BMS-ului și pot
    // lipsi singure, deci merită numărate separat.
    key: 'cells',
    label: 'Celule',
    matches: (key) => /^cell_\d+_v$/.test(key),
  },
  { key: 'gps', label: 'GPS', matches: startsWith('gps_') },
  { key: 'tpms', label: 'TPMS', matches: startsWith('tpms_') },
  { key: 'temp', label: 'Senzori temperatură', matches: startsWith('temp_') },
  {
    key: 'solar',
    label: 'MPPT solar',
    matches: (key) =>
      startsWith('mppt')(key) || oneOf('solar_power_w', 'energy_solar_wh')(key),
  },
] as const

export type SourceStatus = {
  key: string
  label: string
  /** Semnale proaspete din această sursă. */
  fresh: number
  /** Semnale cunoscute din catalog pentru sursă. */
  total: number
  online: boolean
}

export type SensorSummary = {
  sources: SourceStatus[]
  onlineSources: number
  totalSources: number
  freshSignals: number
  totalSignals: number
}

/**
 * Câte surse mai răspund, pornind de la calitatea semnalelor.
 *
 * Sursele fără niciun semnal în catalog nu sunt raportate deloc: n-are rost să
 * declarăm „TPMS offline" pe o mașină care n-a avut niciodată TPMS.
 */
export function summarizeSources(
  catalogKeys: string[],
  quality: Record<string, SignalQuality>,
): SensorSummary {
  const sources: SourceStatus[] = []
  let freshSignals = 0

  for (const source of SENSOR_SOURCES) {
    const keys = catalogKeys.filter(source.matches)
    if (keys.length === 0) continue

    const fresh = keys.filter((key) => quality[key]?.state === 'valid').length

    freshSignals += fresh
    sources.push({
      key: source.key,
      label: source.label,
      fresh,
      total: keys.length,
      online: fresh > 0,
    })
  }

  return {
    sources,
    onlineSources: sources.filter((source) => source.online).length,
    totalSources: sources.length,
    freshSignals,
    totalSignals: catalogKeys.length,
  }
}
