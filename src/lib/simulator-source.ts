import type { TelemetryFrame } from '../schemas/telemetry'
import type { TelemetryHandlers, TelemetrySource } from './telemetry-source'
import { positionAt, targetSpeedAt, toLatLon, TRACK } from './track'

/**
 * Simulator de telemetrie.
 *
 * Documentul de arhitectură cere un simulator ca prima piesă din MVP, ca
 * dezvoltarea să nu depindă de mașină. Modelul este coerent fizic: mașina
 * parcurge circuitul definit în `track.ts` urmărind profilul de viteză dictat
 * de curbură, puterea motorului rezultă din viteză, curentul din baterie este
 * diferența dintre consum și producția solară, iar temperaturile urmăresc
 * puterea cu inerție.
 */

const TRACK_CENTER = { lat: 46.7712, lon: 23.6236 } // Cluj-Napoca

/** Constanta de timp cu care mașina urmărește viteza-țintă din profil. */
const SPEED_LAG_S = 0.6

/** PRNG determinist, ca testele să nu depindă de `Math.random`. */
function createRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

export type SimulatorOptions = {
  handlers: TelemetryHandlers
  hz?: number
  seed?: number
  vehicleId?: string
  sessionId?: string
}

type SimulatorState = {
  elapsedS: number
  sequence: number
  /** Distanța cumulată de la start, în metri. Determină poziția și turul. */
  distanceM: number
  speedMps: number
  soc: number
  motorTemp: number
  inverterTemp: number
  cellTemp: number
}

export function createSimulatorState(): SimulatorState {
  return {
    elapsedS: 0,
    sequence: 0,
    distanceM: 0,
    speedMps: targetSpeedAt(0),
    soc: 78.5,
    motorTemp: 34,
    inverterTemp: 31,
    cellTemp: 27,
  }
}

/**
 * Avansează modelul cu `dtS` secunde și produce cadrul corespunzător.
 * Exportat separat de bucla de timp, ca să poată fi testat pas cu pas.
 */
export function stepSimulator(
  state: SimulatorState,
  dtS: number,
  random: () => number,
  meta: { vehicleId: string; sessionId: string; now: number },
): TelemetryFrame {
  state.elapsedS += dtS
  state.sequence += 1

  // Viteza urmărește profilul circuitului cu o mică întârziere, plus zgomot.
  const targetSpeed = targetSpeedAt(state.distanceM)
  state.speedMps +=
    (targetSpeed - state.speedMps) * Math.min(1, dtS / SPEED_LAG_S)
  state.speedMps = Math.max(0, state.speedMps + (random() - 0.5) * 0.12)

  state.distanceM += state.speedMps * dtS

  const speed = state.speedMps * 3.6
  const lapNumber = Math.floor(state.distanceM / TRACK.length) + 1
  const position = positionAt(state.distanceM)
  const { lat, lon } = toLatLon(position, TRACK_CENTER)

  // Producția solară urmează un ciclu lent de nori.
  const cloud = 0.78 + 0.22 * Math.sin(state.elapsedS / 47)
  const solarPower = Math.max(0, 1_180 * cloud + (random() - 0.5) * 45)
  const mpptEfficiency = 96.4 + Math.sin(state.elapsedS / 23) * 1.4

  // Consumul motorului crește aproximativ cu pătratul vitezei (rezistență
  // aerodinamică) plus o componentă constantă de rulare.
  const motorPower = 180 + Math.pow(speed / 10, 2.4) * 12
  const netPower = motorPower - solarPower

  const packVoltage = 96 + (state.soc / 100) * 28
  const packCurrent = netPower / packVoltage

  // SOC scade proporțional cu energia netă consumată.
  state.soc = Math.min(
    100,
    Math.max(0, state.soc - (netPower * dtS) / (3_600 * 52)),
  )

  // Temperaturile urmăresc puterea cu o constantă de timp.
  const approach = (current: number, target: number, tau: number) =>
    current + (target - current) * Math.min(1, dtS / tau)

  state.motorTemp = approach(state.motorTemp, 32 + motorPower / 46, 22)
  state.inverterTemp = approach(state.inverterTemp, 30 + motorPower / 58, 28)
  state.cellTemp = approach(state.cellTemp, 26 + Math.abs(packCurrent) * 0.42, 45)

  const cellNominal = packVoltage / 30
  const cellSpread = 0.018 + Math.abs(packCurrent) * 0.0011

  // Precizia GPS se degradează periodic, ca să existe și o alarmă reală de văzut.
  const gpsAccuracy = 1.8 + Math.max(0, Math.sin(state.elapsedS / 61)) * 5.4

  const signals: Record<string, number> = {
    vehicle_speed_kph: round(speed, 2),
    lap_number: lapNumber,

    battery_soc_pct: round(state.soc, 2),
    battery_voltage_v: round(packVoltage, 2),
    battery_current_a: round(packCurrent, 2),
    battery_power_w: round(packCurrent * packVoltage, 1),
    cell_voltage_min_v: round(cellNominal - cellSpread, 4),
    cell_voltage_max_v: round(cellNominal + cellSpread, 4),
    cell_temp_max_c: round(state.cellTemp, 2),
    cell_temp_delta_c: round(2.1 + Math.abs(packCurrent) * 0.08, 2),

    solar_power_w: round(solarPower, 1),
    mppt_efficiency_pct: round(mpptEfficiency, 2),

    motor_power_w: round(motorPower, 1),
    motor_temp_c: round(state.motorTemp, 2),
    inverter_temp_c: round(state.inverterTemp, 2),

    gps_latitude_deg: round(lat, 6),
    gps_longitude_deg: round(lon, 6),
    gps_accuracy_m: round(gpsAccuracy, 2),
  }

  return {
    schema_version: 1,
    vehicle_id: meta.vehicleId,
    session_id: meta.sessionId,
    timestamp: new Date(meta.now).toISOString(),
    sequence: state.sequence,
    signals,
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function createSimulatorSource({
  handlers,
  hz = 10,
  seed = 42,
  vehicleId = 'tucn-solar-01',
  sessionId = 'sesiune-simulata',
}: SimulatorOptions): TelemetrySource {
  const intervalMs = 1_000 / hz
  /** Limită pentru un singur pas, ca o pauză lungă să nu teleporteze mașina. */
  const MAX_STEP_S = 1
  let timer: ReturnType<typeof setInterval> | null = null

  return {
    kind: 'simulator',
    describe: `simulator local · ${hz} Hz`,

    start() {
      if (timer !== null) return

      const state = createSimulatorState()
      const random = createRandom(seed)
      let lastTickAt = Date.now()

      handlers.onStatus('connecting', 'Se pornește simulatorul')

      timer = setInterval(() => {
        // Pasul urmează timpul real, nu rata nominală. Browserele limitează
        // timerele din taburile de fundal la ~1 Hz; cu un `dt` fix, simularea
        // ar rula cu încetinitorul, iar `timestamp` s-ar desincroniza de
        // poziția raportată.
        const now = Date.now()
        const dtS = Math.min(MAX_STEP_S, (now - lastTickAt) / 1_000)
        lastTickAt = now
        if (dtS <= 0) return

        handlers.onFrame(
          stepSimulator(state, dtS, random, { vehicleId, sessionId, now }),
        )
      }, intervalMs)

      handlers.onStatus('connected')
    },

    stop() {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      handlers.onStatus('idle')
    },
  }
}
