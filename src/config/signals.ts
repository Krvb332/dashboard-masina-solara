/**
 * Registrul de semnale — sursa unică de adevăr pentru interfață.
 *
 * Fiecare semnal primit de la mașină este descris aici o singură dată:
 * etichetă, unitate, precizie, grupă și praguri de alarmă. Cardurile,
 * graficele, tabelul de diagnostic și motorul de alarme citesc toate din
 * acest registru, deci un semnal nou se adaugă într-un singur loc.
 */

export type SignalGroup = 'vehicul' | 'baterie' | 'solar' | 'motor' | 'pozitie'

/**
 * Praguri de alarmă. `min`/`max` definesc domeniul normal: sub `criticalMin`
 * sau peste `criticalMax` semnalul este critic, iar între praguri este
 * avertizare.
 */
export type SignalThresholds = {
  warnMin?: number
  warnMax?: number
  criticalMin?: number
  criticalMax?: number
}

export type SignalDefinition = {
  key: string
  label: string
  unit: string
  decimals: number
  group: SignalGroup
  /** Descriere scurtă folosită în pagina de diagnostic. */
  description?: string
  thresholds?: SignalThresholds
}

export const SIGNALS = {
  vehicle_speed_kph: {
    key: 'vehicle_speed_kph',
    label: 'Viteză',
    unit: 'km/h',
    decimals: 1,
    group: 'vehicul',
    description: 'Viteza la sol raportată de computerul de bord.',
    thresholds: { warnMax: 90, criticalMax: 110 },
  },
  battery_soc_pct: {
    key: 'battery_soc_pct',
    label: 'Baterie',
    unit: '%',
    decimals: 1,
    group: 'baterie',
    description: 'Starea de încărcare estimată de BMS.',
    thresholds: { warnMin: 25, criticalMin: 12 },
  },
  battery_voltage_v: {
    key: 'battery_voltage_v',
    label: 'Tensiune pachet',
    unit: 'V',
    decimals: 1,
    group: 'baterie',
    thresholds: { warnMin: 88, criticalMin: 82, warnMax: 130, criticalMax: 134 },
  },
  battery_current_a: {
    key: 'battery_current_a',
    label: 'Curent pachet',
    unit: 'A',
    decimals: 1,
    group: 'baterie',
    description: 'Valorile negative indică regenerare.',
    thresholds: { warnMax: 45, criticalMax: 60 },
  },
  battery_power_w: {
    key: 'battery_power_w',
    label: 'Putere baterie',
    unit: 'W',
    decimals: 0,
    group: 'baterie',
  },
  cell_voltage_min_v: {
    key: 'cell_voltage_min_v',
    label: 'Celulă minimă',
    unit: 'V',
    decimals: 3,
    group: 'baterie',
    thresholds: { warnMin: 3.1, criticalMin: 2.9 },
  },
  cell_voltage_max_v: {
    key: 'cell_voltage_max_v',
    label: 'Celulă maximă',
    unit: 'V',
    decimals: 3,
    group: 'baterie',
    thresholds: { warnMax: 4.15, criticalMax: 4.22 },
  },
  cell_temp_max_c: {
    key: 'cell_temp_max_c',
    label: 'Temperatură celule',
    unit: '°C',
    decimals: 1,
    group: 'baterie',
    thresholds: { warnMax: 45, criticalMax: 55 },
  },
  cell_temp_delta_c: {
    key: 'cell_temp_delta_c',
    label: 'Δ temperatură celule',
    unit: '°C',
    decimals: 1,
    group: 'baterie',
    description: 'Diferența dintre cea mai caldă și cea mai rece celulă.',
    thresholds: { warnMax: 8, criticalMax: 12 },
  },
  solar_power_w: {
    key: 'solar_power_w',
    label: 'Putere solară',
    unit: 'W',
    decimals: 0,
    group: 'solar',
    description: 'Suma puterii livrate de toate controlerele MPPT.',
  },
  mppt_efficiency_pct: {
    key: 'mppt_efficiency_pct',
    label: 'Randament MPPT',
    unit: '%',
    decimals: 1,
    group: 'solar',
    thresholds: { warnMin: 90, criticalMin: 85 },
  },
  motor_power_w: {
    key: 'motor_power_w',
    label: 'Putere motor',
    unit: 'W',
    decimals: 0,
    group: 'motor',
    thresholds: { warnMax: 2600, criticalMax: 3200 },
  },
  motor_temp_c: {
    key: 'motor_temp_c',
    label: 'Temperatură motor',
    unit: '°C',
    decimals: 1,
    group: 'motor',
    thresholds: { warnMax: 75, criticalMax: 90 },
  },
  inverter_temp_c: {
    key: 'inverter_temp_c',
    label: 'Temperatură invertor',
    unit: '°C',
    decimals: 1,
    group: 'motor',
    thresholds: { warnMax: 70, criticalMax: 85 },
  },
  gps_latitude_deg: {
    key: 'gps_latitude_deg',
    label: 'Latitudine',
    unit: '°',
    decimals: 5,
    group: 'pozitie',
  },
  gps_longitude_deg: {
    key: 'gps_longitude_deg',
    label: 'Longitudine',
    unit: '°',
    decimals: 5,
    group: 'pozitie',
  },
  gps_accuracy_m: {
    key: 'gps_accuracy_m',
    label: 'Precizie GPS',
    unit: 'm',
    decimals: 1,
    group: 'pozitie',
    thresholds: { warnMax: 5, criticalMax: 15 },
  },
  lap_number: {
    key: 'lap_number',
    label: 'Tur',
    unit: '',
    decimals: 0,
    group: 'pozitie',
  },
} as const satisfies Record<string, SignalDefinition>

export type SignalKey = keyof typeof SIGNALS

export const SIGNAL_LIST: SignalDefinition[] = Object.values(SIGNALS)

export function getSignalDefinition(key: string): SignalDefinition | undefined {
  return (SIGNALS as Record<string, SignalDefinition>)[key]
}

export const GROUP_LABELS: Record<SignalGroup, string> = {
  vehicul: 'Vehicul',
  baterie: 'Baterie',
  solar: 'Solar',
  motor: 'Motor și invertor',
  pozitie: 'Poziție',
}
