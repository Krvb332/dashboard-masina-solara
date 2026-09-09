import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makeQuality,
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../test/fixtures'
import type { SignalDefinition } from '../schemas/telemetry'
import { DriveStatePanel } from './DriveStatePanel'

/**
 * Insignele traduc enumerări. Greșeala costisitoare aici este să arate „Oprit"
 * pentru un semnal care nu mai vine — de aceea starea de calitate se testează
 * separat de valoare.
 */

const semnale: SignalDefinition[] = [
  makeSignal({ key: 'drive_action', label: 'Stare de condus', group: 'motor', decimals: 0 }),
  makeSignal({ key: 'power_mode', label: 'Mod de putere', group: 'motor', decimals: 0 }),
  makeSignal({ key: 'motor_ctrl_mode', label: 'Mod de control', group: 'motor', decimals: 0 }),
  makeSignal({ key: 'regen_active', label: 'Regenerare', group: 'motor', decimals: 0 }),
  makeSignal({ key: 'motor_overheat_level', label: 'Nivel supraîncălzire', group: 'motor', decimals: 0 }),
  makeSignal({ key: 'motor_current_peak_a', label: 'Curent de vârf', unit: 'A', group: 'motor', decimals: 0 }),
  makeSignal({ key: 'motor_pwm_duty_pct', label: 'PWM duty', unit: '%', group: 'motor' }),
  makeSignal({ key: 'motor_lead_angle_deg', label: 'Unghi de avans', unit: '°', group: 'motor' }),
  makeSignal({ key: 'regen_vr_pct', label: 'Regen VR', unit: '%', group: 'motor' }),
  makeSignal({ key: 'motor_output_target', label: 'Țintă de ieșire', group: 'motor' }),
  makeSignal({ key: 'digi_sw_position', label: 'Comutator digital', group: 'motor', decimals: 0 }),
]

function insigna(signalKey: string): HTMLElement {
  const el = document.querySelector(`[data-signal="${signalKey}"]`)
  if (!el) throw new Error(`nu am gasit insigna pentru ${signalKey}`)
  return el as HTMLElement
}

afterEach(resetTelemetryStore)

describe('DriveStatePanel', () => {
  it('traduce fiecare valoare a stării de condus', () => {
    for (const [valoare, text] of [
      [0, 'Oprit'],
      [2, 'Înainte'],
      [3, 'Marșarier'],
    ] as const) {
      seedTelemetry(semnale, {
        drive_action: makeQuality('valid', valoare),
      })

      const { unmount } = render(<DriveStatePanel />)
      expect(insigna('drive_action').textContent).toContain(text)
      unmount()
      resetTelemetryStore()
    }
  })

  it('deosebește Eco de Power și regenerarea activă de cea inactivă', () => {
    seedTelemetry(semnale, {
      power_mode: makeQuality('valid', 1),
      regen_active: makeQuality('valid', 1),
      motor_ctrl_mode: makeQuality('valid', 0),
    })

    render(<DriveStatePanel />)

    expect(insigna('power_mode').textContent).toContain('Power')
    expect(insigna('regen_active').textContent).toContain('Regenerare activă')
    expect(insigna('motor_ctrl_mode').textContent).toContain('Mod curent')
  })

  it('marchează nivelul maxim de supraîncălzire ca fiind grav', () => {
    seedTelemetry(semnale, {
      motor_overheat_level: makeQuality('valid', 3),
    })

    render(<DriveStatePanel />)

    const el = insigna('motor_overheat_level')
    expect(el.textContent).toContain('Supraîncălzire 3')
    expect(el.className).toContain('text-rose-300')
  })

  it('arată „—" pentru un semnal care nu mai vine, nu prima valoare din enumerare', () => {
    seedTelemetry(semnale, {
      drive_action: makeQuality('stale', 2, 9000),
    })

    render(<DriveStatePanel />)

    const el = insigna('drive_action')
    expect(el.textContent).toContain('—')
    expect(el.textContent).not.toContain('Oprit')
    expect(el.textContent).not.toContain('Înainte')
  })

  it('nu ascunde o valoare din afara enumerării', () => {
    seedTelemetry(semnale, {
      drive_action: makeQuality('valid', 9),
    })

    render(<DriveStatePanel />)

    expect(insigna('drive_action').textContent).toContain('Valoare necunoscută')
  })

  it('afișează măsurătorile cu unitatea din catalog', () => {
    seedTelemetry(semnale, {
      motor_current_peak_a: makeQuality('valid', 512),
      motor_lead_angle_deg: makeQuality('valid', 17.5),
    })

    render(<DriveStatePanel />)

    expect(screen.getByText('512 A')).toBeInTheDocument()
    expect(screen.getByText('17,5°')).toBeInTheDocument()
  })
})
