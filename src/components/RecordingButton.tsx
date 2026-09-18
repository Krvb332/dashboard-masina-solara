import { Check, CircleStop, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useRecording } from '../hooks/useRecording'
import { useSessionStore } from '../stores/session-store'

/**
 * Pornirea și oprirea înregistrării, la un clic distanță din orice pagină.
 *
 * Stă în antet, lângă pilot, din același motiv ca schimbarea pilotului: se
 * apasă sub presiune de timp, iar drumul până la pagina „Sesiuni" costă exact
 * secundele de la începutul stintului. Oprirea cere confirmare — o apăsare
 * greșită ar tăia înregistrarea în mijlocul cursei — iar butonul armat se
 * dezarmează singur, ca să nu rămână o apăsare accidentală în așteptare.
 */

/** Cât timp rămâne cerută confirmarea opririi înainte să se anuleze singură. */
const CONFIRM_TIMEOUT_MS = 5000

export function RecordingButton() {
  const mode = useSessionStore((state) => state.mode)
  const {
    recordingSessionId,
    isRecording,
    isStarting,
    isStopping,
    error,
    start,
    stop,
    clearError,
  } = useRecording()

  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => clearTimer, [])

  const arm = () => {
    clearTimer()
    setConfirming(true)
    timer.current = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS)
  }

  const disarm = () => {
    clearTimer()
    setConfirming(false)
  }

  // În redare, cadrele live nu mai ajung în store, deci starea înregistrării
  // ar fi cea de dinainte de a intra în redare, nu cea reală.
  if (mode !== 'live') return null

  return (
    <div
      className="relative flex items-center gap-2"
      data-testid="recording-control"
    >
      {!isRecording ? (
        <button
          type="button"
          onClick={() => start()}
          disabled={isStarting}
          aria-label="Pornește înregistrarea"
          title="Pornește înregistrarea sesiunii pe server"
          className="flex min-h-11 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm text-zinc-200 transition-colors hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-100 disabled:opacity-60"
          data-testid="recording-start"
        >
          <span
            className="size-2.5 shrink-0 rounded-full bg-rose-500"
            aria-hidden="true"
          />
          <span className="hidden sm:inline">
            {isStarting ? 'Se pornește…' : 'Înregistrează'}
          </span>
        </button>
      ) : confirming ? (
        <>
          <span className="hidden text-xs text-zinc-400 md:inline">
            Oprești înregistrarea?
          </span>
          <button
            type="button"
            onClick={() => {
              disarm()
              stop()
            }}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3 text-sm font-medium text-rose-100 transition-colors hover:bg-rose-500/25"
            data-testid="recording-stop-confirm"
          >
            <Check size={15} aria-hidden="true" />
            Confirmă
          </button>
          <button
            type="button"
            onClick={disarm}
            aria-label="Renunță la oprire"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={arm}
          disabled={isStopping}
          aria-label="Oprește înregistrarea"
          title={`Sesiune: ${recordingSessionId}`}
          className="flex min-h-11 items-center gap-2.5 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3 text-sm font-medium text-rose-100 transition-colors hover:bg-rose-500/25 disabled:opacity-60"
          data-testid="recording-stop"
        >
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-rose-500" />
          </span>
          <span className="hidden sm:inline">
            {isStopping ? 'Se oprește…' : 'Înregistrare'}
          </span>
          <CircleStop size={15} aria-hidden="true" />
        </button>
      )}

      {error && (
        // Popover, nu text în rând: antetul e deja plin, iar un mesaj de trei
        // rânduri intercalat între butoane ar împinge totul pe două rânduri.
        <p
          role="alert"
          className="absolute top-full left-0 z-40 mt-2 flex w-72 items-start gap-2 rounded-xl border border-rose-400/30 bg-zinc-950 p-3 text-xs leading-snug text-rose-200 shadow-2xl shadow-black/50"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Închide mesajul de eroare"
            className="-m-1 shrink-0 rounded p-1 text-rose-300/70 hover:text-rose-100"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </p>
      )}
    </div>
  )
}
