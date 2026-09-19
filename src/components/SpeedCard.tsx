import { Gauge } from 'lucide-react'
import { useGroundSpeed, useSignal } from '../hooks/useSignal'
import { formatAge, formatNumber, NO_VALUE } from '../lib/format'
import { MetricCard } from './MetricCard'

/**
 * Cardul de viteză.
 *
 * Cât timp placa trimite `vehicle_speed_kph`, este cardul obișnuit al acelui
 * semnal, cu tendința și starea lui de calitate. Placa de pe mașina asta nu îl
 * trimite însă deloc: viteza se deduce din turația motorului și circumferința
 * roții de 548 mm, iar cardul spune explicit că a făcut-o — o cifră dedusă nu
 * are voie să arate identic cu una măsurată.
 *
 * Când nici turația nu este proaspătă, cardul spune *ce anume* lipsește.
 * „Fără date de la mașină" ar fi fals cât timp bateria, temperaturile și
 * anvelopele continuă să sosească: nu mașina tace, ci controllerul motorului.
 */
export function SpeedCard() {
  const speed = useGroundSpeed()
  const reported = useSignal('vehicle_speed_kph')
  const rpm = useSignal('motor_rpm')

  // Placa a trimis cândva viteza: cardul obișnuit, cu vechimea ultimei valori.
  if (speed.source === 'raportată' || reported.state === 'stale') {
    return <MetricCard signalKey="vehicle_speed_kph" />
  }

  const derived = speed.source === 'turație' ? speed.kph : null

  let detail: string
  if (derived !== null) {
    detail = 'Din turație × Ø 548 mm; placa nu trimite viteza.'
  } else if (rpm.state === 'stale') {
    detail = `Placa nu trimite viteza, iar turația motorului este învechită (acum ${formatAge(rpm.quality?.age_ms)}).`
  } else if (rpm.state === 'sensor_error') {
    detail =
      'Placa nu trimite viteza, iar turația motorului este în afara domeniului.'
  } else {
    detail =
      'Placa nu trimite viteza, iar controllerul motorului nu trimite turația.'
  }

  return (
    <article
      className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm"
      data-speed-source={speed.source ?? 'none'}
      // Aceeași ancoră ca varianta `MetricCard`: o alarmă de viteză duce aici.
      data-signal="vehicle_speed_kph"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-[0.16em] text-zinc-400 uppercase">
            Viteză
          </p>
          <p className="mt-3">
            <span
              className={
                derived === null
                  ? 'text-3xl font-semibold tracking-tight text-zinc-600 tabular-nums'
                  : 'text-3xl font-semibold tracking-tight text-white tabular-nums'
              }
            >
              {derived === null ? NO_VALUE : `${formatNumber(derived, 1)} km/h`}
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

      <p className="mt-4 text-sm leading-5 text-zinc-400">{detail}</p>
    </article>
  )
}
