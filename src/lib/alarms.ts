import { SIGNAL_LIST, type SignalDefinition } from '../config/signals'
import type {
  Alarm,
  AlarmSeverity,
  NormalizedSignals,
} from '../schemas/telemetry'
import { formatSignal } from './format'

/**
 * Evaluarea pragurilor în browser.
 *
 * Decizia tehnică #5 din documentul de arhitectură cere ca alarmele să fie
 * calculate pe server și înregistrate în istoricul sesiunii. Până când
 * backendul face asta, evaluăm local aceleași praguri, iar alarmele primite de
 * la server au prioritate — vezi `mergeAlarms`.
 */

type Breach = {
  severity: AlarmSeverity
  boundary: number
  direction: 'sub' | 'peste'
}

/**
 * Severitatea unei valori față de pragurile semnalului, fără a construi o
 * alarmă. Folosită de carduri pentru a-și alege culoarea.
 */
export function signalSeverity(
  definition: SignalDefinition,
  value: number | null,
): AlarmSeverity | null {
  if (value === null) return null
  return evaluateThresholds(definition, value)?.severity ?? null
}

function evaluateThresholds(
  definition: SignalDefinition,
  value: number,
): Breach | null {
  const t = definition.thresholds
  if (!t) return null

  if (t.criticalMin !== undefined && value < t.criticalMin) {
    return { severity: 'critical', boundary: t.criticalMin, direction: 'sub' }
  }
  if (t.criticalMax !== undefined && value > t.criticalMax) {
    return { severity: 'critical', boundary: t.criticalMax, direction: 'peste' }
  }
  if (t.warnMin !== undefined && value < t.warnMin) {
    return { severity: 'warning', boundary: t.warnMin, direction: 'sub' }
  }
  if (t.warnMax !== undefined && value > t.warnMax) {
    return { severity: 'warning', boundary: t.warnMax, direction: 'peste' }
  }
  return null
}

export function evaluateAlarms(
  signals: NormalizedSignals,
  now: number = Date.now(),
): Alarm[] {
  const alarms: Alarm[] = []
  const since = new Date(now).toISOString()

  for (const definition of SIGNAL_LIST) {
    const signal = signals[definition.key]
    if (!signal) continue

    if (signal.quality === 'error') {
      alarms.push({
        id: `signal-error:${definition.key}`,
        severity: 'warning',
        signal: definition.key,
        title: `Eroare senzor · ${definition.label}`,
        detail: 'Computerul de bord raportează o eroare pentru acest semnal.',
        since,
      })
      continue
    }

    if (signal.value === null) continue

    const breach = evaluateThresholds(definition, signal.value)
    if (!breach) continue

    alarms.push({
      id: `threshold:${definition.key}`,
      severity: breach.severity,
      signal: definition.key,
      title: `${definition.label} ${breach.direction} prag`,
      detail: `${formatSignal(signal.value, definition)} (prag ${formatSignal(breach.boundary, definition)})`,
      since,
    })
  }

  return sortAlarms(alarms)
}

const SEVERITY_ORDER: Record<AlarmSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

export function sortAlarms(alarms: Alarm[]): Alarm[] {
  return [...alarms].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
}

/**
 * Combină alarmele calculate local cu cele venite de la server. Când aceeași
 * alarmă apare în ambele surse, versiunea serverului câștigă, pentru că ea este
 * cea înregistrată în istoricul sesiunii.
 */
export function mergeAlarms(local: Alarm[], remote: Alarm[]): Alarm[] {
  const byId = new Map<string, Alarm>()
  for (const alarm of local) byId.set(alarm.id, alarm)
  for (const alarm of remote) byId.set(alarm.id, alarm)
  return sortAlarms([...byId.values()])
}

/**
 * Alarma dedicată pierderii comunicației. Este separată de praguri pentru că nu
 * depinde de valoarea unui semnal, ci de vechimea ultimului mesaj.
 */
export function connectionAlarm(
  ageMs: number | null,
  staleAfterMs: number,
  lostAfterMs: number,
): Alarm | null {
  if (ageMs === null) return null
  if (ageMs >= lostAfterMs) {
    return {
      id: 'connection:lost',
      severity: 'critical',
      title: 'Comunicație pierdută',
      detail: 'Nu s-au mai primit mesaje de la mașină.',
    }
  }
  if (ageMs >= staleAfterMs) {
    return {
      id: 'connection:stale',
      severity: 'warning',
      title: 'Date învechite',
      detail: 'Ultimul mesaj este mai vechi decât intervalul așteptat.',
    }
  }
  return null
}
