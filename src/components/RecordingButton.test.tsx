import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { resetTelemetryStore } from '../test/fixtures'
import { RecordingButton } from './RecordingButton'

const startSession = vi.fn()
const stopSession = vi.fn()
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  startSession: (note: string) => startSession(note),
  stopSession: () => stopSession(),
}))

function sessionInfo(id: string) {
  return {
    id,
    vehicle_id: 'solar-car-01',
    started_at: '2026-09-18T10:00:00Z',
    ended_at: null,
    sample_count: 0,
    alarm_count: 0,
    note: '',
  }
}

function renderButton() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={client}>
      <RecordingButton />
    </QueryClientProvider>,
  )
}

function recordingSessionId() {
  return useTelemetryStore.getState().recordingSessionId
}

describe('RecordingButton', () => {
  beforeEach(() => {
    startSession.mockReset()
    stopSession.mockReset()
    useTelemetryStore.setState({ recordingSessionId: null })
    useSessionStore.setState({ mode: 'live' })
  })

  afterEach(() => {
    resetTelemetryStore()
    useTelemetryStore.setState({ recordingSessionId: null })
    useSessionStore.getState().exitReplay()
  })

  it('pornește înregistrarea și trece în starea „în curs" fără să aștepte un cadru', async () => {
    const user = userEvent.setup()
    startSession.mockResolvedValue(sessionInfo('solar-car-01-20260918-100000'))
    renderButton()

    await user.click(screen.getByTestId('recording-start'))

    await waitFor(() =>
      expect(screen.getByTestId('recording-stop')).toBeInTheDocument(),
    )
    expect(startSession).toHaveBeenCalledWith('')
    expect(recordingSessionId()).toBe('solar-car-01-20260918-100000')
  })

  it('reflectă starea primită prin cadrele WebSocket', () => {
    useTelemetryStore.setState({ recordingSessionId: 'din-cadru' })
    renderButton()

    expect(screen.getByTestId('recording-stop')).toHaveAttribute(
      'title',
      'Sesiune: din-cadru',
    )
  })

  it('nu oprește la prima apăsare, ci cere confirmare', async () => {
    const user = userEvent.setup()
    useTelemetryStore.setState({ recordingSessionId: 's1' })
    renderButton()

    await user.click(screen.getByTestId('recording-stop'))

    expect(stopSession).not.toHaveBeenCalled()
    expect(screen.getByTestId('recording-stop-confirm')).toBeInTheDocument()
  })

  it('oprește după confirmare și golește starea locală', async () => {
    const user = userEvent.setup()
    stopSession.mockResolvedValue({
      ...sessionInfo('s1'),
      ended_at: '2026-09-18T10:30:00Z',
    })
    useTelemetryStore.setState({ recordingSessionId: 's1' })
    renderButton()

    await user.click(screen.getByTestId('recording-stop'))
    await user.click(screen.getByTestId('recording-stop-confirm'))

    await waitFor(() => expect(recordingSessionId()).toBeNull())
    expect(stopSession).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('recording-start')).toBeInTheDocument()
  })

  it('se poate renunța la oprire', async () => {
    const user = userEvent.setup()
    useTelemetryStore.setState({ recordingSessionId: 's1' })
    renderButton()

    await user.click(screen.getByTestId('recording-stop'))
    await user.click(screen.getByRole('button', { name: 'Renunță la oprire' }))

    expect(stopSession).not.toHaveBeenCalled()
    expect(screen.getByTestId('recording-stop')).toBeInTheDocument()
  })

  it('dezarmează confirmarea singură după câteva secunde', () => {
    vi.useFakeTimers()

    try {
      useTelemetryStore.setState({ recordingSessionId: 's1' })
      renderButton()
      // `fireEvent`, nu `userEvent`: al doilea își programează propriile
      // așteptări și se blochează sub ceasuri false.
      fireEvent.click(screen.getByTestId('recording-stop'))
      expect(screen.getByTestId('recording-stop-confirm')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(5000))
      expect(screen.getByTestId('recording-stop')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('explică lipsa tokenului când serverul răspunde 401', async () => {
    const user = userEvent.setup()
    startSession.mockRejectedValue(
      new ApiError('Token lipsă sau invalid.', 401),
    )
    renderButton()

    await user.click(screen.getByTestId('recording-start'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/VITE_API_TOKEN/)
    expect(recordingSessionId()).toBeNull()
    expect(screen.getByTestId('recording-start')).toBeInTheDocument()
  })

  it('aliniază starea locală când serverul spune că nu înregistra (409)', async () => {
    const user = userEvent.setup()
    stopSession.mockRejectedValue(
      new ApiError('Nu există o înregistrare activă.', 409),
    )
    useTelemetryStore.setState({ recordingSessionId: 'veche' })
    renderButton()

    await user.click(screen.getByTestId('recording-stop'))
    await user.click(screen.getByTestId('recording-stop-confirm'))

    await waitFor(() => expect(recordingSessionId()).toBeNull())
    expect(screen.getByRole('alert')).toHaveTextContent(
      /nicio înregistrare activă/,
    )
  })

  it('nu apare în modul de redare', () => {
    useSessionStore.setState({ mode: 'replay' })
    renderButton()

    expect(screen.queryByTestId('recording-control')).not.toBeInTheDocument()
  })
})
