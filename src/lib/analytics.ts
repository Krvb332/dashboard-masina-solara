import {
  aeroSharePct,
  cRate,
  counterDelta,
  drivetrainEfficiencyPct,
  economicSpeedKph,
  efficiencyKmPerKwh,
  integrateWh,
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
  smoothnessScore,
  solarFractionPct,
  specificConsumptionWhPerKm,
  thermalHeadroomPct,
  timeToEmptyS,
  timeToThresholdS,
  VEHICLE,
  type VehicleParameters,
} from './telemetry-math'

/**
 * Acumulatorul de statistici derivate ale sesiunii.
 *
 * Primește starea de calitate a semnalelor la ritm redus (~5 Hz) și menține
 * bilanțul energetic, distanța, extremele și ferestrele glisante din care se
 * calculează tendințele. Este cod pur, fără React și fără rețea: aceleași
 * eșantioane produc întotdeauna aceleași cifre, în test ca și în pitlane.
 *
 * ## Ce intră în agregate
 *
 * **Numai valorile marcate `valid` de server.** O valoare `stale` este ultima
 * citire a unui senzor care a amuțit; integrată mai departe, ar continua să
 * „consume" energie cu mașina oprită. O valoare `sensor_error` este în afara
 * domeniului fizic. Ambele sunt respinse înainte de a atinge un total.
 *
 * De aceea, cu nimic conectat, fiecare contor rămâne exact `0`: nu s-a
 * acumulat nimic, pentru că nu a fost nimic de acumulat. Mărimile derivate
 * care nu se pot calcula fără date (consum specific, autonomie, randament)
 * rămân `null` — interfața le arată ca „—", niciodată ca zero, fiindcă „0
 * Wh/km" ar fi o afirmație falsă, nu o lipsă de informație.
 *
 * ## Contoare față de integrare
 *
 * Când mașina trimite contoare cumulate (`energy_consumed_wh`, `distance_km`),
 * ele sunt sursa de adevăr: sunt calculate pe vehicul, la frecvența completă a
 * senzorilor, nu la 5 Hz. Integrarea puterii este rezerva pentru cazul în care
 * contoarele lipsesc. Cele două nu se adună niciodată.
 */

export type QualityState = 'valid' | 'stale' | 'unavailable' | 'sensor_error'

export type QualityEntry = {
  state: QualityState
  value: number | null
}

/** Un pas de acumulare: momentul și starea de calitate a fiecărui semnal. */
export type AnalyticsInput = {
  timeMs: number
  quality: Record<string, QualityEntry | undefined>
}

/** Contoarele sesiunii. Toate pornesc de la zero și cresc doar din date valide. */
export type AnalyticsTotals = {
  samples: number
  /** Secunde în care au existat date proaspete. Nu include tăcerea. */
  activeSeconds: number
  distanceKm: number
  energyConsumedWh: number
  energyRegenWh: number
  energySolarWh: number
  motorEnergyWh: number
  elevationGainM: number
  elevationLossM: number
  maxSpeedKph: number
  maxMotorPowerW: number
  maxBatteryTempC: number
  maxMotorTempC: number
  harshAccelCount: number
  harshBrakeCount: number
}

export type ThermalTrend = {
  key: string
  valueC: number | null
  ratePerMinC: number | null
  headroomPct: number | null
  timeToCritS: number | null
}

/** Ce citește interfața. Fiecare câmp `null` înseamnă „nu se poate calcula". */
export type AnalyticsSnapshot = {
  totals: AnalyticsTotals
  /** Datele proaspete există chiar acum. */
  live: boolean

  averageSpeedKph: number | null
  /** Consumul specific pe toată sesiunea. */
  whPerKm: number | null
  /** Consumul specific pe fereastra glisantă — reacționează la stilul de condus. */
  recentWhPerKm: number | null
  kmPerKwh: number | null

  /** Puterea scoasă din pachet acum, pozitivă la descărcare. */
  consumptionW: number | null
  /** Puterea recuperată acum de frâna regenerativă. */
  regenW: number | null
  solarW: number | null
  motorW: number | null
  /** Aport solar minus consum. Pozitiv = pachetul se încarcă în mers. */
  netPowerW: number | null
  peakConsumptionW: number | null

  regenRatioPct: number | null
  solarFractionPct: number | null
  energyBalanceWh: number
  drivetrainEfficiencyPct: number | null

  socPct: number | null
  remainingWh: number | null
  rangeKm: number | null
  timeToEmptyS: number | null
  socRatePctPerMin: number | null
  projectedSoc30MinPct: number | null
  cRate: number | null
  packResistanceOhm: number | null

  /** Puterea teoretic necesară la viteza și panta actuale. */
  roadLoadW: number | null
  /** Cât din rezistența la înaintare este aerodinamică. */
  aeroSharePct: number | null
  economicSpeedKph: number | null
  gradePct: number | null
  altitudeM: number | null

  smoothnessScore: number | null
  thermal: ThermalTrend[]
}

/** Câte eșantioane păstrăm pe ferestrele glisante. La 5 Hz, 600 = 2 minute. */
const WINDOW = 600
/** Fereastra pe care se calculează consumul „recent", în milisecunde. */
const RECENT_WINDOW_MS = 120_000
/**
 * Peste atâta tăcere nu mai integrăm peste gol: o pauză de legătură nu
 * înseamnă că mașina a consumat constant tot timpul cât nu am auzit-o.
 */
const MAX_GAP_MS = 3000
/** Praguri pentru numărarea manevrelor bruște, în m/s². */
const HARSH_ACCEL_MS2 = 1.2
const HARSH_BRAKE_MS2 = 2.0
/** Fereastra pe care se calculează panta, în milisecunde. */
const GRADE_WINDOW_MS = 30_000
/** Sub această diferență, variația de altitudine este zgomot de receptor. */
const ELEVATION_NOISE_M = 0.5

const EMPTY_TOTALS: AnalyticsTotals = {
  samples: 0,
  activeSeconds: 0,
  distanceKm: 0,
  energyConsumedWh: 0,
  energyRegenWh: 0,
  energySolarWh: 0,
  motorEnergyWh: 0,
  elevationGainM: 0,
  elevationLossM: 0,
  maxSpeedKph: 0,
  maxMotorPowerW: 0,
  maxBatteryTempC: 0,
  maxMotorTempC: 0,
  harshAccelCount: 0,
  harshBrakeCount: 0,
}

/** Semnalele termice urmărite pentru tendință, cu pragurile lor. */
const THERMAL_KEYS = [
  { key: 'motor_temp_c', warn: 90, crit: 110 },
  { key: 'inverter_temp_c', warn: 70, crit: 85 },
  { key: 'battery_temp_max_c', warn: 50, crit: 60 },
] as const

type Series = [number, number][]

function push(series: Series, time: number, value: number): void {
  series.push([time, value])
  if (series.length > WINDOW) series.shift()
}

/** Valoarea unui semnal doar dacă serverul a marcat-o proaspătă. */
function fresh(
  quality: Record<string, QualityEntry | undefined>,
  key: string,
): number | null {
  const entry = quality[key]
  if (entry === undefined || entry.state !== 'valid') return null
  if (entry.value === null || !Number.isFinite(entry.value)) return null
  return entry.value
}

export class TelemetryAnalytics {
  private totalsState: AnalyticsTotals = { ...EMPTY_TOTALS }

  private lastTimeMs: number | null = null
  private lastCounters: Record<string, number | null> = {}
  private lastSpeedMs: number | null = null
  private lastAltitudeM: number | null = null
  private lastFresh = false
  /**
   * Puterile din eșantionul anterior, pentru integrarea trapezoidală. Cu
   * dreptunghiuri, o rampă de putere ar fi numărată sistematic greșit — în
   * aceeași direcție de fiecare dată, deci eroarea s-ar acumula pe toată cursa.
   */
  private lastPowers: {
    battery: number | null
    solar: number | null
    motor: number | null
    regen: number | null
  } = { battery: null, solar: null, motor: null, regen: null }

  private speeds: Series = []
  private throttle: number[] = []
  private consumption: Series = []
  private socSeries: Series = []
  private distanceSeries: Series = []
  private energySeries: Series = []
  private altitudeSeries: Series = []
  private packSamples: { currentA: number; voltageV: number }[] = []
  private thermalSeries = new Map<string, Series>()

  private lastQuality: Record<string, QualityEntry | undefined> = {}

  private readonly vehicle: VehicleParameters

  constructor(vehicle: VehicleParameters = VEHICLE) {
    this.vehicle = vehicle
  }

  get totals(): AnalyticsTotals {
    return { ...this.totalsState }
  }

  reset(): void {
    this.totalsState = { ...EMPTY_TOTALS }
    this.lastTimeMs = null
    this.lastCounters = {}
    this.lastSpeedMs = null
    this.lastAltitudeM = null
    this.lastFresh = false
    this.lastPowers = { battery: null, solar: null, motor: null, regen: null }
    this.speeds = []
    this.throttle = []
    this.consumption = []
    this.socSeries = []
    this.distanceSeries = []
    this.energySeries = []
    this.altitudeSeries = []
    this.packSamples = []
    this.thermalSeries.clear()
    this.lastQuality = {}
  }

  update({ timeMs, quality }: AnalyticsInput): void {
    if (!Number.isFinite(timeMs)) return
    this.lastQuality = quality

    const speedKph = fresh(quality, 'vehicle_speed_kph')
    const batteryW = fresh(quality, 'battery_power_w')
    const motorW = fresh(quality, 'motor_power_w')
    const solarW = fresh(quality, 'solar_power_w')
    const socPct = fresh(quality, 'battery_soc_pct')
    const altitude = fresh(quality, 'gps_altitude_m')
    const throttle = fresh(quality, 'throttle_pct')
    const voltage = fresh(quality, 'battery_voltage_v')
    const current = fresh(quality, 'battery_current_a')

    const anyFresh = Object.values(quality).some(
      (entry) => entry?.state === 'valid',
    )

    // Fără nicio valoare proaspătă nu s-a întâmplat nimic de acumulat. Reținem
    // doar că fluxul e mut, ca următorul eșantion să nu integreze peste pauză.
    if (!anyFresh) {
      this.lastFresh = false
      this.lastTimeMs = timeMs
      return
    }

    const previousTime = this.lastTimeMs
    const gapMs =
      previousTime === null || !this.lastFresh ? null : timeMs - previousTime
    const dtS =
      gapMs !== null && gapMs > 0 && gapMs <= MAX_GAP_MS ? gapMs / 1000 : null

    this.totalsState.samples += 1
    if (dtS !== null) this.totalsState.activeSeconds += dtS

    this.accumulateDistance(quality, speedKph, dtS)
    this.accumulateEnergy(quality, batteryW, solarW, motorW, dtS)
    this.accumulateElevation(altitude)
    this.accumulateExtremes(speedKph, motorW, quality)
    this.accumulateHarshEvents(speedKph, dtS)

    if (speedKph !== null) push(this.speeds, timeMs, speedKph)
    if (socPct !== null) push(this.socSeries, timeMs, socPct)
    if (throttle !== null) {
      this.throttle.push(throttle)
      if (this.throttle.length > WINDOW) this.throttle.shift()
    }

    const load = this.consumptionW(quality)
    if (load !== null) push(this.consumption, timeMs, load)

    if (voltage !== null && current !== null) {
      this.packSamples.push({ currentA: current, voltageV: voltage })
      if (this.packSamples.length > WINDOW) this.packSamples.shift()
    }

    for (const { key } of THERMAL_KEYS) {
      const value = fresh(quality, key)
      if (value === null) continue
      const series = this.thermalSeries.get(key) ?? []
      push(series, timeMs, value)
      this.thermalSeries.set(key, series)
    }

    push(this.distanceSeries, timeMs, this.totalsState.distanceKm)
    push(this.energySeries, timeMs, this.totalsState.energyConsumedWh)
    if (altitude !== null) push(this.altitudeSeries, timeMs, altitude)

    this.lastTimeMs = timeMs
    this.lastFresh = true
    this.lastSpeedMs = speedKph === null ? null : speedKph / 3.6
    if (altitude !== null) this.lastAltitudeM = altitude
  }

  // --- acumulare ---------------------------------------------------------

  private accumulateDistance(
    quality: Record<string, QualityEntry | undefined>,
    speedKph: number | null,
    dtS: number | null,
  ): void {
    const counter = fresh(quality, 'distance_km')

    if (counter !== null) {
      const delta = counterDelta(this.lastCounters.distance_km ?? null, counter)
      if (delta !== null) this.totalsState.distanceKm += delta
      this.lastCounters.distance_km = counter
      return
    }

    // Fără contor pe mașină, integrăm viteza. Nu se combină cu ramura de mai
    // sus: adunarea celor două ar dubla distanța.
    if (speedKph !== null && dtS !== null) {
      const previous = this.lastSpeedMs ?? speedKph / 3.6
      const average = (previous + speedKph / 3.6) / 2
      this.totalsState.distanceKm += average * dtS * 0.001
    }
  }

  /**
   * Media trapezoidală a unei puteri între eșantionul anterior și cel curent,
   * păstrând doar partea de semnul cerut.
   *
   * `positive` selectează consumul (putere care iese din pachet), iar negarea
   * lui selectează recuperarea. Fiecare capăt se limitează întâi la zero, ca o
   * trecere prin zero între două eșantioane să nu scadă din totalul celuilalt
   * sens.
   */
  private trapezoid(
    previous: number | null,
    current: number,
    hours: number,
    positive: boolean,
  ): number {
    const clamp = (value: number) =>
      positive ? Math.max(0, value) : Math.max(0, -value)
    const from = previous === null ? clamp(current) : clamp(previous)
    return ((from + clamp(current)) / 2) * hours
  }

  private accumulateEnergy(
    quality: Record<string, QualityEntry | undefined>,
    batteryW: number | null,
    solarW: number | null,
    motorW: number | null,
    dtS: number | null,
  ): void {
    const hours = dtS === null ? null : dtS / 3600

    const consumedCounter = fresh(quality, 'energy_consumed_wh')
    if (consumedCounter !== null) {
      const delta = counterDelta(
        this.lastCounters.energy_consumed_wh ?? null,
        consumedCounter,
      )
      if (delta !== null) this.totalsState.energyConsumedWh += delta
      this.lastCounters.energy_consumed_wh = consumedCounter
    } else if (batteryW !== null && hours !== null) {
      this.totalsState.energyConsumedWh += this.trapezoid(
        this.lastPowers.battery,
        batteryW,
        hours,
        true,
      )
    }

    const regenCounter = fresh(quality, 'energy_regen_wh')
    if (regenCounter !== null) {
      const delta = counterDelta(
        this.lastCounters.energy_regen_wh ?? null,
        regenCounter,
      )
      if (delta !== null) this.totalsState.energyRegenWh += delta
      this.lastCounters.energy_regen_wh = regenCounter
    } else if (hours !== null) {
      const regenW = this.regenW(quality)
      if (regenW !== null) {
        this.totalsState.energyRegenWh += this.trapezoid(
          this.lastPowers.regen,
          regenW,
          hours,
          true,
        )
      }
    }

    const solarCounter = fresh(quality, 'energy_solar_wh')
    if (solarCounter !== null) {
      const delta = counterDelta(
        this.lastCounters.energy_solar_wh ?? null,
        solarCounter,
      )
      if (delta !== null) this.totalsState.energySolarWh += delta
      this.lastCounters.energy_solar_wh = solarCounter
    } else if (solarW !== null && hours !== null) {
      this.totalsState.energySolarWh += this.trapezoid(
        this.lastPowers.solar,
        solarW,
        hours,
        true,
      )
    }

    if (motorW !== null && hours !== null) {
      this.totalsState.motorEnergyWh += this.trapezoid(
        this.lastPowers.motor,
        motorW,
        hours,
        true,
      )
    }

    this.lastPowers = {
      battery: batteryW,
      solar: solarW,
      motor: motorW,
      regen: this.regenW(quality),
    }
  }

  private accumulateElevation(altitude: number | null): void {
    if (altitude === null) return
    if (this.lastAltitudeM === null) return

    const rise = altitude - this.lastAltitudeM
    if (rise > ELEVATION_NOISE_M) this.totalsState.elevationGainM += rise
    else if (rise < -ELEVATION_NOISE_M) this.totalsState.elevationLossM += -rise
  }

  private accumulateExtremes(
    speedKph: number | null,
    motorW: number | null,
    quality: Record<string, QualityEntry | undefined>,
  ): void {
    if (speedKph !== null) {
      this.totalsState.maxSpeedKph = Math.max(
        this.totalsState.maxSpeedKph,
        speedKph,
      )
    }
    if (motorW !== null) {
      this.totalsState.maxMotorPowerW = Math.max(
        this.totalsState.maxMotorPowerW,
        motorW,
      )
    }

    const batteryTemp = fresh(quality, 'battery_temp_max_c')
    if (batteryTemp !== null) {
      this.totalsState.maxBatteryTempC = Math.max(
        this.totalsState.maxBatteryTempC,
        batteryTemp,
      )
    }

    const motorTemp = fresh(quality, 'motor_temp_c')
    if (motorTemp !== null) {
      this.totalsState.maxMotorTempC = Math.max(
        this.totalsState.maxMotorTempC,
        motorTemp,
      )
    }
  }

  private accumulateHarshEvents(
    speedKph: number | null,
    dtS: number | null,
  ): void {
    if (speedKph === null || dtS === null || this.lastSpeedMs === null) return

    const accel = (speedKph / 3.6 - this.lastSpeedMs) / dtS
    if (accel > HARSH_ACCEL_MS2) this.totalsState.harshAccelCount += 1
    else if (accel < -HARSH_BRAKE_MS2) this.totalsState.harshBrakeCount += 1
  }

  // --- mărimi instantanee -----------------------------------------------

  /**
   * Puterea scoasă din pachet acum. Preferăm semnalul dedicat; dacă lipsește,
   * îl reconstruim din tensiune și curent, care vin de la același BMS.
   */
  private consumptionW(
    quality: Record<string, QualityEntry | undefined>,
  ): number | null {
    const battery = fresh(quality, 'battery_power_w')
    if (battery !== null) return battery

    const derived = packPowerW(
      fresh(quality, 'battery_voltage_v'),
      fresh(quality, 'battery_current_a'),
    )
    if (derived !== null) return derived

    return fresh(quality, 'motor_power_w')
  }

  /**
   * Puterea recuperată acum. Controllerul o poate raporta direct; altfel o
   * citim din puterea negativă a motorului sau a pachetului — energie care
   * intră înapoi, nu care iese.
   */
  private regenW(
    quality: Record<string, QualityEntry | undefined>,
  ): number | null {
    const reported = fresh(quality, 'regen_power_w')
    if (reported !== null) return Math.max(0, reported)

    const motor = fresh(quality, 'motor_power_w')
    if (motor !== null) return Math.max(0, -motor)

    const battery = fresh(quality, 'battery_power_w')
    if (battery !== null) return Math.max(0, -battery)

    return null
  }

  /** Consumul specific pe ultimele două minute, în Wh/km. */
  private recentWhPerKm(): number | null {
    const lastTime = this.lastTimeMs
    if (lastTime === null) return null

    const cutoff = lastTime - RECENT_WINDOW_MS
    const distance = this.distanceSeries.filter(([time]) => time >= cutoff)
    const energy = this.energySeries.filter(([time]) => time >= cutoff)
    if (distance.length < 2 || energy.length < 2) return null

    const distanceKm = distance[distance.length - 1][1] - distance[0][1]
    const energyWh = energy[energy.length - 1][1] - energy[0][1]
    // Sub 50 m raportul este dominat de rezoluția contorului, nu de consum.
    if (distanceKm < 0.05) return null

    return specificConsumptionWhPerKm(energyWh, distanceKm)
  }

  private thermalTrends(): ThermalTrend[] {
    return THERMAL_KEYS.map(({ key, warn, crit }) => {
      const series = this.thermalSeries.get(key) ?? []
      const value = fresh(this.lastQuality, key)
      const rate = series.length >= 10 ? ratePerMinute(series) : null

      return {
        key,
        valueC: value,
        ratePerMinC: rate,
        headroomPct: thermalHeadroomPct(value, warn, crit),
        timeToCritS: timeToThresholdS(value, crit, rate),
      }
    })
  }

  /** Starea derivată completă, recalculată la cerere. */
  snapshot(): AnalyticsSnapshot {
    const quality = this.lastQuality
    const totals = this.totals

    const live = Object.values(quality).some(
      (entry) => entry?.state === 'valid',
    )

    const speedKph = fresh(quality, 'vehicle_speed_kph')
    const speedMs = speedKph === null ? null : speedKph / 3.6
    const socPct = fresh(quality, 'battery_soc_pct')
    const solarW = fresh(quality, 'solar_power_w')
    const motorW = fresh(quality, 'motor_power_w')
    const consumption = this.consumptionW(quality)
    const regen = this.regenW(quality)

    const whPerKm = specificConsumptionWhPerKm(
      totals.energyConsumedWh,
      totals.distanceKm,
    )
    const recent = this.recentWhPerKm()
    const remaining = remainingEnergyWh(socPct, this.vehicle.packEnergyWh)
    const net = netPowerW(solarW, consumption)

    const gradeFraction = this.currentGrade()

    return {
      totals,
      live,

      averageSpeedKph:
        this.speeds.length > 0 ? mean(this.speeds.map(([, v]) => v)) : null,
      whPerKm,
      recentWhPerKm: recent,
      kmPerKwh: efficiencyKmPerKwh(totals.distanceKm, totals.energyConsumedWh),

      consumptionW: consumption,
      regenW: regen,
      solarW,
      motorW,
      netPowerW: net,
      peakConsumptionW:
        this.consumption.length >= 10
          ? percentile(
              this.consumption.map(([, value]) => value),
              0.95,
            )
          : null,

      regenRatioPct: regenRatioPct(
        totals.energyRegenWh,
        totals.energyConsumedWh,
      ),
      solarFractionPct: solarFractionPct(
        totals.energySolarWh,
        totals.energyConsumedWh,
      ),
      energyBalanceWh:
        totals.energySolarWh + totals.energyRegenWh - totals.energyConsumedWh,
      // Puterea de pe magistrală, nu cea din pachet: panourile alimentează
      // direct magistrala, iar motorul trage din suma lor.
      drivetrainEfficiencyPct: drivetrainEfficiencyPct(
        motorW,
        consumption === null ? null : consumption + (solarW ?? 0),
      ),

      socPct,
      remainingWh: remaining,
      // Autonomia se sprijină pe consumul recent, nu pe media sesiunii: dacă
      // pilotul tocmai a încetinit, cifra trebuie să reflecte decizia lui.
      rangeKm: rangeKm(remaining, recent ?? whPerKm),
      timeToEmptyS: timeToEmptyS(remaining, net === null ? null : -net),
      socRatePctPerMin:
        this.socSeries.length >= 10 ? ratePerMinute(this.socSeries) : null,
      projectedSoc30MinPct: projectedSocPct(
        socPct,
        this.socSeries.length >= 10 ? ratePerMinute(this.socSeries) : null,
        30,
      ),
      cRate: cRate(
        fresh(quality, 'battery_current_a'),
        this.vehicle.packCapacityAh,
      ),
      packResistanceOhm: packInternalResistanceOhm(this.packSamples),

      roadLoadW: roadLoadW(speedMs, gradeFraction ?? 0, this.vehicle),
      aeroSharePct: aeroSharePct(speedMs),
      economicSpeedKph: economicSpeedKph(this.vehicle),
      gradePct: gradeFraction === null ? null : gradeFraction * 100,
      altitudeM: fresh(quality, 'gps_altitude_m'),

      smoothnessScore: smoothnessScore(this.throttle),
      thermal: this.thermalTrends(),
    }
  }

  /**
   * Panta actuală: diferența de altitudine raportată la distanța parcursă, pe
   * aceeași fereastră de timp. Fără altitudine validă întoarce `null`, nu
   * zero — „drum plat" și „nu știu panta" duc la recomandări diferite pentru
   * pilot, iar modelul de rezistență la înaintare ar minți cu oricare dintre
   * ele pusă în locul celeilalte.
   */
  private currentGrade(): number | null {
    const lastTime = this.lastTimeMs
    if (lastTime === null) return null

    const cutoff = lastTime - GRADE_WINDOW_MS
    const altitude = this.altitudeSeries.filter(([time]) => time >= cutoff)
    const distance = this.distanceSeries.filter(([time]) => time >= cutoff)
    if (altitude.length < 2 || distance.length < 2) return null

    const run = (distance[distance.length - 1][1] - distance[0][1]) * 1000
    if (run < 50) return null

    const rise = altitude[altitude.length - 1][1] - altitude[0][1]
    const grade = rise / run
    // Peste 25 % nu mai este drum, ci zgomot de receptor pe verticală.
    return Math.abs(grade) > 0.25 ? null : grade
  }
}

/** Instanța folosită de dashboard. Testele își creează propria instanță. */
export const analytics = new TelemetryAnalytics()

/** Snapshot gol, pentru randarea dinaintea primului eșantion. */
export function emptySnapshot(): AnalyticsSnapshot {
  return new TelemetryAnalytics().snapshot()
}

export { EMPTY_TOTALS }

/** Energia integrată dintr-o serie de putere — expusă pentru grafice și teste. */
export { integrateWh }
