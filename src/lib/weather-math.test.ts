import { describe, expect, it } from 'vitest'
import { VEHICLE, aeroDragW } from './telemetry-math'
import {
  WEATHER_MODEL,
  aeroPowerW,
  airDensityKgM3,
  apparentAirSpeedKph,
  cellTemperatureC,
  clearSkyGhiWM2,
  cloudTransmittance,
  dewPointC,
  dewPointSpreadC,
  effectiveApertureM2,
  estimatedGhiWM2,
  pvTemperatureFactor,
  relativeAirDensity,
  saturationVapourPressureHpa,
  solarPosition,
  solarYieldPct,
  stationPressureHpa,
  vapourPressureHpa,
  windComponents,
  windPenaltyW,
} from './weather-math'

/**
 * Fiecare verificare de mai jos se sprijină pe ceva din afara acestui cod:
 * atmosfera standard internațională, un tabel psihrometric, o identitate
 * geometrică sau chiar condiția care definește o constantă. Un test care ar
 * compara rezultatul cu o cifră copiată dintr-o rulare anterioară ar certifica
 * doar că funcția nu s-a schimbat, nu că este corectă.
 */

const ISA_SEA_LEVEL_HPA = 1013.25

describe('umiditate și densitatea aerului', () => {
  it('presiunea de saturație la 0 °C este constanta care o definește', () => {
    expect(saturationVapourPressureHpa(0)).toBeCloseTo(
      WEATHER_MODEL.MAGNUS_E0,
      6,
    )
  })

  it('crește monoton cu temperatura', () => {
    const cold = saturationVapourPressureHpa(5) as number
    const warm = saturationVapourPressureHpa(25) as number
    expect(warm).toBeGreaterThan(cold)
  })

  it('reproduce densitatea atmosferei standard: 1,225 kg/m³ la 15 °C', () => {
    const density = airDensityKgM3(15, ISA_SEA_LEVEL_HPA, 0)
    expect(density).toBeCloseTo(1.225, 3)
    expect(relativeAirDensity(density)).toBeCloseTo(1, 3)
  })

  it('reproduce densitatea aerului uscat la 0 °C din tabele: 1,2922 kg/m³', () => {
    expect(airDensityKgM3(0, ISA_SEA_LEVEL_HPA, 0)).toBeCloseTo(1.2922, 3)
  })

  it('aerul saturat la 30 °C este mai ușor decât cel uscat, ~1,146 kg/m³', () => {
    const humid = airDensityKgM3(30, ISA_SEA_LEVEL_HPA, 100) as number
    const dry = airDensityKgM3(30, ISA_SEA_LEVEL_HPA, 0) as number

    // Valoare de tabel pentru aer saturat la 30 °C și presiune standard.
    expect(humid).toBeCloseTo(1.146, 3)
    // Contraintuitiv, dar fizic: vaporii de apă sunt mai ușori decât aerul.
    expect(humid).toBeLessThan(dry)
  })

  it('fără umiditate raportată tratează aerul ca uscat, nu ca lipsă de date', () => {
    expect(airDensityKgM3(15, ISA_SEA_LEVEL_HPA, null)).toBeCloseTo(1.225, 3)
  })

  it('presiunea parțială a vaporilor la 100 % este chiar cea de saturație', () => {
    expect(vapourPressureHpa(18, 100)).toBeCloseTo(
      saturationVapourPressureHpa(18) as number,
      9,
    )
  })
})

describe('punctul de rouă', () => {
  it('la saturație este chiar temperatura aerului', () => {
    for (const temperature of [-5, 0, 12.5, 31]) {
      expect(dewPointC(temperature, 100)).toBeCloseTo(temperature, 6)
    }
  })

  it('la 20 °C și 50 % dă ~9,3 °C, valoarea din tabelul psihrometric', () => {
    expect(dewPointC(20, 50)).toBeCloseTo(9.3, 1)
  })

  it('scade odată cu umiditatea', () => {
    const humid = dewPointC(20, 80) as number
    const dry = dewPointC(20, 20) as number
    expect(dry).toBeLessThan(humid)
  })

  it('diferența față de temperatură arată riscul de ceață', () => {
    expect(dewPointSpreadC(12, 11)).toBeCloseTo(1, 6)
    expect(dewPointSpreadC(null, 11)).toBeNull()
  })
})

describe('presiunea la altitudinea circuitului', () => {
  it('la nivelul mării rămâne neschimbată', () => {
    expect(stationPressureHpa(ISA_SEA_LEVEL_HPA, 0, 15)).toBeCloseTo(
      ISA_SEA_LEVEL_HPA,
      6,
    )
  })

  it('la 1000 m reproduce presiunea atmosferei standard: 898,8 hPa', () => {
    // În atmosfera standard, la 1000 m temperatura este 8,5 °C.
    expect(stationPressureHpa(ISA_SEA_LEVEL_HPA, 1000, 8.5)).toBeCloseTo(
      898.8,
      0,
    )
  })

  it('scade cu altitudinea și trage densitatea după ea', () => {
    const jos = stationPressureHpa(ISA_SEA_LEVEL_HPA, 0, 20) as number
    const sus = stationPressureHpa(ISA_SEA_LEVEL_HPA, 800, 20) as number
    expect(sus).toBeLessThan(jos)

    const densitateJos = airDensityKgM3(20, jos, 40) as number
    const densitateSus = airDensityKgM3(20, sus, 40) as number
    expect(densitateSus).toBeLessThan(densitateJos)
  })

  it('fără altitudine cunoscută întoarce presiunea primită, nu null', () => {
    expect(stationPressureHpa(1000, null, 20)).toBe(1000)
  })
})

describe('descompunerea vântului', () => {
  it('vântul din față pe direcția de mers este integral frontal', () => {
    const components = windComponents(20, 0, 0)
    expect(components?.headwindKph).toBeCloseTo(20, 9)
    expect(components?.crosswindKph).toBeCloseTo(0, 9)
  })

  it('vântul din spate dă componentă frontală negativă', () => {
    expect(windComponents(20, 180, 0)?.headwindKph).toBeCloseTo(-20, 9)
  })

  it('vântul din dreapta este integral lateral', () => {
    const components = windComponents(20, 90, 0)
    expect(components?.headwindKph).toBeCloseTo(0, 9)
    expect(components?.crosswindKph).toBeCloseTo(20, 9)
  })

  it('păstrează modulul vectorului pentru orice unghi', () => {
    for (const from of [17, 63, 128, 241, 330]) {
      for (const heading of [0, 45, 190, 300]) {
        const components = windComponents(14.5, from, heading)
        const magnitude = Math.hypot(
          components?.headwindKph ?? 0,
          components?.crosswindKph ?? 0,
        )
        expect(magnitude).toBeCloseTo(14.5, 9)
      }
    }
  })

  it('viteza aerului este suma vitezei proprii cu vântul frontal', () => {
    expect(apparentAirSpeedKph(60, 15)).toBeCloseTo(75, 9)
    expect(apparentAirSpeedKph(60, -15)).toBeCloseTo(45, 9)
  })
})

describe('puterea aerodinamică', () => {
  const drag = VEHICLE.dragArea

  it('pe aer liniștit coincide cu modelul independent din telemetry-math', () => {
    for (const kph of [20, 45, 80]) {
      const mine = aeroPowerW(kph, kph, 1.225, drag) as number
      const theirs = aeroDragW(kph / 3.6, VEHICLE, 1.225) as number
      expect(mine).toBeCloseTo(theirs, 9)
    }
  })

  it('crește cu cubul vitezei', () => {
    const slow = aeroPowerW(30, 30, 1.225, drag) as number
    const fast = aeroPowerW(60, 60, 1.225, drag) as number
    expect(fast / slow).toBeCloseTo(8, 6)
  })

  it('este proporțională cu densitatea aerului', () => {
    const dense = aeroPowerW(50, 50, 1.3, drag) as number
    const thin = aeroPowerW(50, 50, 1.1, drag) as number
    expect(dense / thin).toBeCloseTo(1.3 / 1.1, 6)
  })

  it('devine negativă când vântul din spate întrece viteza mașinii', () => {
    const power = aeroPowerW(20, -10, 1.225, drag) as number
    expect(power).toBeLessThan(0)
  })

  it('penalizarea de vânt este nulă pe aer liniștit', () => {
    expect(windPenaltyW(55, 0, 1.225, drag)).toBeCloseTo(0, 9)
  })

  it('penalizarea este pozitivă pe vânt de față și negativă pe vânt de spate', () => {
    const contra = windPenaltyW(55, 18, 1.225, drag) as number
    const dinSpate = windPenaltyW(55, -18, 1.225, drag) as number
    expect(contra).toBeGreaterThan(0)
    expect(dinSpate).toBeLessThan(0)
    // Nesimetric: pătratul vitezei aerului favorizează pierderea față de câștig.
    expect(contra).toBeGreaterThan(Math.abs(dinSpate))
  })
})

describe('poziția soarelui', () => {
  const CLUJ = { lat: 46.7712, lon: 23.6236 }

  /** Momentul cu soarele cel mai sus dintr-o zi, căutat prin scanare. */
  function solarNoon(date: string, lat: number, lon: number) {
    let best = solarPosition(new Date(`${date}T00:00:00Z`), lat, lon)
    let bestAt = new Date(`${date}T00:00:00Z`)

    for (let minute = 1; minute < 1440; minute += 1) {
      const when = new Date(`${date}T00:00:00Z`)
      when.setUTCMinutes(minute)
      const position = solarPosition(when, lat, lon)
      if (position && best && position.elevationDeg > best.elevationDeg) {
        best = position
        bestAt = when
      }
    }

    return { position: best!, at: bestAt }
  }

  it('la amiaza solară respectă identitatea 90° − |latitudine − declinație|', () => {
    for (const date of [
      '2026-03-21',
      '2026-06-21',
      '2026-09-15',
      '2026-12-21',
    ]) {
      const { position } = solarNoon(date, CLUJ.lat, CLUJ.lon)
      const expected = 90 - Math.abs(CLUJ.lat - position.declinationDeg)
      expect(position.elevationDeg).toBeCloseTo(expected, 1)
    }
  })

  it('la echinocțiul de toamnă declinația este aproape zero', () => {
    const position = solarPosition(
      new Date('2026-09-22T12:00:00Z'),
      CLUJ.lat,
      CLUJ.lon,
    )
    expect(Math.abs(position?.declinationDeg ?? 99)).toBeLessThan(0.7)
  })

  it('la solstiții declinația atinge înclinarea axei terestre', () => {
    const vara = solarPosition(
      new Date('2026-06-21T12:00:00Z'),
      CLUJ.lat,
      CLUJ.lon,
    )
    const iarna = solarPosition(
      new Date('2026-12-21T12:00:00Z'),
      CLUJ.lat,
      CLUJ.lon,
    )
    expect(vara?.declinationDeg).toBeCloseTo(23.44, 0)
    expect(iarna?.declinationDeg).toBeCloseTo(-23.44, 0)
  })

  it('la amiaza solară soarele este la sud, în emisfera nordică', () => {
    const { position } = solarNoon('2026-09-15', CLUJ.lat, CLUJ.lon)
    expect(position.azimuthDeg).toBeCloseTo(180, 0)
    expect(Math.abs(position.hourAngleDeg)).toBeLessThan(0.5)
  })

  it('este simetrică față de amiaza solară', () => {
    const { at } = solarNoon('2026-09-15', CLUJ.lat, CLUJ.lon)

    const before = new Date(at.getTime() - 3 * 3600_000)
    const after = new Date(at.getTime() + 3 * 3600_000)
    const left = solarPosition(before, CLUJ.lat, CLUJ.lon)
    const right = solarPosition(after, CLUJ.lat, CLUJ.lon)

    expect(left?.elevationDeg).toBeCloseTo(right?.elevationDeg ?? 0, 0)
    // Azimuturile sunt oglindite față de sud.
    expect((left?.azimuthDeg ?? 0) + (right?.azimuthDeg ?? 0)).toBeCloseTo(
      360,
      0,
    )
  })

  it('pune soarele sub orizont la miezul nopții solare', () => {
    const { at } = solarNoon('2026-09-15', CLUJ.lat, CLUJ.lon)
    const midnight = new Date(at.getTime() + 12 * 3600_000)
    expect(
      solarPosition(midnight, CLUJ.lat, CLUJ.lon)?.elevationDeg,
    ).toBeLessThan(0)
  })

  it('urcă mai sus la ecuator decât la latitudinea Clujului, în aceeași zi', () => {
    const ecuator = solarNoon('2026-09-22', 0, 0).position.elevationDeg
    const cluj = solarNoon('2026-09-22', CLUJ.lat, CLUJ.lon).position
      .elevationDeg
    expect(ecuator).toBeGreaterThan(cluj)
    // La câteva zile de echinocțiu, soarele trece la un grad de zenit.
    expect(ecuator).toBeGreaterThan(89)
  })
})

describe('iradianța', () => {
  it('nu depășește constanta solară nici cu soarele la zenit', () => {
    const peak = clearSkyGhiWM2(90) as number
    expect(peak).toBeLessThan(1361)
    expect(peak).toBeGreaterThan(900)
  })

  it('este zero cu soarele sub orizont — zero real, nu lipsă de date', () => {
    expect(clearSkyGhiWM2(0)).toBe(0)
    expect(clearSkyGhiWM2(-8)).toBe(0)
  })

  it('crește monoton cu înălțimea soarelui', () => {
    let previous = -1
    for (const elevation of [5, 15, 30, 45, 60, 75, 90]) {
      const value = clearSkyGhiWM2(elevation) as number
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('cerul senin lasă totul să treacă, cel acoperit un sfert', () => {
    expect(cloudTransmittance(0)).toBeCloseTo(1, 9)
    expect(cloudTransmittance(100)).toBeCloseTo(0.25, 9)
  })

  it('nebulozitatea mică aproape nu costă nimic — de aceea relația nu e liniară', () => {
    // Exponentul 3,4 concentrează pierderea în ultima treime a nebulozității:
    // 30 % de nori iau sub 3 %, 60 % iau ~13 %, iar 90 % iau peste jumătate.
    expect(cloudTransmittance(30)).toBeGreaterThan(0.97)
    expect(cloudTransmittance(60)).toBeLessThan(0.9)
    expect(cloudTransmittance(90)).toBeLessThan(0.55)
  })

  it('combină înălțimea soarelui cu norii', () => {
    const senin = estimatedGhiWM2(60, 0) as number
    const acoperit = estimatedGhiWM2(60, 100) as number
    expect(acoperit / senin).toBeCloseTo(0.25, 6)
  })
})

describe('panourile fotovoltaice', () => {
  it('în condițiile care definesc NOCT, celula ajunge chiar la NOCT', () => {
    expect(cellTemperatureC(20, 800)).toBeCloseTo(WEATHER_MODEL.NOCT_C, 9)
  })

  it('celula este mai caldă decât aerul ori de câte ori bate soarele', () => {
    expect(cellTemperatureC(25, 950) as number).toBeGreaterThan(25)
    expect(cellTemperatureC(25, 0)).toBeCloseTo(25, 9)
  })

  it('factorul termic este 1 la temperatura de referință', () => {
    expect(pvTemperatureFactor(WEATHER_MODEL.PV_REFERENCE_C)).toBeCloseTo(1, 9)
  })

  it('pierde ~0,35 % pe grad peste referință', () => {
    expect(pvTemperatureFactor(45)).toBeCloseTo(1 - 0.0035 * 20, 9)
    expect(pvTemperatureFactor(65) as number).toBeLessThan(
      pvTemperatureFactor(45) as number,
    )
  })

  it('aria efectivă este puterea împărțită la iradianță', () => {
    expect(effectiveApertureM2(800, 1000)).toBeCloseTo(0.8, 9)
  })

  it('refuză să raporteze aria la iradianță prea mică pentru a fi informativă', () => {
    expect(effectiveApertureM2(40, 10)).toBeNull()
  })

  it('randamentul raportat la aria array-ului este un procent', () => {
    expect(solarYieldPct(500, 1000, 1)).toBeCloseTo(50, 9)
    expect(solarYieldPct(500, 1000, null)).toBeNull()
  })
})

describe('fără date, fiecare mărime rămâne null', () => {
  it('nu inventează nicio valoare când intrările lipsesc', () => {
    expect(saturationVapourPressureHpa(null)).toBeNull()
    expect(vapourPressureHpa(null, 50)).toBeNull()
    expect(vapourPressureHpa(20, null)).toBeNull()
    expect(dewPointC(null, null)).toBeNull()
    expect(stationPressureHpa(null, 400, 20)).toBeNull()
    expect(airDensityKgM3(null, 1013, 50)).toBeNull()
    expect(airDensityKgM3(20, null, 50)).toBeNull()
    expect(relativeAirDensity(null)).toBeNull()
    expect(windComponents(null, 90, 0)).toBeNull()
    expect(windComponents(10, null, 0)).toBeNull()
    expect(windComponents(10, 90, null)).toBeNull()
    expect(apparentAirSpeedKph(null, 5)).toBeNull()
    expect(apparentAirSpeedKph(50, null)).toBeNull()
    expect(aeroPowerW(null, 50, 1.2, 0.12)).toBeNull()
    expect(aeroPowerW(50, 50, null, 0.12)).toBeNull()
    expect(windPenaltyW(50, null, 1.2, 0.12)).toBeNull()
    expect(solarPosition(new Date('2026-09-15T12:00:00Z'), null, 23)).toBeNull()
    expect(clearSkyGhiWM2(null)).toBeNull()
    expect(cloudTransmittance(null)).toBeNull()
    expect(estimatedGhiWM2(null, 20)).toBeNull()
    expect(estimatedGhiWM2(40, null)).toBeNull()
    expect(cellTemperatureC(null, 800)).toBeNull()
    expect(pvTemperatureFactor(null)).toBeNull()
    expect(effectiveApertureM2(null, 900)).toBeNull()
    expect(solarYieldPct(null, 900, 4)).toBeNull()
  })

  it('respinge valori nefinite în loc să le propage', () => {
    expect(airDensityKgM3(Number.NaN, 1013, 50)).toBeNull()
    expect(clearSkyGhiWM2(Number.POSITIVE_INFINITY)).toBeNull()
    expect(solarPosition(new Date('nimic'), 46, 23)).toBeNull()
  })
})
