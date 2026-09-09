import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makeQuality,
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../test/fixtures'
import type { SignalDefinition, SignalQuality } from '../schemas/telemetry'
import { CellGrid } from './CellGrid'

/**
 * Grila celulelor trebuie să răspundă la o singură întrebare: care celulă
 * cedează. Testele de aici o pun în cele trei feluri în care poate fi greșit
 * răspunsul — celula greșită marcată, o celulă fără date desenată ca 0 V, sau
 * ordinea celulelor amestecată de sortarea alfabetică.
 */

const CELL_COUNT = 32

function cellKey(index: number): string {
  return `cell_${String(index).padStart(2, '0')}_v`
}

function cellSignals(): SignalDefinition[] {
  return Array.from({ length: CELL_COUNT }, (_, i) =>
    makeSignal({
      key: cellKey(i + 1),
      label: `Celula ${i + 1}`,
      unit: 'V',
      group: 'energy',
      decimals: 3,
      min: 2.5,
      max: 4.3,
      warn_below: 3.0,
      crit_below: 2.8,
    }),
  )
}

const aggregates: SignalDefinition[] = [
  makeSignal({ key: 'cell_voltage_min_v', label: 'Celulă minimă', unit: 'V', decimals: 3 }),
  makeSignal({ key: 'cell_voltage_max_v', label: 'Celulă maximă', unit: 'V', decimals: 3 }),
  makeSignal({ key: 'cell_voltage_delta_v', label: 'Dezechilibru', unit: 'V', decimals: 3 }),
  makeSignal({ key: 'cell_min_index', label: 'Celula minimă (nr.)', decimals: 0 }),
  makeSignal({ key: 'cell_max_index', label: 'Celula maximă (nr.)', decimals: 0 }),
]

/** Toate celulele la 3,9 V, în afară de cele numite explicit. */
function quality(
  overrides: Record<string, SignalQuality> = {},
): Record<string, SignalQuality> {
  const map: Record<string, SignalQuality> = {}
  for (let i = 1; i <= CELL_COUNT; i += 1) {
    map[cellKey(i)] = makeQuality('valid', 3.9)
  }
  return { ...map, ...overrides }
}

afterEach(resetTelemetryStore)

describe('CellGrid', () => {
  it('desenează câte o bară pentru fiecare celulă din catalog', () => {
    seedTelemetry([...cellSignals(), ...aggregates], quality())

    render(<CellGrid />)

    expect(screen.getAllByRole('listitem')).toHaveLength(CELL_COUNT)
    expect(screen.getByLabelText('Celula 1: 3,900 V')).toBeInTheDocument()
    expect(screen.getByLabelText(`Celula ${CELL_COUNT}: 3,900 V`)).toBeInTheDocument()
  })

  it('păstrează ordinea fizică a celulelor, nu una alfabetică', () => {
    seedTelemetry([...cellSignals(), ...aggregates], quality())

    render(<CellGrid />)

    const numere = screen
      .getAllByRole('listitem')
      .map((el) => Number(el.getAttribute('data-cell')))

    expect(numere).toEqual(
      Array.from({ length: CELL_COUNT }, (_, i) => i + 1),
    )
  })

  it('marchează celula minimă și pe cea maximă raportate de BMS', () => {
    seedTelemetry(
      [...cellSignals(), ...aggregates],
      quality({
        cell_07_v: makeQuality('valid', 3.71),
        cell_19_v: makeQuality('valid', 4.02),
        cell_min_index: makeQuality('valid', 7),
        cell_max_index: makeQuality('valid', 19),
      }),
    )

    render(<CellGrid />)

    const celule = screen.getAllByRole('listitem')
    const minima = celule.find((el) => el.getAttribute('data-cell') === '7')
    const maxima = celule.find((el) => el.getAttribute('data-cell') === '19')
    const oarecare = celule.find((el) => el.getAttribute('data-cell') === '3')

    expect(minima?.className).toContain('border-sky-400/60')
    expect(maxima?.className).toContain('border-amber-400/60')
    // Controlul negativ: fără el, un test care marchează TOATE celulele ar trece.
    expect(oarecare?.className).not.toContain('border-sky-400/60')
    expect(oarecare?.className).not.toContain('border-amber-400/60')
  })

  it('arată o celulă fără date ca lipsă, nu ca zero volți', () => {
    seedTelemetry(
      [...cellSignals(), ...aggregates],
      quality({ cell_05_v: makeQuality('unavailable', null) }),
    )

    render(<CellGrid />)

    const celula = screen
      .getAllByRole('listitem')
      .find((el) => el.getAttribute('data-cell') === '5')

    expect(celula).toHaveAttribute('data-quality', 'unavailable')
    expect(celula?.textContent).toContain('—')
    expect(celula?.textContent).not.toContain('0,000')
  })

  it('colorează în roșu o celulă sub pragul critic', () => {
    seedTelemetry(
      [...cellSignals(), ...aggregates],
      quality({ cell_11_v: makeQuality('valid', 2.72) }),
    )

    render(<CellGrid />)

    const celula = screen
      .getAllByRole('listitem')
      .find((el) => el.getAttribute('data-cell') === '11')

    expect(celula?.innerHTML).toContain('bg-rose-500/80')
  })

  it('spune limpede când catalogul nu are celule', () => {
    seedTelemetry(aggregates, {})

    render(<CellGrid />)

    expect(
      screen.getByText('Catalogul nu conține celule individuale.'),
    ).toBeInTheDocument()
  })
})
