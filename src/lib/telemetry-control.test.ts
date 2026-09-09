import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_STATS } from '../schemas/telemetry'
import { useErrorStore } from '../stores/error-store'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { telemetryBuffer } from './telemetry-buffer'
import {
  isTelemetryControlReady,
  registerTelemetryControl,
  resetTelemetry,
} from './telemetry-control'

describe('resetTelemetry', () => {
  beforeEach(() => {
    telemetryBuffer.clear()
    useTelemetryStore.getState().reset()
    useErrorStore.getState().clearAll()
    useSessionStore.getState().exitReplay()
  })

  it('golește bufferul de serii, store-ul și jurnalul de erori', () => {
    telemetryBuffer.push(1000, { vehicle_speed_kph: 61 })
    useTelemetryStore.setState({
      invalidFrames: 4,
      alarms: [],
      acknowledged: ['a1'],
      laps: [
        {
          lap: 1,
          finishedAt: 1000,
          durationS: 90,
          energyWh: 40,
          averageSpeedKph: 55,
        },
      ],
    })
    useErrorStore.getState().sync([
      {
        id: 'alarm:x',
        source: 'alarm',
        severity: 'critical',
        title: 'x',
        message: 'x',
      },
    ])

    resetTelemetry()

    expect(telemetryBuffer.size).toBe(0)
    expect(useTelemetryStore.getState().invalidFrames).toBe(0)
    expect(useTelemetryStore.getState().laps).toEqual([])
    expect(useTelemetryStore.getState().acknowledged).toEqual([])
    expect(useErrorStore.getState().entries).toEqual([])
  })

  it('reține contoarele serverului ca linie de bază', () => {
    // Contoarele vin cumulate de pe server: singurul „zero" posibil din browser
    // este diferența față de momentul resetării.
    useTelemetryStore.setState({
      stats: { ...EMPTY_STATS, received: 357, dropped: 9 },
    })

    resetTelemetry()

    expect(useTelemetryStore.getState().statsBaseline?.received).toBe(357)
  })

  it('cere clientului o reconectare imediată', () => {
    const reconnect = vi.fn()
    const unregister = registerTelemetryControl({ reconnect })

    expect(isTelemetryControlReady()).toBe(true)
    resetTelemetry()
    expect(reconnect).toHaveBeenCalledTimes(1)

    unregister()
    expect(isTelemetryControlReady()).toBe(false)
  })

  it('funcționează și fără client înregistrat', () => {
    // La primul randare a paginii, hookul se poate să nu se fi montat încă;
    // butonul trebuie să golească datele, nu să arunce.
    expect(() => resetTelemetry()).not.toThrow()
  })

  it('închide redarea unei sesiuni și revine pe live', () => {
    useSessionStore.setState({ mode: 'replay', playing: true, positionMs: 500 })

    resetTelemetry()

    expect(useSessionStore.getState().mode).toBe('live')
    expect(useSessionStore.getState().playing).toBe(false)
  })

  it('nu oprește înregistrarea de pe server', () => {
    useTelemetryStore.setState({ recordingSessionId: 'sess-1' })

    resetTelemetry()

    // Butonul curăță un ecran, nu o cursă.
    expect(useTelemetryStore.getState().recordingSessionId).toBe('sess-1')
  })
})
