import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import { formatNumber } from '../lib/format'
import { collectFixes } from '../lib/gps-buffer'
import { anchorStationary, elevationProfile } from '../lib/gps'

/**
 * Profilul de elevație al traseului parcurs: altitudine față de distanță.
 *
 * Axa X este distanța cumulată, nu timpul. Un profil desenat în timp arată
 * altfel la fiecare oprire, iar întrebarea la care răspunde graficul este „unde
 * pe traseu urcăm", nu „când am urcat". Distanța se calculează haversine între
 * fixuri, cu aceleași reguli de validare ca restul GPS-ului — un fix respins nu
 * adaugă nici metri, nici altitudine.
 */

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const REDRAW_INTERVAL_MS = 1000

type ElevationProfileProps = {
  height?: number
}

export function ElevationProfileChart({ height = 220 }: ElevationProfileProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = echarts.init(container, undefined, { renderer: 'canvas' })

    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(9, 9, 11, 0.92)',
        borderColor: '#3f3f46',
        textStyle: { color: '#fafafa' },
        formatter: (params: unknown) => {
          const items = (Array.isArray(params) ? params : [params]) as {
            value: [number, number]
          }[]
          if (items.length === 0) return ''
          const [distance, altitude] = items[0].value
          return `${formatNumber(distance / 1000, 2)} km<br/><b>${formatNumber(altitude, 1)} m</b>`
        },
      },
      xAxis: {
        type: 'value',
        name: 'km',
        nameTextStyle: { color: '#52525b' },
        axisLine: { lineStyle: { color: '#3f3f46' } },
        axisLabel: {
          color: '#71717a',
          formatter: (value: number) => formatNumber(value / 1000, 1),
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: '#71717a',
          formatter: (value: number) => `${value} m`,
        },
        splitLine: { lineStyle: { color: '#27272a', type: 'dashed' } },
      },
      series: [
        {
          id: 'elevation',
          name: 'Altitudine',
          type: 'line',
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#94a3b8', width: 2 },
          areaStyle: { color: 'rgba(148, 163, 184, 0.12)' },
          data: [] as [number, number][],
        },
      ],
    })

    const draw = () => {
      // Ancorat, ca și harta. Axa orizontală este distanța parcursă: pe un
      // vehicul oprit, dispersia receptorului o împinge înainte și profilul se
      // lățește la nesfârșit, arătând un traseu care nu a avut loc.
      const profile = elevationProfile(anchorStationary(collectFixes()))
      chart.setOption({ series: [{ id: 'elevation', data: profile.points }] })
    }

    draw()
    const timer = setInterval(draw, REDRAW_INTERVAL_MS)

    const resize = () => chart.resize()
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(resize)
    resizeObserver?.observe(container)
    window.addEventListener('resize', resize)

    return () => {
      clearInterval(timer)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', resize)
      chart.dispose()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full"
      role="img"
      aria-label="Profilul de elevație al traseului parcurs"
    />
  )
}
