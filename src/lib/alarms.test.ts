import { describe, expect, it } from 'vitest'
import {
  connectionAlarm,
  evaluateAlarms,
  mergeAlarms,
  signalSeverity,
} from './alarms'
import { SIGNALS } from '../config/signals'
import type { Alarm, NormalizedSignals } from '../schemas/telemetry'

function signals(values: Record<string, number | null>): NormalizedSignals {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { value, quality: value === null ? 'unavailable' : 'valid' },
    ]),
  ) as NormalizedSignals
}

describe('signalSeverity', () => {
  it('semnalează critic sub pragul critic', () => {
    expect(signalSeverity(SIGNALS.battery_soc_pct, 8)).toBe('critical')
  })

  it('semnalează avertizare între praguri', () => {
    expect(signalSeverity(SIGNALS.battery_soc_pct, 20)).toBe('warning')
  })

  it('nu semnalează nimic în intervalul normal', () => {
    expect(signalSeverity(SIGNALS.battery_soc_pct, 76)).toBeNull()
  })

  it('nu semnalează nimic fără valoare', () => {
    expect(signalSeverity(SIGNALS.battery_soc_pct, null)).toBeNull()
  })
})

describe('evaluateAlarms', () => {
  it('ordonează alarmele critice înaintea avertizărilor', () => {
    const alarms = evaluateAlarms(
      signals({ battery_soc_pct: 8, gps_accuracy_m: 7 }),
    )

    expect(alarms).toHaveLength(2)
    expect(alarms[0]?.severity).toBe('critical')
    expect(alarms[1]?.severity).toBe('warning')
  })

  it('nu confundă zero cu lipsa datelor', () => {
    // 0 A este o valoare validă și nu depășește niciun prag.
    expect(evaluateAlarms(signals({ battery_current_a: 0 }))).toHaveLength(0)
    // Absența valorii nu trebuie să genereze o alarmă de prag.
    expect(evaluateAlarms(signals({ battery_current_a: null }))).toHaveLength(0)
  })

  it('raportează erorile de senzor separat de praguri', () => {
    const alarms = evaluateAlarms({
      motor_temp_c: { value: 40, quality: 'error' },
    })

    expect(alarms[0]?.id).toBe('signal-error:motor_temp_c')
  })
})

describe('mergeAlarms', () => {
  it('lasă alarma serverului să câștige la același identificator', () => {
    const local: Alarm[] = [
      { id: 'threshold:x', severity: 'warning', title: 'local' },
    ]
    const remote: Alarm[] = [
      { id: 'threshold:x', severity: 'critical', title: 'server' },
    ]

    const merged = mergeAlarms(local, remote)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.title).toBe('server')
  })
})

describe('connectionAlarm', () => {
  it('nu alarmează cât timp datele sunt proaspete', () => {
    expect(connectionAlarm(500, 2_000, 6_000)).toBeNull()
  })

  it('avertizează la date învechite', () => {
    expect(connectionAlarm(3_000, 2_000, 6_000)?.severity).toBe('warning')
  })

  it('escaladează la critic când legătura este pierdută', () => {
    expect(connectionAlarm(9_000, 2_000, 6_000)?.severity).toBe('critical')
  })
})
