import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makeQuality,
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../test/fixtures'
import { SignalValue } from './SignalValue'

/**
 * Regula testată aici este cerința 3 din documentul de arhitectură: `0` și
 * „nu mai primesc date" trebuie să arate diferit. O regresie pe aici înseamnă
 * un inginer care crede că mașina merge cu 0 km/h în loc să vadă că legătura a
 * căzut.
 */

const speed = makeSignal({
  key: 'vehicle_speed_kph',
  label: 'Viteză',
  unit: 'km/h',
  decimals: 1,
})

afterEach(resetTelemetryStore)

describe('SignalValue', () => {
  it('afișează valoarea zero ca zero, nu ca lipsă de date', () => {
    seedTelemetry([speed], {
      vehicle_speed_kph: makeQuality('valid', 0),
    })

    render(<SignalValue signalKey="vehicle_speed_kph" />)

    const element = screen.getByText('0,0 km/h')
    expect(element).toBeInTheDocument()
    expect(element).toHaveAttribute('data-quality', 'valid')
  })

  it('afișează „—" când semnalul este învechit', () => {
    seedTelemetry([speed], {
      vehicle_speed_kph: makeQuality('stale', 63.8, 12_000),
    })

    render(<SignalValue signalKey="vehicle_speed_kph" />)

    expect(screen.queryByText(/63,8/)).not.toBeInTheDocument()
    const element = screen.getByText('—')
    expect(element).toHaveAttribute('data-quality', 'stale')
    // Valoarea veche rămâne în tooltip, ca inginerul să aibă context.
    expect(element.getAttribute('title')).toContain('63.8')
    expect(element.getAttribute('title')).toContain('12,0 s')
  })

  it('afișează „—" când semnalul nu a fost primit niciodată', () => {
    seedTelemetry([speed], {
      vehicle_speed_kph: makeQuality('unavailable', null),
    })

    render(<SignalValue signalKey="vehicle_speed_kph" />)

    const element = screen.getByText('—')
    expect(element).toHaveAttribute('data-quality', 'unavailable')
    expect(element.getAttribute('title')).toBe('Semnal nerecepționat')
  })

  it('tratează un semnal necunoscut ca indisponibil', () => {
    seedTelemetry([speed])

    render(<SignalValue signalKey="semnal_inexistent" />)

    expect(screen.getByText('—')).toHaveAttribute('data-quality', 'unavailable')
  })

  it('marchează vizibil eroarea de senzor', () => {
    seedTelemetry([speed], {
      vehicle_speed_kph: makeQuality('sensor_error', 4200, 100),
    })

    render(<SignalValue signalKey="vehicle_speed_kph" />)

    const element = screen.getByText('—')
    expect(element).toHaveAttribute('data-quality', 'sensor_error')
    expect(element.className).toContain('text-rose-400')
  })

  it('respectă zecimalele și unitatea din catalog', () => {
    seedTelemetry(
      [makeSignal({ key: 'cell_voltage_min_v', unit: 'V', decimals: 3 })],
      { cell_voltage_min_v: makeQuality('valid', 3.6421) },
    )

    render(<SignalValue signalKey="cell_voltage_min_v" />)

    expect(screen.getByText('3,642 V')).toBeInTheDocument()
  })

  it('afișează puterea de pachet pe scala comprimată, cu valoarea măsurată în tooltip', () => {
    const packPower = makeSignal({
      key: 'battery_power_w',
      label: 'Putere baterie',
      unit: 'W',
      decimals: 1,
    })
    seedTelemetry([packPower], {
      battery_power_w: makeQuality('valid', 5000),
    })

    render(<SignalValue signalKey="battery_power_w" />)

    // 5 kW măsurați se afișează comprimat, sub plafonul de 4 kW.
    const element = screen.getByText('3.938,3 W')
    expect(element).toHaveAttribute('data-quality', 'valid')
    expect(element.getAttribute('title')).toContain('5.000,0 W')
  })

  it('lasă neatinsă puterea de pachet sub pragul de compresie', () => {
    const packPower = makeSignal({
      key: 'battery_power_w',
      label: 'Putere baterie',
      unit: 'W',
      decimals: 1,
    })
    seedTelemetry([packPower], {
      battery_power_w: makeQuality('valid', 1800),
    })

    render(<SignalValue signalKey="battery_power_w" />)

    const element = screen.getByText('1.800,0 W')
    expect(element.getAttribute('title')).not.toContain('comprimată')
  })
})
