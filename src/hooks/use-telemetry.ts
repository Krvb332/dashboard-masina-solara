import { useMemo } from 'react'
import { env } from '../config/env'
import { connectionAlarm, evaluateAlarms, mergeAlarms } from '../lib/alarms'
import type { Alarm, NormalizedSignal } from '../schemas/telemetry'
import { selectSignal, useTelemetryStore } from '../stores/telemetry-store'
import { useNow } from './use-now'

/** Valoarea curentă a unui semnal, cu calitatea raportată de mașină. */
export function useSignal(key: string): NormalizedSignal {
  const signals = useTelemetryStore((state) => state.signals)
  return selectSignal(signals, key)
}

export type DataFreshness = {
  /** Vechimea ultimului mesaj, în milisecunde. `null` dacă nu a sosit niciunul. */
  ageMs: number | null
  isStale: boolean
  isLost: boolean
  /** `true` cât timp nu am primit încă niciun cadru. */
  isEmpty: boolean
}

export function useFreshness(): DataFreshness {
  const receivedAt = useTelemetryStore((state) => state.meta?.receivedAt ?? null)
  const now = useNow(250)

  return useMemo(() => {
    if (receivedAt === null) {
      return { ageMs: null, isStale: false, isLost: false, isEmpty: true }
    }
    const ageMs = Math.max(0, now - receivedAt)
    return {
      ageMs,
      isStale: ageMs >= env.staleAfterMs,
      isLost: ageMs >= env.connectionLostAfterMs,
      isEmpty: false,
    }
  }, [receivedAt, now])
}

/**
 * Un semnal este considerat utilizabil doar dacă are valoare, calitatea este
 * `valid` și fluxul de date nu este învechit. Astfel `0` rămâne o valoare
 * reală, distinctă de „nu mai primesc date".
 */
export function useLiveSignal(key: string): NormalizedSignal & {
  isStale: boolean
} {
  const signal = useSignal(key)
  const { isStale, isEmpty } = useFreshness()
  return { ...signal, isStale: isStale || isEmpty }
}

/**
 * Alarmele afișate: praguri evaluate local, alarmele venite de la server (care
 * au prioritate) și starea comunicației.
 */
export function useAlarms(): Alarm[] {
  const signals = useTelemetryStore((state) => state.signals)
  const serverAlarms = useTelemetryStore((state) => state.serverAlarms)
  const { ageMs, isEmpty } = useFreshness()

  return useMemo(() => {
    const local = signals ? evaluateAlarms(signals) : []
    const merged = mergeAlarms(local, serverAlarms)

    const connection = isEmpty
      ? null
      : connectionAlarm(ageMs, env.staleAfterMs, env.connectionLostAfterMs)

    return connection ? [connection, ...merged] : merged
  }, [signals, serverAlarms, ageMs, isEmpty])
}

export function useAlarmCounts() {
  const alarms = useAlarms()
  return useMemo(
    () => ({
      critical: alarms.filter((alarm) => alarm.severity === 'critical').length,
      warning: alarms.filter((alarm) => alarm.severity === 'warning').length,
      info: alarms.filter((alarm) => alarm.severity === 'info').length,
      total: alarms.length,
    }),
    [alarms],
  )
}
