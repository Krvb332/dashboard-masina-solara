import clsx from 'clsx'
import {
  CircleAlert,
  Info,
  ThumbsUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Panel } from '../../components/Panel'
import { WeatherForecast } from '../../components/WeatherForecast'
import { WeatherImpactPanel } from '../../components/WeatherImpactPanel'
import { WeatherPanel } from '../../components/WeatherPanel'
import type { AdviceLevel } from '../../lib/coaching'
import { useWeatherAdvice } from '../../hooks/useWeather'

/**
 * Pagina de vreme și condiții meteo.
 *
 * Ordinea de pe ecran este ordinea întrebărilor din boxă: ce trebuie transmis
 * pilotului acum, ce este afară, ce înseamnă pentru mașină, ce urmează.
 * Recomandările stau primele pentru că ele se citesc pe radio; cifrele din care
 * au ieșit stau imediat sub ele, pentru inginerul care vrea să le verifice.
 */

const levelIcons: Record<AdviceLevel, LucideIcon> = {
  critical: CircleAlert,
  warning: TriangleAlert,
  info: Info,
  good: ThumbsUp,
}

const levelClasses: Record<AdviceLevel, string> = {
  critical: 'border-rose-400/30 bg-rose-500/[0.09] text-rose-100',
  warning: 'border-amber-400/30 bg-amber-500/[0.08] text-amber-100',
  info: 'border-sky-400/25 bg-sky-500/[0.07] text-sky-100',
  good: 'border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-100',
}

const levelAccent: Record<AdviceLevel, string> = {
  critical: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300',
  good: 'text-emerald-300',
}

function WeatherAdviceList() {
  const advice = useWeatherAdvice()

  if (advice.length === 0) {
    return (
      <p
        className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-zinc-500"
        role="status"
      >
        Nicio observație meteo de transmis. Fie condițiile nu cer nimic de la
        pilot, fie nu există date — starea de mai jos spune care dintre ele.
      </p>
    )
  }

  return (
    <ul className="grid gap-2" aria-label="Recomandări meteo">
      {advice.map((entry) => {
        const Icon = levelIcons[entry.level]
        return (
          <li
            key={entry.id}
            className={clsx(
              'flex gap-3 rounded-xl border px-4 py-3',
              levelClasses[entry.level],
            )}
            data-advice={entry.id}
          >
            <Icon
              size={18}
              className={clsx('mt-0.5 shrink-0', levelAccent[entry.level])}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-semibold">{entry.title}</p>
              <p className="mt-0.5 text-sm opacity-90">{entry.detail}</p>
              <p className="mt-1 text-sm font-medium">{entry.action}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function WeatherPage() {
  return (
    <>
      <section className="mt-7" aria-label="Recomandări meteo pentru pilot">
        <Panel
          title="Ce transmitem pilotului despre vreme"
          subtitle="Fiecare observație poartă cifra care o susține"
        >
          <WeatherAdviceList />
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        <Panel
          title="Condiții la fața locului"
          subtitle="Măsurători brute, așa cum vin de la furnizor"
        >
          <WeatherPanel />
        </Panel>

        <Panel
          title="Ce înseamnă pentru mașină"
          subtitle="Mărimi derivate, cu formula sub fiecare cifră"
        >
          <WeatherImpactPanel />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Următoarele ore"
          subtitle="Bara arată iradianța estimată: când se închide fereastra solară"
        >
          <WeatherForecast />
        </Panel>
      </section>
    </>
  )
}
