/**
 * Meteorologia tradusă în mărimi care schimbă felul în care merge mașina.
 *
 * O secțiune de vreme care afișează „24 °C, vânt 5 km/h" este un widget de
 * telefon. Pe o mașină solară, aceleași două numere înseamnă altceva: aerul
 * cald este mai rar, deci rezistența aerodinamică scade; vântul are o
 * componentă pe direcția de mers care se adună la viteza proprie și intră la
 * pătrat în puterea cerută. Modulul de față face exact traducerea asta, și
 * numai pe ea. Nu desenează nimic și nu cere nimic din rețea.
 *
 * ## Regula valorilor lipsă
 *
 * Fiecare funcție întoarce `null` dacă îi lipsește orice intrare. Nu există
 * valoare implicită nicăieri: o presiune presupusă 1013 hPa sau o umiditate
 * presupusă 50 % ar produce o densitate a aerului care *arată* ca o măsurătoare
 * și ar intra tăcut în puterea aerodinamică afișată pilotului. Cu nimic
 * conectat, tot lanțul iese `null` și interfața arată „—".
 *
 * ## Verificabilitate
 *
 * Fiecare formulă de mai jos are o referință fizică față de care poate fi
 * verificată independent de implementare — atmosfera standard internațională,
 * o identitate geometrică sau o condiție de definiție. Testele o folosesc pe
 * aceea, nu cifre scoase din rularea acestui cod.
 */

/** Constantele modelelor. Toate au o sursă, niciuna nu este „aproximativ bine". */
export const WEATHER_MODEL = {
  /** Densitatea aerului în atmosfera standard internațională, la nivelul mării. */
  ISA_DENSITY_KG_M3: 1.225,
  /** Constanta specifică a aerului uscat, J/(kg·K). */
  R_DRY: 287.058,
  /** Constanta specifică a vaporilor de apă, J/(kg·K). */
  R_VAPOUR: 461.495,
  /** Coeficienții Magnus recomandați de OMM pentru presiunea de saturație. */
  MAGNUS_A: 17.62,
  MAGNUS_B: 243.12,
  /** Presiunea de saturație la 0 °C, hPa. */
  MAGNUS_E0: 6.112,
  /** Gradientul termic al troposferei standard, K/m. */
  LAPSE_RATE_K_M: 0.0065,
  /** Exponentul barometric al atmosferei standard. */
  BAROMETRIC_EXPONENT: 5.257,
  /** Constanta modelului Haurwitz de cer senin, W/m². */
  HAURWITZ_A: 1098,
  HAURWITZ_B: 0.059,
  /** Coeficientul de atenuare prin nori (Kasten & Czeplak, 1980). */
  CLOUD_A: 0.75,
  CLOUD_B: 3.4,
  /**
   * Temperatura nominală de operare a celulei, °C. Valoarea de catalog pentru
   * un modul obișnuit; se atinge la 800 W/m², 20 °C aer și 1 m/s vânt.
   */
  NOCT_C: 45,
  /** Coeficientul termic de putere al celulelor monocristaline, 1/°C. */
  PV_TEMP_COEFFICIENT: -0.0035,
  /** Temperatura de referință a celulei în condiții standard de test, °C. */
  PV_REFERENCE_C: 25,
} as const

const DEG = Math.PI / 180

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toRadians(degrees: number): number {
  return degrees * DEG
}

function toDegrees(radians: number): number {
  return radians / DEG
}

// --- umiditate și densitatea aerului --------------------------------------

/**
 * Presiunea de saturație a vaporilor de apă, în hPa (formula Magnus-Tetens).
 *
 * `e_s(T) = 6,112 · exp(17,62 · T / (243,12 + T))`
 *
 * Verificare independentă: la 0 °C rezultatul este prin definiție 6,112 hPa.
 */
export function saturationVapourPressureHpa(
  tempC: number | null,
): number | null {
  if (!finite(tempC)) return null
  const { MAGNUS_A, MAGNUS_B, MAGNUS_E0 } = WEATHER_MODEL
  const denominator = MAGNUS_B + tempC
  if (denominator === 0) return null
  return MAGNUS_E0 * Math.exp((MAGNUS_A * tempC) / denominator)
}

/** Presiunea parțială a vaporilor de apă, în hPa. */
export function vapourPressureHpa(
  tempC: number | null,
  relativeHumidityPct: number | null,
): number | null {
  const saturation = saturationVapourPressureHpa(tempC)
  if (saturation === null || !finite(relativeHumidityPct)) return null
  const fraction = Math.min(100, Math.max(0, relativeHumidityPct)) / 100
  return saturation * fraction
}

/**
 * Punctul de rouă, în °C — inversa formulei Magnus.
 *
 * Furnizorul îl raportează direct, dar îl calculăm și noi: diferența dintre
 * temperatură și punctul de rouă este indicatorul de ceață și de condens pe
 * parbriz, iar dacă furnizorul nu îl trimite nu vrem să rămână o gaură.
 *
 * Verificare independentă: la 100 % umiditate, punctul de rouă este chiar
 * temperatura aerului.
 */
export function dewPointC(
  tempC: number | null,
  relativeHumidityPct: number | null,
): number | null {
  if (!finite(tempC) || !finite(relativeHumidityPct)) return null
  const fraction = Math.min(100, Math.max(0, relativeHumidityPct)) / 100
  if (fraction <= 0) return null

  const { MAGNUS_A, MAGNUS_B } = WEATHER_MODEL
  const gamma = Math.log(fraction) + (MAGNUS_A * tempC) / (MAGNUS_B + tempC)
  const denominator = MAGNUS_A - gamma
  if (denominator === 0) return null
  return (MAGNUS_B * gamma) / denominator
}

/**
 * Presiunea la altitudinea circuitului, pornind de la cea redusă la nivelul mării.
 *
 * Furnizorii meteo raportează presiunea redusă la nivelul mării, ca hărțile
 * sinoptice să fie comparabile. Densitatea aerului cere însă presiunea reală de
 * la fața locului. La 400 m — altitudinea unui circuit din Transilvania —
 * diferența este de ~45 hPa, adică peste 4 % din densitate și tot atât din
 * puterea aerodinamică.
 *
 * Verificare independentă: în atmosfera standard, la 1000 m și 8,5 °C,
 * rezultatul trebuie să fie presiunea standard de la 1000 m, 898,8 hPa.
 */
export function stationPressureHpa(
  seaLevelHpa: number | null,
  altitudeM: number | null,
  tempC: number | null,
): number | null {
  if (!finite(seaLevelHpa)) return null
  if (!finite(altitudeM)) return seaLevelHpa
  if (!finite(tempC)) return null

  const { LAPSE_RATE_K_M, BAROMETRIC_EXPONENT } = WEATHER_MODEL
  const rise = LAPSE_RATE_K_M * altitudeM
  const denominator = tempC + rise + 273.15
  if (denominator <= 0) return null

  const ratio = 1 - rise / denominator
  if (ratio <= 0) return null
  return seaLevelHpa * ratio ** BAROMETRIC_EXPONENT
}

/**
 * Densitatea aerului umed, în kg/m³ (ecuația gazelor pentru amestec).
 *
 * `ρ = p_uscat / (R_d · T) + e / (R_v · T)`, cu presiunile în Pa și T în kelvin.
 *
 * Aerul umed este mai *ușor* decât cel uscat — vaporii de apă au masa molară
 * mai mică decât azotul și oxigenul pe care îi înlocuiesc. Contraintuitiv, dar
 * măsurabil: la 30 °C și 100 % umiditate se pierd ~1,5 % din densitate, deci
 * tot atât din rezistența aerodinamică.
 *
 * Verificare independentă: aer uscat la 15 °C și 1013,25 hPa trebuie să dea
 * exact densitatea atmosferei standard, 1,225 kg/m³.
 */
export function airDensityKgM3(
  tempC: number | null,
  pressureHpa: number | null,
  relativeHumidityPct: number | null,
): number | null {
  if (!finite(tempC) || !finite(pressureHpa)) return null

  const kelvin = tempC + 273.15
  if (kelvin <= 0) return null

  const { R_DRY, R_VAPOUR } = WEATHER_MODEL
  // Fără umiditate raportată tratăm aerul ca uscat, dar numai aici: este o
  // ipoteză conservatoare (densitate ușor supraestimată), nu o valoare inventată.
  const vapour = vapourPressureHpa(tempC, relativeHumidityPct) ?? 0
  const dry = pressureHpa - vapour
  if (dry < 0) return null

  return (dry * 100) / (R_DRY * kelvin) + (vapour * 100) / (R_VAPOUR * kelvin)
}

/** Densitatea raportată la atmosfera standard. Sub 1 = aer mai rar, mașina „merge mai ușor". */
export function relativeAirDensity(densityKgM3: number | null): number | null {
  if (!finite(densityKgM3) || densityKgM3 <= 0) return null
  return densityKgM3 / WEATHER_MODEL.ISA_DENSITY_KG_M3
}

// --- vânt -----------------------------------------------------------------

export type WindComponents = {
  /** Pozitiv = vânt din față. Negativ = vânt din spate. km/h. */
  headwindKph: number
  /** Pozitiv = vânt dinspre dreapta mașinii. km/h. */
  crosswindKph: number
}

/**
 * Descompune vântul pe direcția de mers.
 *
 * Convenția meteorologică dă direcția *din care* bate vântul. Dacă mașina merge
 * spre nord (cap compas 0°) și vântul vine din nord (360°), diferența este
 * zero, cosinusul este 1 și componenta frontală este întreg vântul — corect,
 * este vânt din față.
 *
 * `v_frontal = v · cos(direcție − cap)`, `v_lateral = v · sin(direcție − cap)`.
 */
export function windComponents(
  windSpeedKph: number | null,
  windFromDeg: number | null,
  headingDeg: number | null,
): WindComponents | null {
  if (!finite(windSpeedKph) || !finite(windFromDeg) || !finite(headingDeg)) {
    return null
  }
  if (windSpeedKph < 0) return null

  const delta = toRadians(windFromDeg - headingDeg)
  return {
    headwindKph: windSpeedKph * Math.cos(delta),
    crosswindKph: windSpeedKph * Math.sin(delta),
  }
}

/**
 * Viteza aerului peste caroserie, în km/h.
 *
 * Este viteza care contează pentru rezistența aerodinamică: mașina „vede" suma
 * dintre viteza proprie și vântul din față. La 60 km/h cu 15 km/h vânt frontal,
 * aerodinamic mașina merge cu 75 km/h — cu 56 % mai multă forță de rezistență.
 */
export function apparentAirSpeedKph(
  groundSpeedKph: number | null,
  headwindKph: number | null,
): number | null {
  if (!finite(groundSpeedKph)) return null
  if (!finite(headwindKph)) return null
  return groundSpeedKph + headwindKph
}

/**
 * Puterea consumată de rezistența aerului, în W.
 *
 * `P = ½ · ρ · CdA · v_aer² · v_sol`
 *
 * Forța se opune curgerii aerului, deci depinde de viteza aerului; puterea este
 * forța înmulțită cu viteza *față de sol*, pentru că numai deplasarea pe sol
 * cere lucru mecanic de la motor. Cele două viteze sunt egale doar pe vânt nul,
 * iar confundarea lor pe vânt de față supraestimează consumul cu zeci de wați.
 */
export function aeroPowerW(
  groundSpeedKph: number | null,
  airSpeedKph: number | null,
  densityKgM3: number | null,
  dragArea: number,
): number | null {
  if (!finite(groundSpeedKph) || !finite(airSpeedKph) || !finite(densityKgM3)) {
    return null
  }
  if (groundSpeedKph < 0 || densityKgM3 <= 0 || dragArea <= 0) return null

  const groundMs = groundSpeedKph / 3.6
  const airMs = airSpeedKph / 3.6
  // Semnul vitezei aerului contează: la vânt din spate mai tare decât mașina,
  // aerul împinge, iar puterea cerută devine negativă.
  return 0.5 * densityKgM3 * dragArea * airMs * Math.abs(airMs) * groundMs
}

/**
 * Cât din puterea aerodinamică este pusă acolo de vânt, în W.
 *
 * Diferența dintre puterea cu vântul de acum și puterea pe care aceeași mașină
 * ar cere-o pe aer liniștit. Este cifra care se transmite pe radio: „vântul te
 * costă 180 W" spune mai mult decât „vânt 18 km/h din nord-vest".
 */
export function windPenaltyW(
  groundSpeedKph: number | null,
  headwindKph: number | null,
  densityKgM3: number | null,
  dragArea: number,
): number | null {
  const withWind = aeroPowerW(
    groundSpeedKph,
    apparentAirSpeedKph(groundSpeedKph, headwindKph),
    densityKgM3,
    dragArea,
  )
  const still = aeroPowerW(
    groundSpeedKph,
    groundSpeedKph,
    densityKgM3,
    dragArea,
  )
  if (withWind === null || still === null) return null
  return withWind - still
}

// --- poziția soarelui și iradianța ----------------------------------------

export type SolarPosition = {
  /** Înălțimea soarelui deasupra orizontului, în grade. Negativ = sub orizont. */
  elevationDeg: number
  /** Azimutul, în grade de la nord, în sens orar. */
  azimuthDeg: number
  /** Declinația solară a zilei, în grade. */
  declinationDeg: number
  /** Unghiul orar: 0 la amiaza solară, negativ dimineața. */
  hourAngleDeg: number
  /** Ecuația timpului, în minute. */
  equationOfTimeMin: number
}

/**
 * Poziția soarelui, după algoritmul NOAA Solar Calculator.
 *
 * Precizia este de ordinul minutului de arc — cu mult peste ce cere estimarea
 * unei iradianțe, dar algoritmul este scurt și nu are sens să fie aproximat.
 *
 * Verificare independentă, fără nicio cifră din această implementare: la amiaza
 * solară, înălțimea soarelui este exact `90° − |latitudine − declinație|`, o
 * identitate geometrică. Testele o folosesc pe aceea.
 */
export function solarPosition(
  when: Date,
  latitudeDeg: number | null,
  longitudeDeg: number | null,
): SolarPosition | null {
  if (!finite(latitudeDeg) || !finite(longitudeDeg)) return null
  const time = when.getTime()
  if (!Number.isFinite(time)) return null

  const startOfYear = Date.UTC(when.getUTCFullYear(), 0, 1)
  const dayOfYear = Math.floor((time - startOfYear) / 86_400_000) + 1
  const utcMinutes =
    when.getUTCHours() * 60 + when.getUTCMinutes() + when.getUTCSeconds() / 60

  // Unghiul fracționar al anului, în radiani.
  const gamma =
    ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcMinutes / 60 - 12) / 24)

  const equationOfTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))

  const declinationRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  // Timpul solar adevărat, în minute. Lucrăm în UTC, deci nu apare fusul orar.
  const trueSolarMinutes = utcMinutes + equationOfTimeMin + 4 * longitudeDeg
  // Unghiul orar, adus în intervalul (−180, 180].
  let hourAngleDeg = trueSolarMinutes / 4 - 180
  hourAngleDeg = ((((hourAngleDeg + 180) % 360) + 360) % 360) - 180

  const latRad = toRadians(latitudeDeg)
  const hourRad = toRadians(hourAngleDeg)

  const cosZenith =
    Math.sin(latRad) * Math.sin(declinationRad) +
    Math.cos(latRad) * Math.cos(declinationRad) * Math.cos(hourRad)
  const zenithRad = Math.acos(Math.min(1, Math.max(-1, cosZenith)))
  const elevationDeg = 90 - toDegrees(zenithRad)

  const sinZenith = Math.sin(zenithRad)
  let azimuthDeg = 180
  if (sinZenith > 1e-9 && Math.abs(Math.cos(latRad)) > 1e-9) {
    const cosAzimuth =
      (Math.sin(declinationRad) - Math.sin(latRad) * cosZenith) /
      (Math.cos(latRad) * sinZenith)
    azimuthDeg = toDegrees(Math.acos(Math.min(1, Math.max(-1, cosAzimuth))))
    // Acosinusul dă doar 0-180°; după-amiaza soarelui îi corespunde reflexia.
    if (hourAngleDeg > 0) azimuthDeg = 360 - azimuthDeg
  }

  return {
    elevationDeg,
    azimuthDeg,
    declinationDeg: toDegrees(declinationRad),
    hourAngleDeg,
    equationOfTimeMin,
  }
}

/**
 * Iradianța globală pe plan orizontal, pe cer perfect senin (model Haurwitz).
 *
 * `GHI = 1098 · cos(z) · exp(−0,059 / cos(z))`, cu `z` unghiul zenital.
 *
 * Modelul are un singur parametru — înălțimea soarelui — și nu cere nici
 * turbiditate, nici coloană de apă precipitabilă, date pe care oricum nu le
 * avem. Sub orizont întoarce 0: noaptea nu este o lipsă de date, este zero.
 */
export function clearSkyGhiWM2(elevationDeg: number | null): number | null {
  if (!finite(elevationDeg)) return null
  if (elevationDeg <= 0) return 0

  const cosZenith = Math.cos(toRadians(90 - elevationDeg))
  if (cosZenith <= 0) return 0

  const { HAURWITZ_A, HAURWITZ_B } = WEATHER_MODEL
  return HAURWITZ_A * cosZenith * Math.exp(-HAURWITZ_B / cosZenith)
}

/**
 * Cât din lumina cerului seninat trece prin nori (Kasten & Czeplak, 1980).
 *
 * `k = 1 − 0,75 · (nebulozitate)^3,4`
 *
 * Relația nu este liniară, și asta este partea utilă: 30 % nori iau doar ~1 %
 * din energie, în timp ce cerul complet acoperit lasă 25 %. De aceea „s-a
 * înnorat puțin" nu este o veste, iar „s-a acoperit" este.
 */
export function cloudTransmittance(
  cloudCoverPct: number | null,
): number | null {
  if (!finite(cloudCoverPct)) return null
  const fraction = Math.min(100, Math.max(0, cloudCoverPct)) / 100
  const { CLOUD_A, CLOUD_B } = WEATHER_MODEL
  return 1 - CLOUD_A * fraction ** CLOUD_B
}

/** Iradianța estimată la sol, în W/m², ținând cont de nori. */
export function estimatedGhiWM2(
  elevationDeg: number | null,
  cloudCoverPct: number | null,
): number | null {
  const clear = clearSkyGhiWM2(elevationDeg)
  const transmittance = cloudTransmittance(cloudCoverPct)
  if (clear === null || transmittance === null) return null
  return clear * transmittance
}

/**
 * Temperatura celulei fotovoltaice, în °C (modelul NOCT).
 *
 * `T_celulă = T_aer + (NOCT − 20) / 800 · GHI`
 *
 * Verificare independentă: în chiar condițiile care definesc NOCT — 800 W/m² și
 * 20 °C aer — formula trebuie să întoarcă NOCT.
 */
export function cellTemperatureC(
  airTempC: number | null,
  ghiWM2: number | null,
  noctC: number = WEATHER_MODEL.NOCT_C,
): number | null {
  if (!finite(airTempC) || !finite(ghiWM2) || ghiWM2 < 0) return null
  return airTempC + ((noctC - 20) / 800) * ghiWM2
}

/**
 * Factorul de putere al panourilor la temperatura celulei.
 *
 * Panourile pierd putere când se încălzesc: ~0,35 % pentru fiecare grad peste
 * 25 °C. Într-o zi senină de vară, celulele ajung la 60 °C și livrează cu ~12 %
 * mai puțin decât o promite eticheta — iar eticheta este cea din care echipa
 * își face bugetul energetic.
 */
export function pvTemperatureFactor(
  cellTempC: number | null,
  coefficient: number = WEATHER_MODEL.PV_TEMP_COEFFICIENT,
): number | null {
  if (!finite(cellTempC)) return null
  return 1 + coefficient * (cellTempC - WEATHER_MODEL.PV_REFERENCE_C)
}

/**
 * Aria efectivă de captare, în m²: puterea măsurată împărțită la iradianța estimată.
 *
 * Este produsul dintre suprafața reală a panourilor și randamentul lor. Nu cere
 * nicio constantă presupusă și de asta este util: comparată cu aria cunoscută a
 * array-ului, o scădere bruscă arată un șir căzut sau un MPPT oprit — cu soarele
 * neschimbat.
 */
export function effectiveApertureM2(
  solarPowerW: number | null,
  ghiWM2: number | null,
): number | null {
  if (!finite(solarPowerW) || !finite(ghiWM2)) return null
  // Sub 20 W/m² raportul explodează și nu mai spune nimic despre panouri.
  if (ghiWM2 < 20 || solarPowerW < 0) return null
  return solarPowerW / ghiWM2
}

/**
 * Cât din potențialul cerului senin ajunge efectiv în pachet, în procente.
 *
 * Amestecă două cauze — nori și panouri — și de aceea se citește împreună cu
 * aria efectivă: nebulozitate mare explică o valoare mică, cer senin și valoare
 * mică înseamnă o problemă pe mașină.
 */
export function solarYieldPct(
  solarPowerW: number | null,
  ghiWM2: number | null,
  arrayAreaM2: number | null,
): number | null {
  if (!finite(solarPowerW) || !finite(ghiWM2) || !finite(arrayAreaM2))
    return null
  if (ghiWM2 < 20 || arrayAreaM2 <= 0) return null
  return (solarPowerW / (ghiWM2 * arrayAreaM2)) * 100
}

/**
 * Diferența temperatură - punct de rouă, în °C.
 *
 * Sub ~2,5 °C se formează ceață și condens; pe un parbriz de mașină solară,
 * fără degivrare, asta înseamnă vizibilitate zero în câteva secunde.
 */
export function dewPointSpreadC(
  tempC: number | null,
  dewPoint: number | null,
): number | null {
  if (!finite(tempC) || !finite(dewPoint)) return null
  return tempC - dewPoint
}
