import clsx from 'clsx'
import { Pause, Play, SkipBack, X } from 'lucide-react'
import { formatDuration } from '../lib/format'
import { replayDriver } from '../lib/replay-driver'
import { REPLAY_SPEEDS, useSessionStore } from '../stores/session-store'

/** Bara de control a redării. Vizibilă doar în modul replay. */
export function ReplayControls() {
  const session = useSessionStore((state) => state.session)
  const playing = useSessionStore((state) => state.playing)
  const speed = useSessionStore((state) => state.speed)
  const positionMs = useSessionStore((state) => state.positionMs)
  const durationMs = useSessionStore((state) => state.durationMs)
  const setSpeed = useSessionStore((state) => state.setSpeed)

  return (
    <section
      className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-4"
      aria-label="Control redare"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (playing ? replayDriver.pause() : replayDriver.play())}
          className="grid size-11 place-items-center rounded-xl bg-violet-500/25 text-violet-100 transition-colors hover:bg-violet-500/40"
          aria-label={playing ? 'Pauză' : 'Redare'}
        >
          {playing ? (
            <Pause size={18} aria-hidden="true" />
          ) : (
            <Play size={18} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() => replayDriver.seek(0)}
          className="grid size-11 place-items-center rounded-xl bg-white/5 text-zinc-300 transition-colors hover:bg-white/10"
          aria-label="Înapoi la început"
        >
          <SkipBack size={18} aria-hidden="true" />
        </button>

        <span className="font-mono text-sm text-zinc-300 tabular-nums">
          {formatDuration(positionMs / 1000)} /{' '}
          {formatDuration(durationMs / 1000)}
        </span>

        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Viteză redare"
        >
          {REPLAY_SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSpeed(option)}
              aria-pressed={speed === option}
              className={clsx(
                'min-h-9 rounded-lg px-3 text-sm font-medium transition-colors',
                speed === option
                  ? 'bg-violet-500/30 text-violet-100'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-white',
              )}
            >
              {option}×
            </button>
          ))}
        </div>

        <p className="truncate text-xs text-zinc-500">{session?.id}</p>

        <button
          type="button"
          onClick={() => replayDriver.exit()}
          className="ml-auto flex min-h-11 items-center gap-2 rounded-xl bg-white/5 px-4 text-sm text-zinc-300 transition-colors hover:bg-white/10"
        >
          <X size={16} aria-hidden="true" />
          Înapoi la live
        </button>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Poziția în înregistrare</span>
        <input
          type="range"
          min={0}
          max={Math.max(durationMs, 1)}
          step={100}
          value={positionMs}
          onChange={(event) => replayDriver.seek(Number(event.target.value))}
          className="w-full accent-violet-400"
        />
      </label>
    </section>
  )
}
