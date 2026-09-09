import clsx from 'clsx'
import { Check, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { resetTelemetry } from '../lib/telemetry-control'

/**
 * Repornește afișajul: date la zero, legătură refăcută pe loc.
 *
 * Confirmarea este în doi pași, nu într-un `confirm()` de browser. Butonul
 * aruncă zece minute de grafic și tot istoricul de tururi, iar în pitlane se
 * apasă cu mănuși pe un ecran mic — o apăsare greșită nu trebuie să coste o
 * cursă. Al doilea pas expiră singur, ca butonul să nu rămână „armat".
 */

/** Cât timp rămâne cerută confirmarea înainte să se anuleze singură. */
const CONFIRM_TIMEOUT_MS = 5000

/** Cât ține mesajul de reușită. */
const DONE_TIMEOUT_MS = 2500

type Phase = 'idle' | 'confirming' | 'done'

export function SystemResetButton() {
  const [phase, setPhase] = useState<Phase>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedule = (next: Phase, delay: number) => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setPhase(next), delay)
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const handleConfirm = () => {
    resetTelemetry()
    setPhase('done')
    schedule('idle', DONE_TIMEOUT_MS)
  }

  if (phase === 'done') {
    return (
      <p
        className="flex min-h-9 items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 text-sm text-emerald-200"
        role="status"
      >
        <Check size={15} aria-hidden="true" />
        Date golite, legătura repornită
      </p>
    )
  }

  if (phase === 'confirming') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400">Se pierde tot istoricul.</span>
        <button
          type="button"
          onClick={handleConfirm}
          className="flex min-h-9 items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/15 px-3 text-sm font-medium text-rose-100 transition-colors hover:bg-rose-500/25"
          data-testid="system-reset-confirm"
        >
          <Check size={15} aria-hidden="true" />
          Confirmă
        </button>
        <button
          type="button"
          onClick={() => setPhase('idle')}
          className="grid size-9 place-items-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Renunță la resetare"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setPhase('confirming')
        schedule('idle', CONFIRM_TIMEOUT_MS)
      }}
      className={clsx(
        'flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-zinc-300 transition-colors',
        'hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-100',
      )}
      data-testid="system-reset"
    >
      <RotateCcw size={15} aria-hidden="true" />
      Resetează sistemul
    </button>
  )
}
