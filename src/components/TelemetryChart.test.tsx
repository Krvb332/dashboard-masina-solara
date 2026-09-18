import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Graficul desenează în canvas, deci nu poate fi citit din DOM. Testul prinde
 * `echarts.init` și se uită la ce serii primește: acolo se vede dacă puterea de
 * pachet a trecut prin scala de afișare și dacă restul semnalelor au rămas
 * neatinse.
 */

const setOption = vi.fn()

vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: () => ({
    setOption,
    resize: vi.fn(),
    dispose: vi.fn(),
  }),
}))
vi.mock('echarts/charts', () => ({ LineChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

const series: Record<string, [number, number][]> = {}

vi.mock('../lib/telemetry-buffer', () => ({
  telemetryBuffer: {
    toSeries: (key: string) => series[key] ?? [],
  },
}))

const { TelemetryChart } = await import('./TelemetryChart')

let frameCallback: FrameRequestCallback | null = null

beforeEach(() => {
  setOption.mockClear()
  frameCallback = null
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameCallback = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Ultima serie trimisă graficului pentru cheia dată. */
function lastSeries(key: string): [number, number][] {
  const calls = setOption.mock.calls
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const option = calls[index][0] as {
      series?: { id: string; data?: [number, number][] }[]
    }
    const match = option.series?.find((item) => item.id === key)
    if (match?.data) return match.data
  }
  throw new Error(`nicio serie trimisă pentru ${key}`)
}

describe('TelemetryChart', () => {
  it('desenează puterea de pachet pe scala comprimată și lasă restul neatins', () => {
    series.battery_power_w = [
      [1000, 1500],
      [2000, 6000],
      [3000, -8000],
    ]
    series.solar_power_w = [
      [1000, 1200],
      [2000, 6000],
    ]

    render(
      <TelemetryChart signalKeys={['battery_power_w', 'solar_power_w']} />,
    )
    frameCallback?.(1_000_000)

    const pack = lastSeries('battery_power_w')
    expect(pack[0][1]).toBe(1500) // sub prag: neatins
    expect(pack[1][1]).toBeCloseTo(3985.21, 2) // 6 kW → comprimat
    expect(pack[2][1]).toBeCloseTo(-3999.15, 2) // încărcarea, simetric

    // Solarul are aceeași cifră de 6 kW și trebuie să rămână 6 kW: scala este
    // doar a puterii de pachet.
    expect(lastSeries('solar_power_w')[1][1]).toBe(6000)
  })
})
