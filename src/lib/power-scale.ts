/**
 * Scala de afișare a puterii de pachet.
 *
 * Până la 3,3 kW cifra afișată *este* cifra măsurată: unu la unu, fără nicio
 * corecție. Peste prag, afișarea comprimă surplusul și se apropie asimptotic
 * de 4 kW, deci vârfurile scurte de la demaraje nu mai strivesc restul
 * graficului și nu mai fac cardul să sară la valori care nu spun nimic despre
 * cum merge cursa.
 *
 * Forma curbei:
 *
 *     P_afișat = prag + span · (1 − e^(−(P − prag) / span)),  span = plafon − prag
 *
 * Panta la prag este exact 1 (racordare fără cot), scade apoi ca la un
 * logaritm, iar curba nu trece niciodată de plafon. Un logaritm pur
 * (`prag + a·ln(1 + excedent/a)`) este nemărginit și ar depăși plafonul de
 * 4 kW în jurul a 5 kW măsurați, deci nu poate respecta simultan „logaritmic"
 * și „plafon"; funcția de aici este inversa unui logaritm, adică exact curba
 * logaritmică mărginită.
 *
 * Compresia este **doar de afișare**. Toate calculele - consum, Wh/km,
 * autonomie, alarme, tonuri de culoare, verificările de coerență - lucrează pe
 * valoarea brută din telemetrie. Acolo unde cifra afișată diferă de cea
 * măsurată, componentele arată valoarea reală în tooltip, ca inginerul să nu
 * rămână niciodată fără numărul adevărat.
 */

/** Pragul de la care începe compresia, în wați. Sub el, afișarea e liniară. */
export const PACK_POWER_KNEE_W = 3300

/** Plafonul asimptotic al afișării, în wați. Curba se apropie, nu îl atinge. */
export const PACK_POWER_CEILING_W = 4000

const SPAN_W = PACK_POWER_CEILING_W - PACK_POWER_KNEE_W

/**
 * Semnalele care se afișează pe această scală: puterea netă de pachet, în
 * ambele sensuri (descărcare și încărcare).
 */
const COMPRESSED_KEYS = new Set(['battery_power_w'])

export function isCompressedPowerSignal(key: string): boolean {
  return COMPRESSED_KEYS.has(key)
}

/**
 * Valoarea de afișat pentru o putere de pachet măsurată, în wați.
 *
 * Compresia se aplică pe modul și păstrează semnul: încărcarea la −5 kW este
 * la fel de strivită ca descărcarea la +5 kW, altfel graficul ar fi simetric
 * doar pe jumătate.
 */
export function compressPackPowerW(value: number): number
export function compressPackPowerW(value: number | null): number | null
export function compressPackPowerW(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return value

  const magnitude = Math.abs(value)
  if (magnitude <= PACK_POWER_KNEE_W) return value

  const excess = magnitude - PACK_POWER_KNEE_W
  const compressed =
    PACK_POWER_KNEE_W + SPAN_W * (1 - Math.exp(-excess / SPAN_W))

  return value < 0 ? -compressed : compressed
}

/**
 * Inversa compresiei: din cifra afișată înapoi în puterea măsurată.
 *
 * Folosită de tooltipul graficului, care nu are la îndemână decât punctul deja
 * comprimat din serie. Peste plafon inversa nu mai există (informația s-a
 * pierdut), deci întoarce `Infinity` cu semnul valorii - un caz care nu apare
 * pentru date venite prin `compressPackPowerW`, fiindcă acelea rămân strict
 * sub plafon.
 */
export function expandPackPowerW(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return value

  const magnitude = Math.abs(value)
  if (magnitude <= PACK_POWER_KNEE_W) return value

  const ratio = 1 - (magnitude - PACK_POWER_KNEE_W) / SPAN_W
  const expanded =
    ratio <= 0
      ? Number.POSITIVE_INFINITY
      : PACK_POWER_KNEE_W - SPAN_W * Math.log(ratio)

  return value < 0 ? -expanded : expanded
}

/** Adevărat când afișarea chiar a schimbat cifra, adică peste prag. */
export function isPackPowerCompressed(value: number | null): boolean {
  return (
    value !== null &&
    Number.isFinite(value) &&
    Math.abs(value) > PACK_POWER_KNEE_W
  )
}
