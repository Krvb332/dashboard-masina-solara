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
 *
 * Tabelul stă într-un modul separat de panou pentru că îl citesc două lucruri:
 * panoul din pagina „Sistem" și colectorul de erori din `hooks/useErrorLog.ts`.
 */

export type Fault = {
  bit: number
  label: string
  hint: string
}

export const MITSUBA_FAULTS: readonly Fault[] = [
  {
    bit: 0,
    label: 'Senzor analogic',
    hint: 'Eroare pe intrarea analog-digitală.',
  },
  {
    bit: 1,
    label: 'Senzor curent fază U',
    hint: 'Măsurarea curentului pe faza U.',
  },
  {
    bit: 2,
    label: 'Senzor curent fază W',
    hint: 'Măsurarea curentului pe faza W.',
  },
  {
    bit: 3,
    label: 'Termistor FET',
    hint: 'Senzorul de temperatură al controllerului.',
  },
  {
    bit: 5,
    label: 'Senzor tensiune baterie',
    hint: 'Măsurarea tensiunii de pachet.',
  },
  {
    bit: 6,
    label: 'Senzor curent baterie',
    hint: 'Măsurarea curentului de pachet.',
  },
  {
    bit: 7,
    label: 'Referință zero curent baterie',
    hint: 'Calibrarea de zero a curentului de pachet.',
  },
  {
    bit: 8,
    label: 'Referință zero curent motor',
    hint: 'Calibrarea de zero a curentului de motor.',
  },
  {
    bit: 9,
    label: 'Poziție accelerație',
    hint: 'Semnalul de la pedala de accelerație.',
  },
  {
    bit: 11,
    label: 'Senzor tensiune controller',
    hint: 'Linia de alimentare de 12 V.',
  },
  { bit: 16, label: 'Sistem de putere', hint: 'Eroare pe etajul de putere.' },
  { bit: 17, label: 'Supracurent', hint: 'Curentul a depășit limita admisă.' },
  {
    bit: 19,
    label: 'Supratensiune',
    hint: 'Tensiunea a depășit limita admisă.',
  },
  {
    bit: 23,
    label: 'Limită de curent atinsă',
    hint: 'Controllerul limitează activ curentul.',
  },
  {
    bit: 26,
    label: 'Sistem motor',
    hint: 'Eroare raportată de partea de motor.',
  },
  {
    bit: 27,
    label: 'Motor blocat',
    hint: 'Comandă prezentă, dar motorul nu se rotește.',
  },
  {
    bit: 28,
    label: 'Scurtcircuit senzor Hall',
    hint: 'Senzorii de poziție sunt în scurt.',
  },
  {
    bit: 29,
    label: 'Senzor Hall deconectat',
    hint: 'Fir întrerupt spre senzorii de poziție.',
  },
] as const

/**
 * Biții activi dintr-o mască.
 *
 * `>>>` și nu `>>`: bitul 31 ar transforma masca într-un număr negativ, iar
 * testele pe biții de sus ar da rezultate greșite.
 */
export function activeFaults(mask: number): Fault[] {
  const bits = mask >>> 0
  return MITSUBA_FAULTS.filter((fault) => (bits & (1 << fault.bit)) !== 0)
}
