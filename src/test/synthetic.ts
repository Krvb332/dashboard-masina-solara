import type {
  Sample,
  SignalQuality,
  TelemetryFrame,
} from '../schemas/telemetry'
import { rpmFromSpeedKph } from '../lib/telemetry-math'

/**
 * Telemetrie sintetică pentru testele de audit și benchmark-uri.
 *
 * Reproduce forma fluxului real: toate cele 104 chei din catalogul serverului
 * (`server/app/signals.py`), o buclă GPS eliptică cu denivelare ca în
 * `server/simulator/simulate.py`, puteri corelate cu viteza și 32 de celule.
 * Nu este un model fizic — este un generator determinist cu care putem umple
 * bufferul de zece minute sau o cursă de opt ore fără să pornim serverul.
 */

export const CATALOG_KEYS = (
  'vehicle_speed_kph lap_number distance_km battery_soc_pct battery_voltage_v ' +
  'battery_current_a battery_power_w cell_voltage_min_v cell_voltage_max_v ' +
  'solar_power_w mppt1_power_w mppt2_power_w ' +
  'energy_consumed_wh energy_regen_wh energy_solar_wh battery_temp_max_c ' +
  'battery_temp_min_c battery_temp_delta_c motor_temp_c inverter_temp_c ' +
  'motor_power_w motor_rpm throttle_pct gps_latitude_deg gps_longitude_deg ' +
  'gps_hdop gps_satellites gps_altitude_m gps_speed_kph gps_course_deg ' +
  'gps_fix_quality gps_vdop battery_capacity_remain_ah battery_capacity_total_ah ' +
  'battery_cycles battery_soh_pct cell_voltage_delta_v cell_min_index ' +
  'cell_max_index regen_power_w ' +
  Array.from(
    { length: 32 },
    (_, index) => `cell_${String(index + 1).padStart(2, '0')}_v`,
  ).join(' ') +
  ' motor_current_peak_a motor_pwm_duty_pct motor_lead_angle_deg regen_vr_pct ' +
  'motor_output_target drive_action power_mode motor_ctrl_mode regen_active ' +
  'motor_overheat_level digi_sw_position motor_fault_code temp_ambient_c ' +
  'temp_cockpit_c temp_pack_front_c temp_pack_rear_c temp_mppt_c ' +
  'tpms_fl_pressure_bar tpms_fr_pressure_bar tpms_rl_pressure_bar ' +
  'tpms_rr_pressure_bar tpms_fl_temp_c tpms_fr_temp_c tpms_rl_temp_c ' +
  'tpms_rr_temp_c teensy_temp_c teensy_loop_hz teensy_can_errors ' +
  'teensy_free_ram_kb teensy_uptime_s'
).split(' ')

/** Traseul simulatorului: elipsă lângă Cluj-Napoca, cu o denivelare de 9 m. */
export const TRACK = {
  centerLat: 46.7712,
  centerLon: 23.6236,
  radiusAM: 250,
  radiusBM: 140,
  baseElevationM: 340,
  elevationAmplitudeM: 9,
  metersPerDegLat: 111_320,
} as const

export const BASE_TIME_MS = Date.UTC(2026, 8, 15, 9, 0, 0)
export const SAMPLE_PERIOD_MS = 100

/** Generator pseudo-aleator determinist (mulberry32), ca cifrele să fie reproductibile. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type SyntheticOptions = {
  /** Perioada dintre eșantioane, în ms. */
  periodMs?: number
  /** Viteza medie, în km/h. */
  speedKph?: number
  /** Zgomot orizontal GNSS, în metri (abatere uniformă ± valoare). */
  gpsNoiseM?: number
  /** Sămânța generatorului. */
  seed?: number
}

export function trackPoint(theta: number): { lat: number; lon: number } {
  const lat =
    TRACK.centerLat + (TRACK.radiusBM * Math.sin(theta)) / TRACK.metersPerDegLat
  const lonScale = Math.cos((TRACK.centerLat * Math.PI) / 180)
  const lon =
    TRACK.centerLon +
    (TRACK.radiusAM * Math.cos(theta)) / (TRACK.metersPerDegLat * lonScale)
  return { lat, lon }
}

export function trackElevation(theta: number): number {
  return TRACK.baseElevationM + TRACK.elevationAmplitudeM * Math.sin(2 * theta)
}

/**
 * Tabel de lungime de arc pe elipsă, ca poziția să avanseze cu viteza
 * raportată: un avans uniform în unghi ar da o viteză la sol care variază de-a
 * lungul turului și ar contrazice `vehicle_speed_kph`.
 */
const ARC_STEPS = 3600
const ARC_TABLE: Float64Array = (() => {
  const table = new Float64Array(ARC_STEPS + 1)
  let total = 0
  for (let step = 1; step <= ARC_STEPS; step += 1) {
    const theta = ((step - 0.5) / ARC_STEPS) * 2 * Math.PI
    const dx = -TRACK.radiusAM * Math.sin(theta)
    const dy = TRACK.radiusBM * Math.cos(theta)
    total += Math.hypot(dx, dy) * ((2 * Math.PI) / ARC_STEPS)
    table[step] = total
  }
  return table
})()

/** Lungimea unui tur, în metri (integrare numerică). */
export function trackLengthM(): number {
  return ARC_TABLE[ARC_STEPS]
}

/** Unghiul la care s-a parcurs distanța dată de la start, cu interpolare liniară. */
export function thetaAtDistance(distanceM: number): number {
  const length = trackLengthM()
  const along = ((distanceM % length) + length) % length
  let low = 0
  let high = ARC_STEPS
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (ARC_TABLE[middle] <= along) low = middle
    else high = middle
  }
  const span = ARC_TABLE[high] - ARC_TABLE[low]
  const fraction = span > 0 ? (along - ARC_TABLE[low]) / span : 0
  return ((low + fraction) / ARC_STEPS) * 2 * Math.PI
}

/**
 * Eșantionul cu indexul `index`, cu toate cele 104 semnale.
 *
 * Distanța și energia sunt contoare cumulate consistente cu viteza și cu
 * puterea, ca testele să poată compara integrarea din browser cu adevărul.
 */
export function makeSample(
  index: number,
  options: SyntheticOptions = {},
): Sample {
  const periodMs = options.periodMs ?? SAMPLE_PERIOD_MS
  const speedKph = options.speedKph ?? 45
  const noise = options.gpsNoiseM ?? 0
  const random = makeRandom((options.seed ?? 1) * 7919 + index)

  const timeMs = BASE_TIME_MS + index * periodMs
  const elapsedS = (index * periodMs) / 1000
  const speedMs = speedKph / 3.6
  const distanceM = speedMs * elapsedS
  const theta = thetaAtDistance(distanceM)
  const lap = Math.floor(distanceM / trackLengthM()) + 1

  const point = trackPoint(theta)
  const noiseLat = ((random() * 2 - 1) * noise) / TRACK.metersPerDegLat
  const noiseLon =
    ((random() * 2 - 1) * noise) /
    (TRACK.metersPerDegLat * Math.cos((TRACK.centerLat * Math.PI) / 180))

  const motorW = 900 + 300 * Math.sin(elapsedS / 30)
  const solarW = 700 + 100 * Math.sin(elapsedS / 120)
  const batteryW = motorW - solarW + 40
  const voltage = 118 - elapsedS / 3600
  const current = batteryW / voltage
  const consumedWh = (batteryW * elapsedS) / 3600

  const signals: Record<string, number> = {
    vehicle_speed_kph: speedKph,
    lap_number: lap,
    distance_km: distanceM / 1000,
    battery_soc_pct: Math.max(0, 95 - elapsedS / 600),
    battery_voltage_v: voltage,
    battery_current_a: current,
    battery_power_w: batteryW,
    cell_voltage_min_v: 3.65,
    cell_voltage_max_v: 3.72,
    solar_power_w: solarW,
    mppt1_power_w: solarW / 2,
    mppt2_power_w: solarW / 2,
    energy_consumed_wh: consumedWh,
    energy_regen_wh: elapsedS * 0.002,
    energy_solar_wh: (solarW * elapsedS) / 3600,
    battery_temp_max_c: 31 + elapsedS / 3600,
    battery_temp_min_c: 29,
    battery_temp_delta_c: 2 + elapsedS / 3600,
    motor_temp_c: 55 + 10 * Math.sin(elapsedS / 300),
    inverter_temp_c: 48,
    motor_power_w: motorW,
    // Aceeași roată ca în formula dashboardului (Ø 548 mm), ca verificarea
    // „viteză față de turație" să treacă pe date sintetice.
    motor_rpm: rpmFromSpeedKph(speedKph) ?? 0,
    throttle_pct: 42 + 3 * Math.sin(elapsedS),
    gps_latitude_deg: point.lat + noiseLat,
    gps_longitude_deg: point.lon + noiseLon,
    gps_hdop: 0.9 + 0.2 * Math.sin(elapsedS / 7),
    gps_satellites: 11,
    gps_altitude_m: trackElevation(theta),
    gps_speed_kph: speedKph,
    gps_course_deg: ((theta * 180) / Math.PI + 90) % 360,
    gps_fix_quality: 1,
    gps_vdop: 1.4,
    battery_capacity_remain_ah: 40,
    battery_capacity_total_ah: 45,
    battery_cycles: 12,
    battery_soh_pct: 97,
    cell_voltage_delta_v: 0.07,
    cell_min_index: 17,
    cell_max_index: 3,
    regen_power_w: 0,
    motor_current_peak_a: 30,
    motor_pwm_duty_pct: 60,
    motor_lead_angle_deg: 10,
    regen_vr_pct: 0,
    motor_output_target: 55,
    drive_action: 1,
    power_mode: 1,
    motor_ctrl_mode: 0,
    regen_active: 0,
    motor_overheat_level: 0,
    digi_sw_position: 2,
    motor_fault_code: 0,
    temp_ambient_c: 24,
    temp_cockpit_c: 29,
    temp_pack_front_c: 30,
    temp_pack_rear_c: 31,
    temp_mppt_c: 38,
    tpms_fl_pressure_bar: 5.1,
    tpms_fr_pressure_bar: 5.1,
    tpms_rl_pressure_bar: 5.0,
    tpms_rr_pressure_bar: 5.0,
    tpms_fl_temp_c: 33,
    tpms_fr_temp_c: 33,
    tpms_rl_temp_c: 32,
    tpms_rr_temp_c: 32,
    teensy_temp_c: 41,
    teensy_loop_hz: 200,
    teensy_can_errors: 0,
    teensy_free_ram_kb: 180,
    teensy_uptime_s: elapsedS,
  }
  for (let cell = 1; cell <= 32; cell += 1) {
    signals[`cell_${String(cell).padStart(2, '0')}_v`] =
      3.68 + 0.012 * Math.sin(cell * 1.7) - (cell === 17 ? 0.045 : 0)
  }

  return {
    timestamp: new Date(timeMs - 120).toISOString(),
    server_received_at: new Date(timeMs).toISOString(),
    sequence: index + 1,
    signals,
  }
}

export function makeSamples(
  count: number,
  options: SyntheticOptions = {},
): Sample[] {
  return Array.from({ length: count }, (_, index) => makeSample(index, options))
}

/** Starea de calitate a unui eșantion: toate semnalele lui, proaspete. */
export function qualityFor(
  sample: Sample,
  state: SignalQuality['state'] = 'valid',
): Record<string, SignalQuality> {
  const quality: Record<string, SignalQuality> = {}
  for (const [key, value] of Object.entries(sample.signals)) {
    quality[key] = { state, age_ms: 0, value }
  }
  return quality
}

export function makeFrame(
  index: number,
  options: SyntheticOptions = {},
): TelemetryFrame {
  const latest = makeSample(index, options)
  return {
    type: 'frame',
    vehicle_id: 'solar-car-01',
    session_id: 'synthetic',
    latest,
    quality: qualityFor(latest),
    alarms: [],
    stats: {
      received: index + 1,
      dropped: 0,
      duplicates: 0,
      out_of_order: 0,
      invalid: 0,
      effective_hz: 10,
      last_sequence: index + 1,
      clock_offset_ms: 120,
    },
    server_time: latest.server_received_at,
    recording_session_id: null,
  }
}

/** Cadrul inițial al unui client nou: starea curentă plus istoricul scurt. */
export function makeSnapshot(
  historyCount: number,
  options: SyntheticOptions = {},
): TelemetryFrame {
  const frame = makeFrame(historyCount - 1, options)
  return {
    ...frame,
    type: 'snapshot',
    history: makeSamples(historyCount, options),
  }
}
