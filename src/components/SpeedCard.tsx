import { Gauge } from 'lucide-react'
import { useGroundSpeed } from '../hooks/useSignal'
import { formatNumber } from '../lib/format'
import { MetricCard } from './MetricCard'

/**
 * Cardul de viteză.
 *
 * Cât timp placa trimite `vehicle_speed_kph`, este cardul obișnuit al acelui
 * semnal, cu tendința și starea lui de calitate. Când placa nu trimite viteza
 * deloc, cardul o deduce din turația motorului și circumferința roții de
 * 548 mm și spune explicit că a făcut-o: o cifră dedusă nu are voie să arate
 * identic cu una măsurată.
 */
export function SpeedCard() {
  const speed = useGroundSpeed()

  if (speed.source !== 'turație' || speed.kph === null) {
    return <MetricCard signalKey="vehicle_speed_kph" />
  }

  return (
    <article
      className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm"
      data-speed-source="turație"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-[0.16em] text-zinc-400 uppercase">
            Viteză
          </p>
          <p className="mt-3">
            <span className="text-3xl font-semibold tracking-tight text-white tabular-nums">
              {formatNumber(speed.kph, 1)} km/h
            </span>
          </p>
        </div>
        <span
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-300 ring-1 ring-blue-400/20"
          aria-hidden="true"
        >
          <Gauge size={20} strokeWidth={1.8} />
        </span>
      </div>

      <p className="mt-4 truncate text-sm text-zinc-400">
        Din turație × Ø 548 mm; placa nu trimite viteza.
      </p>
    </article>
  )
}
