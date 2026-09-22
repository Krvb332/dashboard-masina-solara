import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sample, SessionInfo } from '../schemas/telemetry'
import { useAnalyticsStore } from '../stores/analytics-store'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import {
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../test/fixtures'
import { BASE_TIME_MS, CATALOG_KEYS, makeSamples } from '../test/synthetic'
import { fetchHistory, fetchSessionAlarms } from './api'
import { derivedBuffer } from './derived-buffer'
import { ReplayDriver, registerReplayExitHook } from './replay-driver'
import { telemetryBuffer } from './telemetry-buffer'

vi.mock('./api', () => ({
  fetchHistory: vi.fn(),
  fetchSessionAlarms: vi.fn(),
}))

// O sesiune de 20 de minute trece de câteva ori prin acumulator, cu snapshot-uri
// la fiecare doi pași; sub încărcarea suitei complete, limita implicită de 5 s
// e prea strânsă pentru un test care e corect, doar lent.
vi.setConfig({ testTimeout: 30_000 })

/**
 * Redarea trebuie să reconstruiască *toate* structurile pe care le citește
 * interfața - bufferul măsurat, bufferul derivat, store-ul de telemetrie și
 * store-ul de statistici - la timpul virtual al eșantioanelor. O derulare pe
 * timeline care lasă una dintre ele în urmă se vede ca „graficul nu se
 * încarcă" sau ca cifre din altă parte a sesiunii.
 */

const PERIOD_MS = 1000
/** 20 de minute la 1 Hz: destul ca fereastra de istoric și punctele de control să conteze. */
const COUNT = 1200
const DURATION_MS = (COUNT - 1) * PERIOD_MS
/** Cât istoric refac bufferele la o derulare (ca bufferul live: zece minute). */
const HISTORY_SAMPLES = 600

const session: SessionInfo = {
  id: 's-test',
  vehicle_id: 'solar-car-01',
  started_at: new Date(BASE_TIME_MS).toISOString(),
  ended_at: new Date(BASE_TIME_MS + DURATION_MS).toISOString(),
  sample_count: COUNT,
  alarm_count: 0,
  note: '',
}

let samples: Sample[]

function sampleAt(positionMs: number): Sample {
  return samples[Math.floor(positionMs / PERIOD_MS)]
}

async function loadedDriver(): Promise<ReplayDriver> {
  const driver = new ReplayDriver()
  await driver.load(session)
  return driver
}

beforeEach(() => {
  samples = makeSamples(COUNT, { periodMs: PERIOD_MS })

  vi.mocked(fetchHistory).mockClear()
  vi.mocked(fetchHistory).mockImplementation(async (query = {}) => {
    if (!query.sessionId) return samples.slice(-50)
    const offset = query.offset ?? 0
    return samples.slice(offset, offset + (query.limit ?? 1200))
  })
  vi.mocked(fetchSessionAlarms).mockResolvedValue([])

  telemetryBuffer.clear()
  derivedBuffer.clear()
  resetTelemetryStore()
  useAnalyticsStore.getState().clear()
  useSessionStore.getState().exitReplay()
  seedTelemetry(
    CATALOG_KEYS.map((key) => makeSignal({ key, stale_after_s: 5 })),
  )
})

describe('încărcarea unei sesiuni', () => {
  it('pune primul eșantion în buffer și publică starea lui imediat', async () => {
    await loadedDriver()

    const sessions = useSessionStore.getState()
    expect(sessions.mode).toBe('replay')
    expect(sessions.durationMs).toBe(DURATION_MS)
    expect(sessions.positionMs).toBe(0)

    expect(telemetryBuffer.size).toBe(1)
    expect(useTelemetryStore.getState().latest).toBe(samples[0])
    expect(useTelemetryStore.getState().sessionId).toBe(session.id)
    expect(useAnalyticsStore.getState().snapshot.totals.samples).toBe(1)
  })

  it('cere paginile de istoric în ordine până la una incompletă', async () => {
    await loadedDriver()

    const calls = vi.mocked(fetchHistory).mock.calls.map(([query]) => query)
    expect(calls).toEqual([{ sessionId: session.id, limit: 20000, offset: 0 }])
  })
})

describe('derularea pe timeline', () => {
  it('înainte: împinge eșantioanele până la poziție și publică fără să aștepte', async () => {
    const driver = await loadedDriver()

    driver.seek(120_000)
    driver.flush()

    expect(telemetryBuffer.size).toBe(121)
    expect(telemetryBuffer.lastTime).toBe(BASE_TIME_MS + 120_000)
    expect(useTelemetryStore.getState().latest).toBe(sampleAt(120_000))

    // A doua derulare vine la mult sub 200 ms după prima: textul trebuie să
    // sară la poziția nouă oricum, altfel cifrele rămân de la derularea veche.
    driver.seek(125_000)
    driver.flush()

    expect(telemetryBuffer.size).toBe(126)
    expect(useTelemetryStore.getState().latest).toBe(sampleAt(125_000))
    expect(useSessionStore.getState().positionMs).toBe(125_000)
  })

  it('mai multe derulări în același cadru se aplică o singură dată, la ultima', async () => {
    const driver = await loadedDriver()

    driver.seek(300_000)
    driver.seek(10_000)
    driver.seek(45_000)
    expect(useSessionStore.getState().positionMs).toBe(45_000)
    // Până la cadru, bufferul nu s-a mișcat.
    expect(telemetryBuffer.size).toBe(1)

    driver.flush()

    expect(telemetryBuffer.size).toBe(46)
    expect(useTelemetryStore.getState().latest).toBe(sampleAt(45_000))
  })

  it('înapoi: reconstruiește bufferele de la începutul sesiunii', async () => {
    const driver = await loadedDriver()

    driver.seek(300_000)
    driver.flush()
    expect(telemetryBuffer.size).toBe(301)

    driver.seek(60_000)
    driver.flush()

    expect(telemetryBuffer.size).toBe(61)
    expect(telemetryBuffer.lastTime).toBe(BASE_TIME_MS + 60_000)
    expect(useTelemetryStore.getState().latest).toBe(sampleAt(60_000))

    // Nimic din viitor nu rămâne în seriile graficelor.
    const speed = telemetryBuffer.toSeries('vehicle_speed_kph')
    expect(speed.at(-1)?.[0]).toBe(BASE_TIME_MS + 60_000)
    expect(derivedBuffer.lastTime).not.toBeNull()
    expect(derivedBuffer.lastTime as number).toBeLessThanOrEqual(
      BASE_TIME_MS + 60_000,
    )
  })

  it('bilanțurile sunt cele de până la poziție, nu de până unde s-a ajuns cândva', async () => {
    const driver = await loadedDriver()

    driver.seek(300_000)
    driver.flush()
    driver.seek(60_000)
    driver.flush()

    const { totals } = useAnalyticsStore.getState().snapshot
    expect(totals.samples).toBe(61)

    const consumed =
      sampleAt(60_000).signals.energy_consumed_wh -
      samples[0].signals.energy_consumed_wh
    expect(totals.energyConsumedWh).toBeCloseTo(consumed, 6)
  })

  it('seriile derivate stau pe ceasul sesiunii, nu pe cel al browserului', async () => {
    const driver = await loadedDriver()

    driver.seek(90_000)
    driver.flush()

    const points = derivedBuffer.toSeries('calc_ground_speed_kph')
    expect(points.length).toBeGreaterThan(0)
    for (const [time] of points) {
      expect(time).toBeGreaterThanOrEqual(BASE_TIME_MS)
      expect(time).toBeLessThanOrEqual(BASE_TIME_MS + 90_000)
    }
    // Aceeași axă de timp ca seriile măsurate: graficele de pe pagina de
    // statistici și cele de pe prezentare arată același moment.
    expect(derivedBuffer.lastTime).toBe(telemetryBuffer.lastTime)
  })

  it('la o derulare, bufferele refac doar fereastra de istoric a graficelor', async () => {
    const driver = await loadedDriver()

    driver.seek(DURATION_MS)
    driver.flush()

    // Ca în live: zece minute de istoric înaintea poziției, nu toată sesiunea.
    expect(telemetryBuffer.size).toBe(HISTORY_SAMPLES + 1)
    expect(telemetryBuffer.toSeries('vehicle_speed_kph')[0][0]).toBe(
      BASE_TIME_MS + DURATION_MS - HISTORY_SAMPLES * PERIOD_MS,
    )
    expect(telemetryBuffer.lastTime).toBe(BASE_TIME_MS + DURATION_MS)
    // Acumulatorul a văzut însă toată sesiunea.
    expect(useAnalyticsStore.getState().snapshot.totals.samples).toBe(COUNT)
  })

  it('derularea înapoi pornește de la un punct de control, cu același bilanț ca de la zero', async () => {
    const driver = await loadedDriver()

    // Trecerea până la capăt lasă puncte de control în urmă.
    driver.seek(DURATION_MS)
    driver.flush()

    driver.seek(1_000_000)
    driver.flush()

    expect(telemetryBuffer.size).toBe(HISTORY_SAMPLES + 1)
    expect(telemetryBuffer.lastTime).toBe(BASE_TIME_MS + 1_000_000)
    expect(useTelemetryStore.getState().latest).toBe(sampleAt(1_000_000))

    const { totals } = useAnalyticsStore.getState().snapshot
    expect(totals.samples).toBe(1001)

    // Referința: aceeași poziție atinsă direct, fără puncte de control.
    const fresh = await loadedDriver()
    fresh.seek(1_000_000)
    fresh.flush()
    const reference = useAnalyticsStore.getState().snapshot.totals
    expect(totals.distanceKm).toBeCloseTo(reference.distanceKm, 9)
    expect(totals.energyConsumedWh).toBeCloseTo(reference.energyConsumedWh, 9)
    expect(totals.activeSeconds).toBeCloseTo(reference.activeSeconds, 9)
  })

  it('un salt înainte mai mare decât fereastra nu lasă o gaură în grafice', async () => {
    const driver = await loadedDriver()

    driver.seek(60_000)
    driver.flush()
    driver.seek(900_000)
    driver.flush()

    const speed = telemetryBuffer.toSeries('vehicle_speed_kph')
    expect(speed[0][0]).toBe(
      BASE_TIME_MS + 900_000 - HISTORY_SAMPLES * PERIOD_MS,
    )
    expect(speed.at(-1)?.[0]).toBe(BASE_TIME_MS + 900_000)
    expect(telemetryBuffer.size).toBe(HISTORY_SAMPLES + 1)
  })

  it('calitatea semnalelor se raportează la timpul virtual', async () => {
    const driver = await loadedDriver()

    driver.seek(200_000)
    driver.flush()

    const quality = useTelemetryStore.getState().quality
    expect(quality.vehicle_speed_kph?.state).toBe('valid')
    expect(quality.vehicle_speed_kph?.age_ms).toBe(0)
    expect(quality.vehicle_speed_kph?.value).toBe(
      sampleAt(200_000).signals.vehicle_speed_kph,
    )
  })
})

describe('tragerea cursorului', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cât timp cursorul se mișcă, graficele măsurate urmează; cele derivate se completează la oprire', async () => {
    const driver = await loadedDriver()
    expect(derivedBuffer.size).toBe(1)

    // Trei evenimente de slider în același cadru, ca la o tragere reală.
    driver.seek(200_000)
    driver.seek(240_000)
    driver.seek(300_000)
    vi.advanceTimersToNextFrame()

    // Seriile măsurate și cifrele sunt la poziția nouă imediat...
    expect(telemetryBuffer.size).toBe(301)
    expect(useTelemetryStore.getState().latest).toBe(sampleAt(300_000))
    expect(useAnalyticsStore.getState().snapshot.totals.samples).toBe(301)
    // ...dar istoricul derivat, scump, nu s-a calculat încă.
    expect(derivedBuffer.size).toBe(1)

    // Cursorul s-a oprit: istoricul derivat se completează o singură dată.
    vi.advanceTimersByTime(150)

    expect(derivedBuffer.size).toBeGreaterThan(100)
    expect(derivedBuffer.lastTime).toBe(BASE_TIME_MS + 300_000)
    expect(telemetryBuffer.size).toBe(301)
    expect(useTelemetryStore.getState().latest).toBe(sampleAt(300_000))
  })

  it('un pas mic înainte își aduce seriile derivate pe loc', async () => {
    const driver = await loadedDriver()

    driver.seek(10_000)
    vi.advanceTimersToNextFrame()

    expect(derivedBuffer.lastTime).toBe(BASE_TIME_MS + 10_000)
  })
})

describe('redarea', () => {
  it('„Redare" după sfârșit rebobinează bufferele, nu doar cursorul', async () => {
    const driver = await loadedDriver()

    driver.seek(DURATION_MS)
    driver.flush()
    expect(telemetryBuffer.size).toBe(HISTORY_SAMPLES + 1)

    driver.play()
    driver.pause()

    expect(useSessionStore.getState().positionMs).toBe(0)
    expect(telemetryBuffer.size).toBe(1)
    expect(useTelemetryStore.getState().latest).toBe(samples[0])
    expect(useAnalyticsStore.getState().snapshot.totals.samples).toBe(1)
  })
})

describe('ieșirea din replay', () => {
  it('golește bufferele, store-urile și cere reumplerea graficelor live', async () => {
    const driver = await loadedDriver()
    driver.seek(100_000)
    driver.flush()

    const resync = vi.fn()
    const unregister = registerReplayExitHook(resync)

    driver.exit()

    expect(useSessionStore.getState().mode).toBe('live')
    expect(telemetryBuffer.size).toBe(0)
    expect(derivedBuffer.size).toBe(0)
    expect(useTelemetryStore.getState().latest).toBeNull()
    expect(useAnalyticsStore.getState().snapshot.totals.samples).toBe(0)
    expect(resync).toHaveBeenCalledTimes(1)

    unregister()
  })

  it('resetul manual iese fără reumplere: omul a cerut ecran curat', async () => {
    const driver = await loadedDriver()

    const resync = vi.fn()
    const unregister = registerReplayExitHook(resync)

    driver.exit({ resync: false })

    expect(useSessionStore.getState().mode).toBe('live')
    expect(resync).not.toHaveBeenCalled()

    unregister()
  })
})
