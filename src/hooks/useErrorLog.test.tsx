import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Alarm } from '../schemas/telemetry'
import { useErrorStore } from '../stores/error-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import {
  makeQuality,
  makeSignal,
  resetTelemetryStore,
  seedTelemetry,
} from '../test/fixtures'
import { useErrorLog } from './useErrorLog'

const alarma: Alarm = {
  id: 'pack-hot',
  key: 'battery_temp_max_c_high',
  label: 'Pachet supraîncălzit',
  severity: 'critical',
  message: '61 °C peste pragul de 58 °C.',
  signal_key: 'battery_temp_max_c',
  value: 61,
  threshold: 58,
  raised_at: '2026-09-19T00:00:00+03:00',
  cleared_at: null,
  active: true,
}

describe('useErrorLog', () => {
  beforeEach(() => {
    useErrorStore.getState().clearAll()
    seedTelemetry(
      [
        makeSignal({ key: 'battery_temp_max_c', group: 'thermal' }),
        makeSignal({ key: 'motor_rpm', group: 'motor' }),
      ],
      { motor_rpm: makeQuality('sensor_error', null) },
    )
    useTelemetryStore.setState({ alarms: [alarma], connection: 'connected' })
  })

  afterEach(() => {
    resetTelemetryStore()
    useErrorStore.getState().clearAll()
  })

  it('păstrează semnalul alarmei, ca eroarea să poată duce la el', () => {
    renderHook(() => useErrorLog())

    const entry = useErrorStore
      .getState()
      .entries.find((candidate) => candidate.id === 'alarm:pack-hot')
    expect(entry?.signalKey).toBe('battery_temp_max_c')
  })

  it('o alarmă fără semnal rămâne fără signalKey, nu cu null', () => {
    useTelemetryStore.setState({ alarms: [{ ...alarma, signal_key: null }] })
    renderHook(() => useErrorLog())

    const entry = useErrorStore
      .getState()
      .entries.find((candidate) => candidate.id === 'alarm:pack-hot')
    expect(entry).toBeDefined()
    expect(entry?.signalKey).toBeUndefined()
  })

  it('un senzor defect poartă cheia semnalului', () => {
    renderHook(() => useErrorLog())

    const entry = useErrorStore
      .getState()
      .entries.find((candidate) => candidate.id === 'signal:motor_rpm')
    expect(entry).toMatchObject({
      source: 'signal',
      signalKey: 'motor_rpm',
      title: 'Senzor defect: motor_rpm',
    })
  })
})
