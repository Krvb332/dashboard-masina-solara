import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

const labels = ['12:04', '12:05', '12:06', '12:07', '12:08', '12:09', '12:10']

export function TelemetryChart() {
  return (
    <ReactEChartsCore
      echarts={echarts}
      style={{ height: 272 }}
      option={{
        animationDuration: 350,
        backgroundColor: 'transparent',
        grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
        legend: {
          top: 0,
          right: 0,
          textStyle: { color: '#a1a1aa', fontFamily: 'IBM Plex Sans' },
          data: ['Consum', 'Solar'],
        },
        tooltip: { trigger: 'axis' },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: labels,
          axisLine: { lineStyle: { color: '#3f3f46' } },
          axisLabel: { color: '#71717a' },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: '#71717a', formatter: '{value} W' },
          splitLine: { lineStyle: { color: '#27272a', type: 'dashed' } },
        },
        series: [
          {
            name: 'Consum',
            type: 'line',
            smooth: true,
            showSymbol: false,
            data: [1530, 1480, 1640, 1580, 1710, 1660, 1590],
            lineStyle: { color: '#60a5fa', width: 2 },
            areaStyle: { color: 'rgba(59, 130, 246, 0.10)' },
          },
          {
            name: 'Solar',
            type: 'line',
            smooth: true,
            showSymbol: false,
            data: [850, 910, 940, 980, 1010, 990, 1040],
            lineStyle: { color: '#fbbf24', width: 2 },
          },
        ],
      }}
      opts={{ renderer: 'canvas' }}
      aria-label="Grafic demonstrativ cu puterea consumată și puterea solară"
    />
  )
}
