import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makeQuality,
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../test/fixtures'
import { FaultPanel, MITSUBA_FAULTS } from './FaultPanel'

/**
 * Panoul traduce o mască de biți în intervenții pe mașină. Cele două feluri în
 * care poate minți sunt să arate o eroare care nu există și să tacă peste una
 * care există; ambele sunt testate, plus cazul în care nu vin date deloc.
 */

const faultCode = makeSignal({
  key: 'motor_fault_code',
  label: 'Cod eroare',
  group: 'motor',
  decimals: 0,
})

afterEach(resetTelemetryStore)

describe('FaultPanel', () => {
  it('anunță explicit lipsa erorilor când masca este zero', () => {
    seedTelemetry([faultCode], {
      motor_fault_code: makeQuality('valid', 0),
    })

    render(<FaultPanel />)

    expect(screen.getByTestId('fault-none')).toBeInTheDocument()
    expect(screen.queryByTestId('fault-list')).not.toBeInTheDocument()
  })

  it('numește exact erorile aprinse și numai pe ele', () => {
    // Bitul 27 = motor blocat, bitul 3 = termistor FET.
    seedTelemetry([faultCode], {
      motor_fault_code: makeQuality('valid', (1 << 27) | (1 << 3)),
    })

    render(<FaultPanel />)

    const active = screen
      .getAllByRole('listitem')
      .map((el) => Number(el.getAttribute('data-fault-bit')))

    expect(active.sort((a, b) => a - b)).toEqual([3, 27])
    expect(screen.getByText('Motor blocat')).toBeInTheDocument()
    expect(screen.getByText('Termistor FET')).toBeInTheDocument()
    // Controlul negativ: o eroare vecină în tabel nu trebuie să apară.
    expect(screen.queryByText('Senzor Hall deconectat')).not.toBeInTheDocument()
  })

  it('nu confundă biții de sus din cauza semnului', () => {
    // Bitul 29 este ultimul folosit; într-o mască citită cu semn ar fi fost
    // interpretat greșit împreună cu bitul 31.
    seedTelemetry([faultCode], {
      motor_fault_code: makeQuality('valid', 1 << 29),
    })

    render(<FaultPanel />)

    expect(screen.getByText('Senzor Hall deconectat')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('arată fiecare eroare din tabel când masca le aprinde pe toate', () => {
    const toate = MITSUBA_FAULTS.reduce((acc, f) => acc | (1 << f.bit), 0)

    seedTelemetry([faultCode], {
      motor_fault_code: makeQuality('valid', toate >>> 0),
    })

    render(<FaultPanel />)

    expect(screen.getAllByRole('listitem')).toHaveLength(MITSUBA_FAULTS.length)
  })

  it('nu inventează „fără erori" când semnalul lipsește', () => {
    seedTelemetry([faultCode], {
      motor_fault_code: makeQuality('unavailable', null),
    })

    render(<FaultPanel />)

    expect(screen.getByTestId('fault-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('fault-none')).not.toBeInTheDocument()
  })

  it('nu are două erori pe aceeași poziție de bit', () => {
    const biti = MITSUBA_FAULTS.map((f) => f.bit)
    expect(new Set(biti).size).toBe(biti.length)
  })
})
