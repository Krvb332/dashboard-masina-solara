import clsx from 'clsx'
import { FlaskConical, Radio } from 'lucide-react'
import { env } from '../../config/env'
import { useTelemetryStore } from '../../stores/telemetry-store'

/**
 * Comutator între serverul real și simulator.
 *
 * Este util în pitlane: dacă legătura cu mașina cade în timpul unei prezentări
 * sau al unui test, interfața poate fi trecută pe date simulate fără repornire,
 * iar diferența rămâne vizibilă pe ecran.
 */
export function SourceSwitch() {
  const sourceKind = useTelemetryStore((state) => state.sourceKind)
  const sourceLabel = useTelemetryStore((state) => state.sourceLabel)
  const setSource = useTelemetryStore((state) => state.setSource)
  const reset = useTelemetryStore((state) => state.reset)

  const isSimulator = sourceKind === 'simulator'
  const canUseWebSocket = env.wsUrl !== ''

  function switchTo(kind: 'websocket' | 'simulator') {
    if (kind === sourceKind) return
    reset()
    setSource(kind, '')
  }

  return (
    <div className="mt-auto rounded-xl border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-center gap-2 text-sm text-zinc-300">
        {isSimulator ? (
          <FlaskConical size={16} className="text-amber-400" aria-hidden="true" />
        ) : (
          <Radio size={16} className="text-emerald-400" aria-hidden="true" />
        )}
        {isSimulator ? 'Date simulate' : 'Server telemetrie'}
      </div>

      <p className="mt-2 truncate text-xs text-zinc-500" title={sourceLabel}>
        {sourceLabel || 'neconfigurat'}
      </p>

      <div
        className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-black/25 p-1"
        role="group"
        aria-label="Sursa de telemetrie"
      >
        <button
          type="button"
          onClick={() => switchTo('websocket')}
          disabled={!canUseWebSocket}
          aria-pressed={!isSimulator}
          title={
            canUseWebSocket
              ? undefined
              : 'Setează VITE_WS_URL pentru a folosi serverul'
          }
          className={clsx(
            'min-h-9 rounded-md px-2 text-xs font-medium transition-colors',
            !isSimulator
              ? 'bg-blue-500/20 text-blue-100'
              : 'text-zinc-400 hover:text-white',
            !canUseWebSocket && 'cursor-not-allowed opacity-40 hover:text-zinc-400',
          )}
        >
          Server
        </button>
        <button
          type="button"
          onClick={() => switchTo('simulator')}
          aria-pressed={isSimulator}
          className={clsx(
            'min-h-9 rounded-md px-2 text-xs font-medium transition-colors',
            isSimulator
              ? 'bg-amber-500/20 text-amber-100'
              : 'text-zinc-400 hover:text-white',
          )}
        >
          Simulator
        </button>
      </div>
    </div>
  )
}
