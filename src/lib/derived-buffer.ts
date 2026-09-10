import type { AnalyticsSnapshot } from './analytics'
import { TelemetryRingBuffer } from './ring-buffer'
import type { SignalDefinition } from '../schemas/telemetry'

/**
 * Seriile calculate, ținute separat de cele măsurate.
 *
 * Consumul specific, bilanțul de putere sau autonomia nu vin de pe mașină: se
 * calculează în browser, la ritmul acumulatorului de statistici. Amestecate în
 * bufferul principal, ar apărea în tabelul de calitate a semnalelor și în
 * exportul CSV ca și cum ar fi măsurători — iar cine citește fișierul peste o
 * lună nu ar mai putea distinge ce a măsurat mașina de ce a dedus dashboardul.
 *
 * De aici graficele paginii de statistici își iau datele, prin aceeași
 * componentă `TelemetryChart` folosită pentru semnalele reale.
 */

/** 1800 la 5 Hz = șase minute de istoric derivat. */
export const DERIVED_CAPACITY = 1800

export const derivedBuffer = new TelemetryRingBuffer(DERIVED_CAPACITY)

/**
 * Definițiile seriilor derivate, în același format ca al catalogului
 * serverului, ca graficele și tooltipurile să funcționeze fără cod special.
 */
export const DERIVED_SIGNALS: Record<string, SignalDefinition> = {
  calc_wh_per_km: definition({
    key: 'calc_wh_per_km',
    label: 'Consum specific',
    unit: 'Wh/km',
    decimals: 1,
    color: '#f472b6',
    description:
      'Energie scoasă din pachet pe kilometru, pe fereastră glisantă.',
  }),
  calc_consumption_w: definition({
    key: 'calc_consumption_w',
    label: 'Consum instantaneu',
    unit: 'W',
    decimals: 0,
    color: '#38bdf8',
    description: 'Puterea scoasă din pachet acum.',
  }),
  calc_regen_w: definition({
    key: 'calc_regen_w',
    label: 'Recuperare regenerativă',
    unit: 'W',
    decimals: 0,
    color: '#4ade80',
    description: 'Puterea întoarsă în pachet de frâna regenerativă.',
  }),
  calc_net_power_w: definition({
    key: 'calc_net_power_w',
    label: 'Bilanț de putere',
    unit: 'W',
    decimals: 0,
    color: '#fbbf24',
    description:
      'Aport solar minus consum. Pozitiv = pachetul se încarcă în mers.',
  }),
  calc_road_load_w: definition({
    key: 'calc_road_load_w',
    label: 'Rezistență la înaintare',
    unit: 'W',
    decimals: 0,
    color: '#a78bfa',
    description: 'Puterea teoretic necesară la viteza și panta actuale.',
  }),
  calc_range_km: definition({
    key: 'calc_range_km',
    label: 'Autonomie estimată',
    unit: 'km',
    decimals: 1,
    color: '#34d399',
  }),
  calc_efficiency_km_per_kwh: definition({
    key: 'calc_efficiency_km_per_kwh',
    label: 'Eficiență',
    unit: 'km/kWh',
    decimals: 2,
    color: '#22d3ee',
  }),
  calc_energy_balance_wh: definition({
    key: 'calc_energy_balance_wh',
    label: 'Bilanț energetic',
    unit: 'Wh',
    decimals: 0,
    color: '#fb923c',
    description:
      'Solar plus regenerat minus consumat, de la începutul sesiunii.',
  }),
  calc_drivetrain_eff_pct: definition({
    key: 'calc_drivetrain_eff_pct',
    label: 'Randament lanț electric',
    unit: '%',
    decimals: 0,
    color: '#c084fc',
  }),
  calc_grade_pct: definition({
    key: 'calc_grade_pct',
    label: 'Pantă',
    unit: '%',
    decimals: 1,
    color: '#94a3b8',
  }),
}

function definition(
  partial: Pick<SignalDefinition, 'key' | 'label' | 'unit' | 'decimals'> &
    Partial<SignalDefinition>,
): SignalDefinition {
  return {
    group: 'status',
    min: null,
    max: null,
    stale_after_s: 5,
    warn_below: null,
    crit_below: null,
    warn_above: null,
    crit_above: null,
    hysteresis: 0,
    overview: false,
    chartable: true,
    color: null,
    description: '',
    ...partial,
  }
}

/**
 * Adaugă un eșantion derivat.
 *
 * Doar mărimile care chiar s-au putut calcula ajung în serie. O valoare `null`
 * este omisă, iar bufferul o marchează `NaN` — graficul întrerupe linia acolo,
 * în loc să deseneze o cădere la zero care nu s-a întâmplat.
 */
export function pushDerived(timeMs: number, snapshot: AnalyticsSnapshot): void {
  const values: Record<string, number> = {}

  const add = (key: string, value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return
    values[key] = value
  }

  add('calc_wh_per_km', snapshot.recentWhPerKm ?? snapshot.whPerKm)
  add('calc_consumption_w', snapshot.consumptionW)
  add('calc_regen_w', snapshot.regenW)
  add('calc_net_power_w', snapshot.netPowerW)
  add('calc_road_load_w', snapshot.roadLoadW)
  add('calc_range_km', snapshot.rangeKm)
  add('calc_efficiency_km_per_kwh', snapshot.kmPerKwh)
  add('calc_drivetrain_eff_pct', snapshot.drivetrainEfficiencyPct)
  add('calc_grade_pct', snapshot.gradePct)

  // Bilanțul energetic există chiar și la zero: „nu s-a consumat nimic" este o
  // afirmație validă despre o sesiune abia pornită.
  if (snapshot.totals.samples > 0) {
    add('calc_energy_balance_wh', snapshot.energyBalanceWh)
  }

  if (Object.keys(values).length === 0) return
  derivedBuffer.push(timeMs, values)
}

export function resetDerivedBuffer(): void {
  derivedBuffer.clear()
}
