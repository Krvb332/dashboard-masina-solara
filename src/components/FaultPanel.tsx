import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useSignal } from '../hooks/useSignal'

/**
 * Codul de eroare al controllerului Mitsuba, descompus pe nume.
 *
 * `motor_fault_code` este masca de biți din cadrul 2 (0x08A50225). Ca număr
 * brut nu spune nimic: 268435456 și 536870912 arată la fel de nefolositor, deși
 * unul înseamnă „senzor Hall în scurtcircuit" și celălalt „senzor Hall
 * deconectat" — două intervenții complet diferite pe mașină.
 *
 * Pozițiile de mai jos trebuie să rămână identice cu `MITSUBA_ERROR_BITS` din
 * firmware și cu tabelul 1.5 din `docs/adrese_mitsuba_bms.md`. Verificarea
 * `scripts/unlazy/verify-fault-bits.mjs` din depozitul de firmware compară
 * automat cele trei liste.
 */

type Fault = {
  bit: number
  label: string
  hint: string
}

export const MITSUBA_FAULTS: readonly Fault[] = [
  { bit: 0, label: 'Senzor analogic', hint: 'Eroare pe intrarea analog-digitală.' },
  { bit: 1, label: 'Senzor curent fază U', hint: 'Măsurarea curentului pe faza U.' },
  { bit: 2, label: 'Senzor curent fază W', hint: 'Măsurarea curentului pe faza W.' },
  { bit: 3, label: 'Termistor FET', hint: 'Senzorul de temperatură al controllerului.' },
  { bit: 5, label: 'Senzor tensiune baterie', hint: 'Măsurarea tensiunii de pachet.' },
  { bit: 6, label: 'Senzor curent baterie', hint: 'Măsurarea curentului de pachet.' },
  { bit: 7, label: 'Referință zero curent baterie', hint: 'Calibrarea de zero a curentului de pachet.' },
  { bit: 8, label: 'Referință zero curent motor', hint: 'Calibrarea de zero a curentului de motor.' },
  { bit: 9, label: 'Poziție accelerație', hint: 'Semnalul de la pedala de accelerație.' },
  { bit: 11, label: 'Senzor tensiune controller', hint: 'Linia de alimentare de 12 V.' },
  { bit: 16, label: 'Sistem de putere', hint: 'Eroare pe etajul de putere.' },
  { bit: 17, label: 'Supracurent', hint: 'Curentul a depășit limita admisă.' },
  { bit: 19, label: 'Supratensiune', hint: 'Tensiunea a depășit limita admisă.' },
  { bit: 23, label: 'Limită de curent atinsă', hint: 'Controllerul limitează activ curentul.' },
  { bit: 26, label: 'Sistem motor', hint: 'Eroare raportată de partea de motor.' },
  { bit: 27, label: 'Motor blocat', hint: 'Comandă prezentă, dar motorul nu se rotește.' },
  { bit: 28, label: 'Scurtcircuit senzor Hall', hint: 'Senzorii de poziție sunt în scurt.' },
  { bit: 29, label: 'Senzor Hall deconectat', hint: 'Fir întrerupt spre senzorii de poziție.' },
] as const

export function FaultPanel() {
  const { value, fresh } = useSignal('motor_fault_code')

  if (!fresh || value === null) {
    return (
      <p className="text-sm text-zinc-500" data-testid="fault-unavailable">
        Controllerul nu raportează starea de eroare.
      </p>
    )
  }

  // `>>>` și nu `>>`: bitul 31 ar transforma masca într-un număr negativ, iar
  // toate testele de mai jos ar da rezultate greșite pe biții de sus.
  const mask = value >>> 0
  const active = MITSUBA_FAULTS.filter((fault) => (mask & (1 << fault.bit)) !== 0)

  if (active.length === 0) {
    return (
      <p
        className="flex items-center gap-2 text-sm text-emerald-300"
        data-testid="fault-none"
      >
        <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
        Fără erori raportate de controller.
      </p>
    )
  }

  return (
    <ul className="space-y-2" data-testid="fault-list">
      {active.map((fault) => (
        <li
          key={fault.bit}
          className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-500/5 px-3 py-2"
          data-fault-bit={fault.bit}
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-rose-300"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-rose-200">{fault.label}</p>
            <p className="text-xs text-zinc-400">{fault.hint}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
