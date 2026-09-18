/**
 * Formulele pe care se sprijină statisticile dashboardului.
 *
 * Tot ce se calculează din telemetrie trece pe aici, ca funcții pure: se pot
 * testa fără server, fără WebSocket și fără React, iar o formulă greșită se
 * vede într-un test, nu într-o decizie de strategie luată greșit în boxă.
 *
 * ## Regula de aur a modulului
 *
 * O funcție întoarce `null` când nu poate răspunde, **niciodată `0`**. Zero este
 * un rezultat: „consum zero" înseamnă că mașina chiar nu consumă. Lipsa datelor
 * nu este un rezultat, iar dacă ar fi codificată tot ca `0` ar contamina orice
 * medie, procent sau proiecție calculată la finalul cursei — exact ce trebuie
 * evitat. Acumulatorul din `lib/analytics.ts` se bazează pe această convenție.
 *
 * ## Constante fizice și parametrii vehiculului
 *
 * Valorile implicite descriu o mașină solară de clasă Cruiser/Challenger și
 * sunt aceleași cu cele din simulator (`server/simulator/simulate.py`), ca
 * cifrele afișate în dezvoltare să fie comparabile cu cele din pitlane. Se
 * suprascriu dintr-un singur loc: `VEHICLE`.
 */

export const GRAVITY_MS2 = 9.80665
export const AIR_DENSITY_KG_M3 = 1.2

/** Parametrii mașinii, folosiți de modelele de rezistență la înaintare. */
export type VehicleParameters = {
  /** Masa totală, cu pilot, în kg. */
  massKg: number
  /** Coeficientul de rezistență la rulare (adimensional). */
  rollingResistance: number
  /** Produsul Cd × A, în m². */
  dragArea: number
  /** Randamentul lanțului de tracțiune, între 0 și 1. */
  drivetrainEfficiency: number
  /** Energia nominală a pachetului, în Wh. */
  packEnergyWh: number
  /** Capacitatea nominală a pachetului, în Ah. */
  packCapacityAh: number
  /** Consumul constant al electronicii de bord, în W. */
  auxiliaryLoadW: number
  /**
   * Diametrul exterior al roții motoare, în m — anvelopa umflată, așa cum
   * rulează. Din el se deduce viteza la sol din turația motorului.
   */
  wheelDiameterM: number
  /**
   * Câte rotații face motorul pentru o rotație a roții. Motorul din roată
   * (Mitsuba M2096) nu are transmisie, deci 1: o rotație a lui este o rotație
   * a roții.
   */
  gearRatio: number
}

export const VEHICLE: VehicleParameters = {
  massKg: 280,
  rollingResistance: 0.006,
  dragArea: 0.12,
  drivetrainEfficiency: 0.92,
  packEnergyWh: 5000,
  packCapacityAh: 45,
  auxiliaryLoadW: 40,
  wheelDiameterM: 0.548,
  gearRatio: 1,
}

const SECONDS_PER_HOUR = 3600
const MINUTES_PER_HOUR = 60
const METERS_PER_KM = 1000

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

/** Toate argumentele sunt numere finite. Un `NaN` strecurat oprește calculul. */
function allFinite(...values: (number | null | undefined)[]): boolean {
  return values.every(finite)
}

// --- consum și eficiență ---------------------------------------------------

/**
 * Consumul specific, în Wh/km — indicatorul principal de eficiență al unei
 * mașini solare. Se compară direct cu bugetul de energie al cursei: dacă
 * traseul mai are 120 km și în pachet mai sunt 2400 Wh, ținta este 20 Wh/km.
 */
export function specificConsumptionWhPerKm(
  energyWh: number | null,
  distanceKm: number | null,
): number | null {
  if (!allFinite(energyWh, distanceKm)) return null
  if ((distanceKm as number) <= 0) return null
  return (energyWh as number) / (distanceKm as number)
}

/** Inversul consumului specific, în km/kWh — mai intuitiv pentru autonomie. */
export function efficiencyKmPerKwh(
  distanceKm: number | null,
  energyWh: number | null,
): number | null {
  if (!allFinite(distanceKm, energyWh)) return null
  if ((energyWh as number) <= 0) return null
  return (distanceKm as number) / ((energyWh as number) / 1000)
}

/**
 * Bilanțul de putere: cât intră de la panouri minus cât cere consumatorul.
 * Pozitiv înseamnă că pachetul se încarcă în timp ce mașina merge.
 */
export function netPowerW(
  solarW: number | null,
  loadW: number | null,
): number | null {
  if (!allFinite(solarW, loadW)) return null
  return (solarW as number) - (loadW as number)
}

/** Cât din energia consumată a fost recuperată prin frâna regenerativă, în %. */
export function regenRatioPct(
  regenWh: number | null,
  consumedWh: number | null,
): number | null {
  if (!allFinite(regenWh, consumedWh)) return null
  if ((consumedWh as number) <= 0) return null
  return ((regenWh as number) / (consumedWh as number)) * 100
}

/** Cât din energia consumată a fost acoperită de panouri, în %. */
export function solarFractionPct(
  solarWh: number | null,
  consumedWh: number | null,
): number | null {
  if (!allFinite(solarWh, consumedWh)) return null
  if ((consumedWh as number) <= 0) return null
  return ((solarWh as number) / (consumedWh as number)) * 100
}

/**
 * Cât din puterea disponibilă pe magistrală ajunge la motor, în procente.
 *
 * Numitorul este **puterea de pe magistrală**, nu cea scoasă din pachet:
 * `P_magistrală = P_baterie + P_solar`. Panourile alimentează direct
 * magistrala, deci într-o zi însorită bateria dă mai puțin decât consumă
 * motorul — raportat la ea, „randamentul" ar depăși 100 %, ceea ce ar fi
 * imposibil fizic și ar semnala o defecțiune inexistentă.
 *
 * Restul până la 100 % este consumul electronicii de bord plus pierderile pe
 * cabluri și în invertor. Sub ~80 % în regim staționar merită căutat: conectori
 * calzi, cabluri subdimensionate, invertor la temperatură.
 */
export function drivetrainEfficiencyPct(
  motorW: number | null,
  busW: number | null,
): number | null {
  if (!allFinite(motorW, busW)) return null
  // Are sens doar în tracțiune; la regenerare sensul puterii se inversează, iar
  // raportul ar da un număr fără interpretare fizică.
  if ((busW as number) <= 0 || (motorW as number) <= 0) return null

  const ratio = ((motorW as number) / (busW as number)) * 100
  // Peste 110 % nu este un randament, ci o nepotrivire între semnale: unul
  // dintre ele este scalat greșit. Panoul „Verificarea mapării semnalelor" este
  // locul care o diagnostichează; aici nu afișăm o cifră imposibilă ca și cum
  // ar fi o măsurătoare.
  return ratio > 110 ? null : ratio
}

// --- baterie ---------------------------------------------------------------

/** Energia rămasă în pachet, estimată din starea de încărcare. */
export function remainingEnergyWh(
  socPct: number | null,
  packEnergyWh = VEHICLE.packEnergyWh,
): number | null {
  if (!allFinite(socPct, packEnergyWh)) return null
  if ((socPct as number) < 0 || (socPct as number) > 100) return null
  return ((socPct as number) / 100) * packEnergyWh
}

/** Câți km mai poți parcurge cu energia rămasă, la consumul specific dat. */
export function rangeKm(
  remainingWh: number | null,
  whPerKm: number | null,
): number | null {
  if (!allFinite(remainingWh, whPerKm)) return null
  if ((whPerKm as number) <= 0) return null
  return (remainingWh as number) / (whPerKm as number)
}

/**
 * În cât timp se golește pachetul la consumul net actual, în secunde.
 * Un consum net negativ (mai mult soare decât consum) nu golește nimic.
 */
export function timeToEmptyS(
  remainingWh: number | null,
  netDrawW: number | null,
): number | null {
  if (!allFinite(remainingWh, netDrawW)) return null
  if ((netDrawW as number) <= 0) return null
  return ((remainingWh as number) / (netDrawW as number)) * SECONDS_PER_HOUR
}

/** Puterea calculată din tensiune și curent, pentru verificarea încrucișată. */
export function packPowerW(
  voltageV: number | null,
  currentA: number | null,
): number | null {
  if (!allFinite(voltageV, currentA)) return null
  return (voltageV as number) * (currentA as number)
}

/**
 * Rata de curent raportată la capacitate (C-rate). 1 C înseamnă golirea
 * pachetului într-o oră; peste 2 C celulele de mașină solară se încălzesc
 * vizibil.
 */
export function cRate(
  currentA: number | null,
  capacityAh = VEHICLE.packCapacityAh,
): number | null {
  if (!allFinite(currentA, capacityAh)) return null
  if (capacityAh <= 0) return null
  return Math.abs(currentA as number) / capacityAh
}

/**
 * Rezistența internă a pachetului, estimată prin regresie liniară a tensiunii
 * față de curent: `U = U0 − R·I`, deci `R = −panta`.
 *
 * Este singura metodă disponibilă fără o descărcare de test: o creștere a lui R
 * în timpul cursei arată o celulă sau un conector care se degradează.
 */
export function packInternalResistanceOhm(
  samples: { currentA: number; voltageV: number }[],
): number | null {
  const usable = samples.filter(
    (sample) => finite(sample.currentA) && finite(sample.voltageV),
  )
  if (usable.length < 8) return null

  const slope = linearSlope(
    usable.map((sample) => [sample.currentA, sample.voltageV]),
  )
  if (slope === null) return null

  const resistance = -slope
  // O rezistență negativă sau absurdă înseamnă că variația de curent a fost
  // prea mică pentru o estimare: mai bine nimic decât o cifră inventată.
  if (resistance <= 0 || resistance > 2) return null
  return resistance
}

/** Starea de încărcare proiectată peste `minutes`, la rata actuală. */
export function projectedSocPct(
  socPct: number | null,
  ratePctPerMin: number | null,
  minutes: number,
): number | null {
  if (!allFinite(socPct, ratePctPerMin, minutes)) return null
  const projected = (socPct as number) + (ratePctPerMin as number) * minutes
  return Math.max(0, Math.min(100, projected))
}

// --- rezistențe la înaintare ----------------------------------------------

/** Puterea consumată de rezistența la rulare: `P = Crr · m · g · v`. */
export function rollingResistanceW(
  speedMs: number | null,
  vehicle: VehicleParameters = VEHICLE,
): number | null {
  if (!finite(speedMs) || speedMs < 0) return null
  return vehicle.rollingResistance * vehicle.massKg * GRAVITY_MS2 * speedMs
}

/**
 * Puterea consumată de rezistența aerodinamică: `P = ½ · ρ · Cd·A · v³`.
 *
 * Cubul vitezei este motivul pentru care „mai încet cu 5 km/h" este cel mai
 * ieftin câștig de energie dintr-o cursă solară — și mesajul pe care panoul de
 * recomandări îl dă pilotului.
 */
export function aeroDragW(
  speedMs: number | null,
  vehicle: VehicleParameters = VEHICLE,
  airDensity = AIR_DENSITY_KG_M3,
): number | null {
  if (!finite(speedMs) || speedMs < 0) return null
  return 0.5 * airDensity * vehicle.dragArea * speedMs ** 3
}

/**
 * Puterea cerută de pantă: `P = m · g · v · sin(arctan(panta))`.
 * Negativă la coborâre — acolo se recuperează energie.
 */
export function gradePowerW(
  speedMs: number | null,
  gradeFraction: number | null,
  vehicle: VehicleParameters = VEHICLE,
): number | null {
  if (!allFinite(speedMs, gradeFraction)) return null
  const angle = Math.atan(gradeFraction as number)
  return vehicle.massKg * GRAVITY_MS2 * (speedMs as number) * Math.sin(angle)
}

/** Suma rezistențelor plus consumul electronicii: puterea teoretic necesară. */
export function roadLoadW(
  speedMs: number | null,
  gradeFraction: number | null = 0,
  vehicle: VehicleParameters = VEHICLE,
): number | null {
  const rolling = rollingResistanceW(speedMs, vehicle)
  const aero = aeroDragW(speedMs, vehicle)
  const grade = gradePowerW(speedMs, gradeFraction ?? 0, vehicle)
  if (rolling === null || aero === null || grade === null) return null

  const mechanical = rolling + aero + grade
  return mechanical / vehicle.drivetrainEfficiency + vehicle.auxiliaryLoadW
}

/**
 * Viteza la care energia pe kilometru este minimă.
 *
 * Energia pe metru este `Crr·m·g + ½·ρ·CdA·v² + P_aux/v`. Derivata în raport cu
 * `v` se anulează la `v = (P_aux / (ρ · CdA))^(1/3)`: sub această viteză
 * electronica de bord consumă prea mult timp, peste ea aerodinamica devine
 * dominantă. Este viteza-țintă pentru un tur economic.
 */
export function economicSpeedKph(
  vehicle: VehicleParameters = VEHICLE,
  airDensity = AIR_DENSITY_KG_M3,
): number | null {
  const denominator = airDensity * vehicle.dragArea
  if (denominator <= 0 || vehicle.auxiliaryLoadW <= 0) return null
  return Math.cbrt(vehicle.auxiliaryLoadW / denominator) * 3.6
}

/**
 * Cât din puterea de rulare se duce în aerodinamică, în procente.
 * Peste ~60 % înseamnă că viteza, nu masa, este problema.
 */
export function aeroSharePct(speedMs: number | null): number | null {
  const rolling = rollingResistanceW(speedMs)
  const aero = aeroDragW(speedMs)
  if (rolling === null || aero === null) return null
  const total = rolling + aero
  if (total <= 0) return null
  return (aero / total) * 100
}

// --- viteză din turație ----------------------------------------------------

/** Circumferința roții, în m: `C = π · D`. */
export function wheelCircumferenceM(
  vehicle: VehicleParameters = VEHICLE,
): number | null {
  if (!finite(vehicle.wheelDiameterM) || vehicle.wheelDiameterM <= 0) {
    return null
  }
  return Math.PI * vehicle.wheelDiameterM
}

/**
 * Viteza la sol dedusă din turația motorului, în km/h.
 *
 *     v [km/h] = n [rpm] / i · π · D [m] · 60 / 1000
 *
 * `n` este turația motorului, `i` raportul de transmisie (1 la motorul din
 * roată), `D` diametrul roții. Cu D = 0,548 m circumferința este 1,7216 m,
 * deci fiecare rpm valorează 0,1033 km/h: 1000 rpm înseamnă 103,3 km/h.
 *
 * Este a doua cale către viteză, independentă de GNSS: nu depinde de fix, de
 * numărul de sateliți sau de întârzierea modulului. Când cele două nu se
 * potrivesc, fie diametrul de aici nu este cel al anvelopei montate, fie
 * receptorul GNSS raportează greșit — panoul de verificare a mapării le pune
 * față în față.
 *
 * Turația este semnată (negativă în marșarier), dar viteza la sol este o
 * mărime fără sens: întoarcem modulul. Zero rpm înseamnă chiar oprit, deci
 * rezultatul este `0`, nu `null`.
 */
export function speedKphFromRpm(
  rpm: number | null,
  vehicle: VehicleParameters = VEHICLE,
): number | null {
  const circumference = wheelCircumferenceM(vehicle)
  if (!finite(rpm) || circumference === null) return null
  if (!finite(vehicle.gearRatio) || vehicle.gearRatio <= 0) return null

  const wheelRpm = Math.abs(rpm) / vehicle.gearRatio
  return (wheelRpm * circumference * MINUTES_PER_HOUR) / METERS_PER_KM
}

/**
 * Inversul: turația motorului la o viteză dată, în rpm. Folosită de
 * generatoarele de telemetrie sintetică, ca turația și viteza pe care le
 * produc să fie coerente cu aceeași roată.
 */
export function rpmFromSpeedKph(
  speedKph: number | null,
  vehicle: VehicleParameters = VEHICLE,
): number | null {
  const circumference = wheelCircumferenceM(vehicle)
  if (!finite(speedKph) || speedKph < 0 || circumference === null) return null
  if (!finite(vehicle.gearRatio) || vehicle.gearRatio <= 0) return null

  const metersPerMinute = (speedKph * METERS_PER_KM) / MINUTES_PER_HOUR
  return (metersPerMinute / circumference) * vehicle.gearRatio
}

// --- statistică de serie ---------------------------------------------------

export function mean(values: number[]): number | null {
  const usable = values.filter(finite)
  if (usable.length === 0) return null
  return usable.reduce((sum, value) => sum + value, 0) / usable.length
}

export function stdDev(values: number[]): number | null {
  const usable = values.filter(finite)
  if (usable.length < 2) return null
  const average = mean(usable) as number
  const variance =
    usable.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (usable.length - 1)
  return Math.sqrt(variance)
}

/**
 * Percentila prin interpolare liniară (metoda folosită de `numpy.percentile`).
 * P95 pe putere spune cât cere mașina în vârfuri, fără ca un singur eșantion
 * aberant să dicteze cifra.
 */
export function percentile(values: number[], fraction: number): number | null {
  const usable = values.filter(finite).sort((a, b) => a - b)
  if (usable.length === 0) return null
  if (!finite(fraction) || fraction < 0 || fraction > 1) return null
  if (usable.length === 1) return usable[0]

  const position = fraction * (usable.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return usable[lower]
  return usable[lower] + (usable[upper] - usable[lower]) * (position - lower)
}

/** Medie exponențială: netezește fără să întârzie cât o medie glisantă lungă. */
export function ema(
  previous: number | null,
  value: number | null,
  alpha: number,
): number | null {
  if (!finite(value)) return previous
  if (!finite(alpha) || alpha <= 0 || alpha > 1) return previous
  if (!finite(previous)) return value
  return (
    (previous as number) + alpha * ((value as number) - (previous as number))
  )
}

/**
 * Panta unei regresii liniare prin metoda celor mai mici pătrate.
 * Folosită pentru rata de creștere a temperaturii și pentru rezistența internă.
 */
export function linearSlope(points: [number, number][]): number | null {
  const usable = points.filter(([x, y]) => finite(x) && finite(y))
  if (usable.length < 2) return null

  const n = usable.length
  const sumX = usable.reduce((sum, [x]) => sum + x, 0)
  const sumY = usable.reduce((sum, [, y]) => sum + y, 0)
  const sumXY = usable.reduce((sum, [x, y]) => sum + x * y, 0)
  const sumXX = usable.reduce((sum, [x]) => sum + x * x, 0)

  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) return null
  return (n * sumXY - sumX * sumY) / denominator
}

/**
 * Rata de variație a unei serii în unitatea semnalului pe minut.
 * `points` are timpul în milisecunde.
 */
export function ratePerMinute(points: [number, number][]): number | null {
  const slope = linearSlope(points)
  if (slope === null) return null
  return slope * 60_000
}

/**
 * Integrarea trapezoidală a unei serii de putere, în Wh.
 *
 * Trapezul, nu dreptunghiul: la 10 Hz diferența este mică, dar la un flux care
 * pierde mesaje intervalele devin neregulate, iar aproximarea dreptunghiulară
 * ar acumula eroare sistematică pe o cursă de opt ore.
 */
export function integrateWh(points: [number, number][]): number | null {
  const usable = points.filter(([t, w]) => finite(t) && finite(w))
  if (usable.length < 2) return null

  let joules = 0
  for (let index = 1; index < usable.length; index += 1) {
    const [previousTime, previousValue] = usable[index - 1]
    const [time, value] = usable[index]
    const dt = (time - previousTime) / 1000
    if (dt <= 0) continue
    joules += ((previousValue + value) / 2) * dt
  }

  return joules / SECONDS_PER_HOUR
}

/**
 * Diferența dintre două citiri ale unui contor crescător.
 *
 * Un contor care scade înseamnă repornirea sursei, nu energie negativă: în acel
 * caz întoarcem `null`, iar acumulatorul reia numărătoarea de la noua valoare.
 * Fără regula asta, o repornire a plăcii ar scădea sute de Wh din bilanțul
 * cursei.
 */
export function counterDelta(
  previous: number | null,
  current: number | null,
): number | null {
  if (!allFinite(previous, current)) return null
  const delta = (current as number) - (previous as number)
  if (delta < 0) return null
  return delta
}

// --- indicatori de conducere ----------------------------------------------

/**
 * Cât de lin conduce pilotul, pe o scară 0–100.
 *
 * Se calculează din abaterea standard a variației accelerației între eșantioane:
 * o pedală ținută constant dă abatere mică. Contează pentru consum — fiecare
 * apăsare-eliberare plătește pierderile lanțului de tracțiune de două ori.
 */
export function smoothnessScore(throttleSamples: number[]): number | null {
  const usable = throttleSamples.filter(finite)
  if (usable.length < 4) return null

  const deltas: number[] = []
  for (let index = 1; index < usable.length; index += 1) {
    deltas.push(usable[index] - usable[index - 1])
  }

  const spread = stdDev(deltas)
  if (spread === null) return null

  // 12 % variație de la un eșantion la altul înseamnă deja o pedală nervoasă;
  // scara se saturează acolo, ca scorul să rămână citibil.
  return Math.max(0, Math.min(100, 100 - (spread / 12) * 100))
}

/**
 * Cât spațiu mai este până la pragul critic al unui semnal, în procente.
 * 100 % la pragul de avertizare, 0 % la cel critic.
 */
export function thermalHeadroomPct(
  value: number | null,
  warnAbove: number | null,
  critAbove: number | null,
): number | null {
  if (!allFinite(value, warnAbove, critAbove)) return null
  const span = (critAbove as number) - (warnAbove as number)
  if (span <= 0) return null
  const used = ((value as number) - (warnAbove as number)) / span
  return Math.max(0, Math.min(100, (1 - used) * 100))
}

/**
 * Peste cât timp un semnal atinge pragul, la rata actuală de creștere, în
 * secunde. Pentru temperaturi: „invertorul atinge 85 °C în 4 minute".
 */
export function timeToThresholdS(
  value: number | null,
  threshold: number | null,
  ratePerMin: number | null,
): number | null {
  if (!allFinite(value, threshold, ratePerMin)) return null
  const remaining = (threshold as number) - (value as number)
  const rate = ratePerMin as number
  if (rate === 0) return null
  const minutes = remaining / rate
  if (minutes <= 0) return null
  return minutes * 60
}
