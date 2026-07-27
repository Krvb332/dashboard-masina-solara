import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConnectionBadge } from './ConnectionBadge'
import { useTelemetryStore } from '../stores/telemetry-store'

/** Publică un cadru primit cu `ageMs` milisecunde în urmă. */
function publishAged(ageMs: number) {
  const store = useTelemetryStore.getState()
  store.ingestFrame(
    {
      schema_version: 1,
      vehicle_id: 'tucn-solar-01',
      session_id: 'test',
      timestamp: new Date().toISOString(),
      sequence: 1,
      signals: { battery_soc_pct: 76.2 },
    },
    Date.now() - ageMs,
  )
  store.commit()
  store.setStatus('connected')
}

describe('ConnectionBadge', () => {
  beforeEach(() => {
    useTelemetryStore.getState().reset()
    useTelemetryStore.getState().setStatus('idle')
  })

  it('anunță așteptarea datelor cât timp nu a sosit niciun cadru', () => {
    useTelemetryStore.getState().setStatus('connected')
    render(<ConnectionBadge />)

    expect(screen.getByRole('status')).toHaveTextContent('Se așteaptă date')
  })

  it('confirmă legătura când datele sunt proaspete', () => {
    publishAged(100)
    render(<ConnectionBadge />)

    expect(screen.getByRole('status')).toHaveTextContent('Telemetrie conectată')
  })

  it('avertizează când datele sunt învechite, deși socketul este deschis', () => {
    publishAged(3_000)
    render(<ConnectionBadge />)

    // Transportul raportează „connected", dar vechimea are prioritate.
    expect(useTelemetryStore.getState().connection).toBe('connected')
    expect(screen.getByRole('status')).toHaveTextContent('Date învechite')
  })

  it('escaladează la „fără date" după pragul de pierdere', () => {
    publishAged(10_000)
    render(<ConnectionBadge />)

    expect(screen.getByRole('status')).toHaveTextContent('Fără date')
  })

  it('afișează starea de reconectare', () => {
    useTelemetryStore.getState().setStatus('reconnecting')
    render(<ConnectionBadge />)

    expect(screen.getByRole('status')).toHaveTextContent('Reconectare')
  })
})
