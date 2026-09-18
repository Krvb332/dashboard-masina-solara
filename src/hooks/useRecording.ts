import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, startSession, stopSession } from '../lib/api'
import { describeRecordingError } from '../lib/recording'
import { useTelemetryStore } from '../stores/telemetry-store'

export const SESSIONS_QUERY_KEY = ['sessions'] as const

/**
 * Pornirea și oprirea înregistrării, cu aceeași logică în antet și în pagina
 * „Sesiuni".
 *
 * Starea „se înregistrează" vine în mod normal prin cadrele WebSocket
 * (`recording_session_id`). Răspunsul serverului la start/stop este însă
 * același adevăr, sosit mai devreme: îl scriem direct în store ca butonul să
 * își schimbe starea imediat, nu la următorul cadru — și să o schimbe chiar
 * dacă fluxul live e căzut, caz în care înregistrarea de pe server continuă
 * oricum. Următorul cadru confirmă sau corectează.
 */
export function useRecording() {
  const queryClient = useQueryClient()
  const recordingSessionId = useTelemetryStore(
    (state) => state.recordingSessionId,
  )
  const setRecordingSession = useTelemetryStore(
    (state) => state.setRecordingSession,
  )

  // O singură eroare, a ultimei operații: altfel un eșec vechi la oprire ar
  // rămâne afișat după o pornire reușită.
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY })
  }

  const start = useMutation({
    mutationFn: (note: string) => startSession(note),
    onMutate: () => setError(null),
    onSuccess: (session) => {
      setRecordingSession(session.id)
      invalidate()
    },
    onError: (failure) => setError(describeRecordingError(failure)),
  })

  const stop = useMutation({
    mutationFn: () => stopSession(),
    onMutate: () => setError(null),
    onSuccess: () => {
      setRecordingSession(null)
      invalidate()
    },
    onError: (failure) => {
      setError(describeRecordingError(failure))
      // 409 = serverul nu are nicio înregistrare activă: starea locală era
      // veche (de exemplu oprită din alt browser), o aliniem.
      if (failure instanceof ApiError && failure.status === 409) {
        setRecordingSession(null)
        invalidate()
      }
    },
  })

  return {
    recordingSessionId,
    isRecording: recordingSessionId !== null,
    isStarting: start.isPending,
    isStopping: stop.isPending,
    error,
    start: (note = '') => start.mutate(note),
    stop: () => stop.mutate(),
    clearError: () => setError(null),
  }
}
