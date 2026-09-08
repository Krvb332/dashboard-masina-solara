import { describe, expect, it } from 'vitest'
import { createSimulatorState, stepSimulator } from './simulator-source'
import { telemetryFrameSchema } from '../schemas/telemetry'

const meta = {
  vehicleId: 'tucn-solar-01',
  sessionId: 'test',
  now: Date.parse('2026-07-27T10:00:00.000Z'),
}

describe('stepSimulator', () => {
  it('produce cadre care trec validarea schemei', () => {
    const state = createSimulatorState()
    const frame = stepSimulator(state, 0.1, () => 0.5, meta)

    expect(telemetryFrameSchema.safeParse(frame).success).toBe(true)
  })

  it('incrementează secvența la fiecare pas', () => {
    const state = createSimulatorState()
    const first = stepSimulator(state, 0.1, () => 0.5, meta)
    const second = stepSimulator(state, 0.1, () => 0.5, meta)

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
  })

  it('acoperă toate semnalele din registru care sunt simulate', () => {
    const state = createSimulatorState()
    const frame = stepSimulator(state, 0.1, () => 0.5, meta)

    expect(Object.keys(frame.signals)).toEqual(
      expect.arrayContaining([
        'vehicle_speed_kph',
        'battery_soc_pct',
        'battery_voltage_v',
        'solar_power_w',
        'motor_temp_c',
        'gps_latitude_deg',
        'gps_longitude_deg',
      ]),
    )
  })

  it('consumă din baterie când motorul cere mai mult decât produc panourile', () => {
    const state = createSimulatorState()
    const initialSoc = state.soc

    // O oră de rulare la 1 Hz: consumul depășește producția solară.
    for (let step = 0; step < 3_600; step += 1) {
      stepSimulator(state, 1, () => 0.5, meta)
    }

    expect(state.soc).toBeLessThan(initialSoc)
    expect(state.soc).toBeGreaterThan(0)
  })

  it('menține temperaturile în limite fizice plauzibile', () => {
    const state = createSimulatorState()
    for (let step = 0; step < 1_200; step += 1) {
      stepSimulator(state, 1, () => 0.5, meta)
    }

    expect(state.motorTemp).toBeGreaterThan(20)
    expect(state.motorTemp).toBeLessThan(120)
  })

  it('este determinist pentru aceeași secvență de numere aleatoare', () => {
    const first = stepSimulator(createSimulatorState(), 0.1, () => 0.5, meta)
    const second = stepSimulator(createSimulatorState(), 0.1, () => 0.5, meta)

    expect(first.signals).toEqual(second.signals)
  })
})
