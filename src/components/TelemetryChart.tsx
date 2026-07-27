import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
// Build-ul ESM al pachetului. Varianta `lib/core` este CommonJS și, prin
// interop-ul din browser, ajunge ca obiect de modul, nu ca o componentă —
// React respinge asta cu „Element type is invalid".
import ReactEChartsCore from 'echarts-for-react/esm/core'
import { useMemo } from 'react'
import { formatNumber } from '../lib/format'
import { historyBuffer, useTelemetryStore } from '../stores/telemetry-store'

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

export type ChartSeries = {
  signal: string
  label: string
  color: string
  /** Umple zona de sub linie. Recomandat pentru cel mult o serie. */
  area?: boolean
}

type TelemetryChartProps = {
  series: ChartSeries[]
  /** Fereastra de timp afișată, în secunde. */
  windowSeconds?: number
  unit?: string
  decimals?: number
  height?: number
  ariaLabel: string
}

/**
 * Grafic de serii temporale alimentat din `historyBuffer`.
 *
 * Se reabonează la `historyVersion`, nu la datele în sine: bufferul este
 * mutabil, deci versiunea este singurul indiciu de schimbare. Eșantionarea LTTB
 * păstrează forma curbei reducând punctele desenate la lățimea în pixeli.
 */
export function TelemetryChart({
  series,
  windowSeconds = 420,
  unit = '',
  decimals = 0,
  height = 272,
  ariaLabel,
}: TelemetryChartProps) {
  const version = useTelemetryStore((state) => state.historyVersion)

  const option = useMemo(() => {
    const keys = series.map((entry) => entry.signal)
    const { timestamps, series: columns } = historyBuffer.window(
      keys,
      windowSeconds,
    )

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: '#a1a1aa', fontFamily: 'IBM Plex Sans' },
        data: series.map((entry) => entry.label),
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#18181b',
        borderColor: '#3f3f46',
        textStyle: { color: '#e4e4e7' },
        valueFormatter: (value: number | null) =>
          value === null ? '—' : `${formatNumber(value, decimals)} ${unit}`.trim(),
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#3f3f46' } },
        axisLabel: { color: '#71717a', hideOverlap: true },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: '#71717a',
          formatter: (value: number) =>
            unit ? `${formatNumber(value, decimals)} ${unit}` : formatNumber(value, decimals),
        },
        splitLine: { lineStyle: { color: '#27272a', type: 'dashed' } },
      },
      series: series.map((entry) => ({
        name: entry.label,
        type: 'line' as const,
        smooth: false,
        showSymbol: false,
        sampling: 'lttb' as const,
        // Golurile de comunicație rămân goluri; nu unim peste ele.
        connectNulls: false,
        data: timestamps.map((timestamp, index) => [
          timestamp,
          columns[entry.signal]?.[index] ?? null,
        ]),
        lineStyle: { color: entry.color, width: 2 },
        itemStyle: { color: entry.color },
        ...(entry.area
          ? { areaStyle: { color: `${entry.color}1f` } }
          : {}),
      })),
    }
    // `version` este dependența reală: bufferul se modifică pe loc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, series, windowSeconds, unit, decimals])

  return (
    <ReactEChartsCore
      echarts={echarts}
      style={{ height }}
      option={option}
      notMerge={false}
      lazyUpdate
      opts={{ renderer: 'canvas' }}
      aria-label={ariaLabel}
    />
  )
}
