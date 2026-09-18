import { describe, expect, it } from 'vitest'
import {
  AIR_DENSITY_KG_M3,
  GRAVITY_MS2,
  VEHICLE,
  aeroDragW,
  aeroSharePct,
  cRate,
  counterDelta,
  drivetrainEfficiencyPct,
  economicSpeedKph,
  efficiencyKmPerKwh,
  ema,
  gradePowerW,
  integrateWh,
  linearSlope,
  mean,
  netPowerW,
  packInternalResistanceOhm,
  packPowerW,
  percentile,
  projectedSocPct,
  rangeKm,
  ratePerMinute,
  regenRatioPct,
  remainingEnergyWh,
  roadLoadW,
  rollingResistanceW,
  rpmFromSpeedKph,
  smoothnessScore,
  speedKphFromRpm,
  solarFractionPct,
  specificConsumptionWhPerKm,
  stdDev,
  thermalHeadroomPct,
  timeToEmptyS,
  timeToThresholdS,
  wheelCircumferenceM,
} from './telemetry-math'

/**
 * Valorile așteptate sunt derivate independent de implementare: fie din
 * aritmetică elementară pe cifre alese rotund, fie dintr-o formă închisă
 * echivalentă, fie printr-o proprietate a rezultatului (un minim chiar este
 * mai mic decât vecinii lui). Nu se copiază niciun număr produs de cod.
 */

describe('consum și eficiență', () => {
  it('1000 Wh pe 50 km înseamnă 20 Wh/km', () => {
    expect(specificConsumptionWhPerKm(1000, 50)).toBe(20)
  })

  it('50 km cu 1 kWh înseamnă 50 km/kWh', () => {
    expect(efficiencyKmPerKwh(50, 1000)).toBe(50)
  })

  it('fără distanță parcursă nu există consum specific — și nu este zero', () => {
    expect(specificConsumptionWhPerKm(1000, 0)).toBeNull()
    expect(specificConsumptionWhPerKm(0, 0)).toBeNull()
    expect(efficiencyKmPerKwh(10, 0)).toBeNull()
  })

  it('un consum real de zero rămâne zero, nu devine „fără date”', () => {
    expect(specificConsumptionWhPerKm(0, 12)).toBe(0)
  })

  it('bilanțul de putere este aportul minus consumul', () => {
    expect(netPowerW(900, 1400)).toBe(-500)
    expect(netPowerW(1400, 900)).toBe(500)
  })

  it('150 Wh recuperați din 1000 consumați înseamnă 15 %', () => {
    expect(regenRatioPct(150, 1000)).toBe(15)
    expect(solarFractionPct(800, 1000)).toBe(80)
  })

  it('randamentul lanțului electric are sens doar în tracțiune', () => {
    expect(drivetrainEfficiencyPct(900, 1000)).toBe(90)
    expect(drivetrainEfficiencyPct(-400, -500)).toBeNull()
    expect(drivetrainEfficiencyPct(900, 0)).toBeNull()
  })

  it('numitorul este magistrala, nu pachetul — altfel iese peste 100 %', () => {
    // Motorul trage 3700 W, bateria dă 2770 W, panourile 930 W.
    // Raportat la baterie ar ieși 134 %, adică imposibil.
    const bateria = 2770
    const solar = 930
    const motor = 3700

    expect(drivetrainEfficiencyPct(motor, bateria + solar)).toBeCloseTo(100, 0)
    expect(drivetrainEfficiencyPct(motor, bateria)).toBeNull()
  })

  it('o valoare imposibilă fizic nu se afișează ca măsurătoare', () => {
    // Peste 110 % nu este randament, ci un semnal scalat greșit.
    expect(drivetrainEfficiencyPct(2000, 1000)).toBeNull()
    expect(drivetrainEfficiencyPct(1090, 1000)).toBeCloseTo(109, 6)
  })
})

describe('baterie', () => {
  it('50 % dintr-un pachet de 5000 Wh înseamnă 2500 Wh', () => {
    expect(remainingEnergyWh(50, 5000)).toBe(2500)
  })

  it('o stare de încărcare imposibilă nu produce o energie', () => {
    expect(remainingEnergyWh(140, 5000)).toBeNull()
    expect(remainingEnergyWh(-1, 5000)).toBeNull()
  })

  it('2500 Wh la 20 Wh/km înseamnă 125 km', () => {
    expect(rangeKm(2500, 20)).toBe(125)
  })

  it('2500 Wh la un consum net de 1250 W se golesc în două ore', () => {
    expect(timeToEmptyS(2500, 1250)).toBe(7200)
  })

  it('cu bilanț pozitiv pachetul nu se golește', () => {
    expect(timeToEmptyS(2500, -300)).toBeNull()
    expect(timeToEmptyS(2500, 0)).toBeNull()
  })

  it('puterea din tensiune și curent', () => {
    expect(packPowerW(100, 20)).toBe(2000)
    expect(packPowerW(100, -20)).toBe(-2000)
  })

  it('un curent egal cu capacitatea înseamnă 1 C', () => {
    expect(cRate(45, 45)).toBe(1)
    expect(cRate(-90, 45)).toBe(2)
  })

  it('rezistența internă iese din panta tensiunii față de curent', () => {
    // U = 120 − 0,05 · I, deci R = 0,05 Ω.
    const samples = Array.from({ length: 20 }, (_, index) => {
      const currentA = index * 3
      return { currentA, voltageV: 120 - 0.05 * currentA }
    })
    expect(packInternalResistanceOhm(samples)).toBeCloseTo(0.05, 6)
  })

  it('fără variație de curent nu se poate estima rezistența', () => {
    const flat = Array.from({ length: 20 }, () => ({
      currentA: 30,
      voltageV: 118,
    }))
    expect(packInternalResistanceOhm(flat)).toBeNull()
    expect(packInternalResistanceOhm([])).toBeNull()
  })

  it('proiecția stării de încărcare rămâne între 0 și 100', () => {
    expect(projectedSocPct(60, -0.5, 30)).toBe(45)
    expect(projectedSocPct(10, -1, 30)).toBe(0)
    expect(projectedSocPct(95, 1, 30)).toBe(100)
  })
})

describe('rezistențe la înaintare', () => {
  const speedMs = 10

  it('rezistența la rulare este Crr · m · g · v', () => {
    const expected =
      VEHICLE.rollingResistance * VEHICLE.massKg * GRAVITY_MS2 * speedMs
    expect(rollingResistanceW(speedMs)).toBeCloseTo(expected, 9)
    // Verificare aritmetică independentă: 0,006 · 200 · 9,80665 · 10.
    expect(rollingResistanceW(speedMs)).toBeCloseTo(117.6798, 4)
  })

  it('rezistența aerodinamică este ½ · ρ · CdA · v³', () => {
    // 0,5 · 1,2 · 0,12 · 1000 = 72 W.
    expect(aeroDragW(speedMs)).toBeCloseTo(72, 9)
  })

  it('puterea aerodinamică crește cu cubul vitezei', () => {
    const single = aeroDragW(10) as number
    const double = aeroDragW(20) as number
    expect(double / single).toBeCloseTo(8, 9)
  })

  it('puterea de pantă folosește sinusul unghiului, nu panta însăși', () => {
    const grade = 0.05
    // sin(arctan(x)) = x / √(1 + x²) — formă închisă echivalentă.
    const expected =
      (VEHICLE.massKg * GRAVITY_MS2 * speedMs * grade) /
      Math.sqrt(1 + grade * grade)
    expect(gradePowerW(speedMs, grade)).toBeCloseTo(expected, 9)
  })

  it('la coborâre puterea de pantă este negativă', () => {
    expect(gradePowerW(speedMs, -0.05) as number).toBeLessThan(0)
  })

  it('rezistența totală adaugă randamentul și consumul electronicii', () => {
    const mechanical =
      (rollingResistanceW(speedMs) as number) + (aeroDragW(speedMs) as number)
    const expected =
      mechanical / VEHICLE.drivetrainEfficiency + VEHICLE.auxiliaryLoadW
    expect(roadLoadW(speedMs, 0)).toBeCloseTo(expected, 9)
  })

  it('viteza economică chiar minimizează energia pe kilometru', () => {
    const optimal = economicSpeedKph() as number
    expect(optimal).toBeGreaterThan(0)

    // Energia pe metru scoasă din pachet: (Crr·m·g + ½ρCdA·v²)/η + P_aux/v —
    // aceeași împărțire la randament ca în `roadLoadW`. Dacă viteza întoarsă
    // este minimul, orice viteză vecină trebuie să coste mai mult.
    const energyPerMeter = (kph: number) => {
      const v = kph / 3.6
      return (
        (VEHICLE.rollingResistance * VEHICLE.massKg * GRAVITY_MS2 +
          0.5 * AIR_DENSITY_KG_M3 * VEHICLE.dragArea * v * v) /
          VEHICLE.drivetrainEfficiency +
        VEHICLE.auxiliaryLoadW / v
      )
    }

    const best = energyPerMeter(optimal)
    expect(energyPerMeter(optimal - 3)).toBeGreaterThan(best)
    expect(energyPerMeter(optimal + 3)).toBeGreaterThan(best)
  })

  it('ponderea aerodinamică crește cu viteza', () => {
    const slow = aeroSharePct(8) as number
    const fast = aeroSharePct(25) as number
    expect(fast).toBeGreaterThan(slow)
    expect(fast).toBeLessThanOrEqual(100)
  })
})

describe('viteză din turație', () => {
  it('roata are 548 mm diametru și circumferința π · 0,548 = 1,7216 m', () => {
    expect(VEHICLE.wheelDiameterM).toBe(0.548)
    expect(VEHICLE.gearRatio).toBe(1)
    expect(wheelCircumferenceM()).toBeCloseTo(1.7216, 4)
  })

  it('60 rpm este o rotație pe secundă: 1,7216 m/s, adică 6,198 km/h', () => {
    expect(speedKphFromRpm(60)).toBeCloseTo(1.7216 * 3.6, 3)
  })

  it('1000 rpm înseamnă 103,3 km/h — 0,1033 km/h pe fiecare rpm', () => {
    // 1000 rot/min · 1,7216 m = 1721,6 m/min = 103 295 m/h.
    expect(speedKphFromRpm(1000)).toBeCloseTo(103.3, 1)
    expect(speedKphFromRpm(1)).toBeCloseTo(0.1033, 4)
  })

  it('turația negativă (marșarier) dă aceeași viteză la sol', () => {
    expect(speedKphFromRpm(-500)).toBeCloseTo(speedKphFromRpm(500) as number, 9)
  })

  it('zero rpm este o mașină oprită, nu „fără date”', () => {
    expect(speedKphFromRpm(0)).toBe(0)
  })

  it('cu transmisie 2:1 roata face jumătate din turele motorului', () => {
    const geared = { ...VEHICLE, gearRatio: 2 }
    expect(speedKphFromRpm(1000, geared)).toBeCloseTo(
      (speedKphFromRpm(1000) as number) / 2,
      9,
    )
  })

  it('o roată mai mare merge mai repede la aceeași turație', () => {
    const bigger = { ...VEHICLE, wheelDiameterM: 0.548 * 1.1 }
    expect(speedKphFromRpm(800, bigger)).toBeCloseTo(
      (speedKphFromRpm(800) as number) * 1.1,
      9,
    )
  })

  it('formula inversă închide cercul: rpm → km/h → rpm', () => {
    expect(rpmFromSpeedKph(speedKphFromRpm(837) as number)).toBeCloseTo(837, 9)
    // 44 km/h = 733,3 m/min; împărțit la 1,7216 m dă 426 rpm.
    expect(rpmFromSpeedKph(44)).toBeCloseTo(426, 0)
  })

  it('fără roată sau cu transmisie absurdă nu există viteză', () => {
    expect(speedKphFromRpm(500, { ...VEHICLE, wheelDiameterM: 0 })).toBeNull()
    expect(speedKphFromRpm(500, { ...VEHICLE, gearRatio: 0 })).toBeNull()
    expect(wheelCircumferenceM({ ...VEHICLE, wheelDiameterM: -1 })).toBeNull()
    expect(rpmFromSpeedKph(-10)).toBeNull()
  })
})

describe('statistică de serie', () => {
  it('media ignoră valorile care nu sunt numere finite', () => {
    expect(mean([2, 4, 6])).toBe(4)
    expect(mean([2, Number.NaN, 6])).toBe(4)
    expect(mean([])).toBeNull()
  })

  it('abaterea standard de eșantion', () => {
    // Suma pătratelor abaterilor este 32, împărțită la n − 1 = 7.
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 9)
    expect(stdDev([3])).toBeNull()
  })

  it('percentila interpolează liniar între valorile vecine', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4], 1)).toBe(4)
    expect(percentile([], 0.5)).toBeNull()
  })

  it('media exponențială pornește de la prima valoare', () => {
    expect(ema(null, 10, 0.5)).toBe(10)
    expect(ema(10, 20, 0.5)).toBe(15)
    expect(ema(10, null, 0.5)).toBe(10)
  })

  it('panta unei drepte y = 3x + 1 este 3', () => {
    expect(
      linearSlope([
        [0, 1],
        [1, 4],
        [2, 7],
        [3, 10],
      ]),
    ).toBeCloseTo(3, 9)
  })

  it('rata pe minut convertește panta din milisecunde', () => {
    // +2 unități la fiecare secundă înseamnă +120 pe minut.
    const points: [number, number][] = [
      [0, 0],
      [1000, 2],
      [2000, 4],
      [3000, 6],
    ]
    expect(ratePerMinute(points)).toBeCloseTo(120, 9)
  })

  it('integrarea puterii: 3600 W timp de o secundă înseamnă 1 Wh', () => {
    expect(
      integrateWh([
        [0, 3600],
        [1000, 3600],
      ]),
    ).toBeCloseTo(1, 9)
  })

  it('integrarea folosește trapezul, nu dreptunghiul', () => {
    // Rampă de la 0 la 7200 W într-o secundă: aria este jumătate din maxim.
    expect(
      integrateWh([
        [0, 0],
        [1000, 7200],
      ]),
    ).toBeCloseTo(1, 9)
  })

  it('un contor care scade înseamnă repornire, nu energie negativă', () => {
    expect(counterDelta(10, 15)).toBe(5)
    expect(counterDelta(15, 3)).toBeNull()
    expect(counterDelta(null, 15)).toBeNull()
  })
})

describe('indicatori de conducere', () => {
  it('o pedală constantă primește scorul maxim', () => {
    expect(smoothnessScore([40, 40, 40, 40, 40, 40])).toBe(100)
  })

  it('o pedală care sare între extreme primește un scor mic', () => {
    const nervous = [0, 100, 0, 100, 0, 100, 0, 100]
    expect(smoothnessScore(nervous)).toBe(0)
  })

  it('sub patru eșantioane scorul nu se poate calcula', () => {
    expect(smoothnessScore([10, 20])).toBeNull()
  })

  it('spațiul termic este 100 % la avertizare și 0 % la critic', () => {
    expect(thermalHeadroomPct(90, 90, 110)).toBe(100)
    expect(thermalHeadroomPct(100, 90, 110)).toBe(50)
    expect(thermalHeadroomPct(115, 90, 110)).toBe(0)
  })

  it('timpul până la prag: 20 °C de urcat cu 5 °C/min înseamnă 240 s', () => {
    expect(timeToThresholdS(90, 110, 5)).toBe(240)
  })

  it('o temperatură care scade nu atinge pragul de sus', () => {
    expect(timeToThresholdS(90, 110, -2)).toBeNull()
    expect(timeToThresholdS(90, 110, 0)).toBeNull()
  })
})

describe('robustețe la date lipsă', () => {
  it('nicio formulă nu inventează un rezultat din null sau NaN', () => {
    const results = [
      specificConsumptionWhPerKm(null, 10),
      efficiencyKmPerKwh(null, 10),
      netPowerW(null, 10),
      regenRatioPct(null, 10),
      solarFractionPct(10, null),
      drivetrainEfficiencyPct(null, 10),
      remainingEnergyWh(null),
      rangeKm(null, 10),
      timeToEmptyS(null, 10),
      packPowerW(Number.NaN, 10),
      cRate(null),
      rollingResistanceW(null),
      aeroDragW(Number.NaN),
      gradePowerW(10, null),
      roadLoadW(null, 0),
      projectedSocPct(null, 1, 30),
      thermalHeadroomPct(null, 90, 110),
      timeToThresholdS(90, null, 5),
      ratePerMinute([]),
      integrateWh([[0, 10]]),
      speedKphFromRpm(null),
      rpmFromSpeedKph(Number.NaN),
    ]

    for (const result of results) expect(result).toBeNull()
  })
})
