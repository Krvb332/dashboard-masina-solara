import clsx from 'clsx'
import { useSignal } from '../hooks/useSignal'
import { NO_VALUE } from '../lib/format'
import { SignalValue } from './SignalValue'

/**
 * Starea de condus raportată de controller, ca insigne.
 *
 * Câmpurile din cadrul 1 sunt enumerări, nu măsurători: „2" înseamnă înainte,
 * „3" marșarier. Un rând de tabel cu „3,0" nu ajută pe nimeni în boxă, așa că
 * traducem valorile aici. Numerele care chiar sunt măsurători (PWM, unghi de
 * avans, curentul de vârf) rămân valori, afișate de `SignalValue` cu unitatea
 * și zecimalele din catalog.
 *
 * Fiecare insignă citește starea de calitate a semnalului ei, deci un câmp care
 * nu mai vine arată „—", nu prima valoare din enumerare.
 */

type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-white/5 text-zinc-300 ring-white/10',
  good: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  warn: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
  bad: 'bg-rose-500/10 text-rose-300 ring-rose-400/20',
}

type Enumerare = Record<number, { text: string; tone: BadgeTone }>

const DRIVE_ACTION: Enumerare = {
  0: { text: 'Oprit', tone: 'neutral' },
  1: { text: 'Rezervat', tone: 'warn' },
  2: { text: 'Înainte', tone: 'good' },
  3: { text: 'Marșarier', tone: 'warn' },
}

const POWER_MODE: Enumerare = {
  0: { text: 'Eco', tone: 'good' },
  1: { text: 'Power', tone: 'warn' },
}

const CTRL_MODE: Enumerare = {
  0: { text: 'Mod curent', tone: 'neutral' },
  1: { text: 'Mod PWM', tone: 'neutral' },
}

const REGEN: Enumerare = {
  0: { text: 'Fără regenerare', tone: 'neutral' },
  1: { text: 'Regenerare activă', tone: 'good' },
}

const OVERHEAT: Enumerare = {
  0: { text: 'Temperatură normală', tone: 'good' },
  1: { text: 'Supraîncălzire 1', tone: 'warn' },
  2: { text: 'Supraîncălzire 2', tone: 'warn' },
  3: { text: 'Supraîncălzire 3', tone: 'bad' },
}

export function DriveStatePanel() {
  return (
    <div>
      <ul className="flex flex-wrap gap-2" aria-label="Starea de condus">
        <Badge signalKey="drive_action" values={DRIVE_ACTION} />
        <Badge signalKey="power_mode" values={POWER_MODE} />
        <Badge signalKey="motor_ctrl_mode" values={CTRL_MODE} />
        <Badge signalKey="regen_active" values={REGEN} />
        <Badge signalKey="motor_overheat_level" values={OVERHEAT} />
      </ul>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Measurement label="Curent de vârf" signalKey="motor_current_peak_a" />
        <Measurement label="PWM duty" signalKey="motor_pwm_duty_pct" />
        <Measurement label="Unghi de avans" signalKey="motor_lead_angle_deg" />
        <Measurement label="Potențiometru regen" signalKey="regen_vr_pct" />
        <Measurement label="Țintă de ieșire" signalKey="motor_output_target" />
        <Measurement label="Comutator digital" signalKey="digi_sw_position" />
      </dl>
    </div>
  )
}

function Badge({
  signalKey,
  values,
}: {
  signalKey: string
  values: Enumerare
}) {
  const { definition, value, fresh } = useSignal(signalKey)

  // O valoare din afara enumerării nu se ascunde și nu se rotunjește la cea mai
  // apropiată: se arată ca atare, fiindcă înseamnă că protocolul s-a schimbat.
  const intrare = fresh && value !== null ? values[Math.round(value)] : undefined
  const text = fresh
    ? (intrare?.text ?? `Valoare necunoscută: ${value}`)
    : NO_VALUE
  const tone: BadgeTone = fresh ? (intrare?.tone ?? 'bad') : 'neutral'

  return (
    <li
      className={clsx(
        'rounded-full px-3 py-1 text-sm ring-1 ring-inset',
        toneClasses[tone],
        !fresh && 'text-zinc-600',
      )}
      title={definition?.label ?? signalKey}
      data-signal={signalKey}
    >
      <span className="text-xs text-zinc-500">
        {definition?.label ?? signalKey}:{' '}
      </span>
      {text}
    </li>
  )
}

function Measurement({
  label,
  signalKey,
}: {
  label: string
  signalKey: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5">
        <SignalValue signalKey={signalKey} size="sm" />
      </dd>
    </div>
  )
}
