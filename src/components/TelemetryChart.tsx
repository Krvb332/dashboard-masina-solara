import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef } from 'react'
import { formatClock, formatNumber } from '../lib/format'
import type { TelemetryRingBuffer } from '../lib/ring-buffer'
import { telemetryBuffer } from '../lib/telemetry-buffer'
import type { SignalDefinition } from '../schemas/telemetry'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Graficul fluxului live.
 *
 * Datele vin direct din bufferul de serii temporale, într-o buclă
 * `requestAnimationFrame`, ocolind complet React: la 10 Hz, o re-randare React
 * pentru fiecare punct ar costa mult mai mult decât desenarea propriu-zisă.
 * Numărul de puncte este redus la lățimea disponibilă în pixeli, păstrând
 * minimul și maximul fiecărui interval, ca vârfurile scurte să nu dispară.
 */

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

/** Cât de des redesenăm. Mai des decât atât nu percepe ochiul pe un grafic. */
const REDRAW_INTERVAL_MS = 200
const FALLBACK_COLORS = ['#60a5fa', '#fbbf24', '#34d399', '#f472b6', '#a78bfa']

type TelemetryChartProps = {
  signalKeys: string[]
  /** Fereastra vizibilă, în milisecunde. */
  windowMs?: number
  height?: number
  ariaLabel?: string
  /**
   * De unde se citesc seriile. Implicit bufferul de telemetrie măsurată;
   * pagina de statistici trimite bufferul de serii calculate.
   */
  source?: TelemetryRingBuffer
  /**
   * Definiții pentru semnale care nu sunt în catalogul serverului — mărimile
   * derivate. Se suprapun peste catalog, deci o cheie reală rămâne descrisă de
   * server, sursa ei de adevăr.
   */
  extraDefinitions?: Record<string, SignalDefinition>
}

export function TelemetryChart({
  signalKeys,
  windowMs = 7 * 60_000,
  height = 272,
  ariaLabel,
  source,
  extraDefinitions,
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const catalog = useTelemetryStore((state) => state.catalogByKey)
  const catalogByKey = useMemo(
    () => (extraDefinitions ? { ...catalog, ...extraDefinitions } : catalog),
    [catalog, extraDefinitions],
  )
  const buffer = source ?? telemetryBuffer
  const keys = signalKeys.join('|')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = echarts.init(container, undefined, { renderer: 'canvas' })
    const activeKeys = keys.split('|').filter(Boolean)
    const reducedMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches

    const definitions = activeKeys.map((key) => catalogByKey[key])
    const units = new Set(
      definitions.map((definition) => definition?.unit ?? ''),
    )
    const sharedUnit = units.size === 1 ? [...units][0] : ''

    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 8, right: 12, top: 28, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: '#a1a1aa', fontFamily: 'IBM Plex Sans' },
        data: activeKeys.map((key) => catalogByKey[key]?.label ?? key),
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(9, 9, 11, 0.92)',
        borderColor: '#3f3f46',
        textStyle: { color: '#fafafa' },
        formatter: (params: unknown) =>
          tooltipFormatter(params, activeKeys, catalogByKey),
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#3f3f46' } },
        axisLabel: {
          color: '#71717a',
          formatter: (value: number) => formatClock(value),
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: '#71717a',
          formatter: (value: number) =>
            sharedUnit ? `${value} ${sharedUnit}` : String(value),
        },
        splitLine: { lineStyle: { color: '#27272a', type: 'dashed' } },
      },
      series: activeKeys.map((key, index) => {
        const definition = catalogByKey[key]
        const color =
          definition?.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]

        return {
          id: key,
          name: definition?.label ?? key,
          type: 'line',
          smooth: false,
          showSymbol: false,
          sampling: 'lttb',
          lineStyle: { color, width: 2 },
          itemStyle: { color },
          areaStyle:
            index === 0 ? { color: `${color}1a`, origin: 'start' } : undefined,
          data: [] as [number, number][],
        }
      }),
    })

    let frame: number | null = null
    let lastDraw = 0

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (now - lastDraw < REDRAW_INTERVAL_MS) return
      lastDraw = now

      const maxPoints = Math.max(120, Math.round(container.clientWidth * 1.2))
      chart.setOption({
        series: activeKeys.map((key) => ({
          id: key,
          data: buffer.toSeries(key, windowMs, maxPoints),
        })),
      })
    }

    if (reducedMotion) {
      // Fără animație de fundal: redesenăm mai rar, la interval fix.
      const timer = setInterval(() => draw(performance.now()), 1000)
      return () => {
        clearInterval(timer)
        chart.dispose()
      }
    }

    frame = requestAnimationFrame(draw)

    const resize = () => chart.resize()
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(resize)

    resizeObserver?.observe(container)
    window.addEventListener('resize', resize)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', resize)
      chart.dispose()
    }
  }, [buffer, catalogByKey, keys, windowMs])

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full"
      role="img"
      aria-label={ariaLabel ?? 'Grafic cu evoluția semnalelor de telemetrie'}
    />
  )
}

type TooltipParam = { seriesName: string; value: [number, number] }

function tooltipFormatter(
  params: unknown,
  keys: string[],
  catalogByKey: Record<
    string,
    { label: string; unit: string; decimals: number }
  >,
): string {
  const items = (Array.isArray(params) ? params : [params]) as TooltipParam[]
  if (items.length === 0) return ''

  const time = formatClock(items[0].value[0])
  const rows = items.map((item) => {
    const key = keys.find(
      (candidate) => catalogByKey[candidate]?.label === item.seriesName,
    )
    const definition = key ? catalogByKey[key] : undefined
    const value = formatNumber(item.value[1], definition?.decimals ?? 1)
    const unit = definition?.unit ? ` ${definition.unit}` : ''
    return `${item.seriesName}: <b>${value}${unit}</b>`
  })

  return [time, ...rows].join('<br/>')
}
