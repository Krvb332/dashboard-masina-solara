/**
 * Grupări de semnale care au un panou propriu.
 *
 * Paginile construiesc liste din catalog („toate semnalele din grupul energy"),
 * iar semnalele care au deja o reprezentare dedicată nu trebuie să apară a doua
 * oară ca rând de text. Regulile stau aici, într-un singur loc, ca panoul și
 * lista să nu poată ajunge să se contrazică.
 */

/** `cell_01_v` … `cell_32_v` — celulele desenate de `CellGrid`. */
export const CELL_KEY_PATTERN = /^cell_\d{2}_v$/

export function isCellSignal(key: string): boolean {
  return CELL_KEY_PATTERN.test(key)
}

/** Semnalele de energie pe care `CellGrid` le arată deja. */
const CELL_PANEL_KEYS = new Set([
  'cell_voltage_min_v',
  'cell_voltage_max_v',
  'cell_voltage_delta_v',
  'cell_min_index',
  'cell_max_index',
])

export function isInCellPanel(key: string): boolean {
  return isCellSignal(key) || CELL_PANEL_KEYS.has(key)
}

/** Semnalele pe care panoul „Capacitate și cicluri" le arată deja. */
const CAPACITY_PANEL_KEYS = new Set([
  'battery_capacity_remain_ah',
  'battery_capacity_total_ah',
  'battery_cycles',
  'battery_soh_pct',
])

export function isInCapacityPanel(key: string): boolean {
  return CAPACITY_PANEL_KEYS.has(key)
}

/** Semnalele de motor pe care `DriveStatePanel` le arată ca insigne. */
const DRIVE_STATE_KEYS = new Set([
  'drive_action',
  'power_mode',
  'motor_ctrl_mode',
  'regen_active',
  'motor_overheat_level',
  'digi_sw_position',
  'motor_pwm_duty_pct',
  'motor_lead_angle_deg',
  'regen_vr_pct',
  'motor_output_target',
  'motor_current_peak_a',
])

export function isInDriveStatePanel(key: string): boolean {
  return DRIVE_STATE_KEYS.has(key)
}

/** Semnalul descompus pe biți de `FaultPanel`. */
export function isFaultCodeSignal(key: string): boolean {
  return key === 'motor_fault_code'
}
