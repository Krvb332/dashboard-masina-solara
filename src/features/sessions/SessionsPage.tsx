import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CircleStop, Download, Play, Radio } from 'lucide-react'
import { useState } from 'react'
import { Panel } from '../../components/Panel'
import {
  exportUrl,
  fetchSessions,
  startSession,
  stopSession,
} from '../../lib/api'
import { formatDateTime, formatDuration, formatNumber } from '../../lib/format'
import { replayDriver } from '../../lib/replay-driver'
import type { SessionInfo } from '../../schemas/telemetry'
import { useSessionStore } from '../../stores/session-store'
import { useTelemetryStore } from '../../stores/telemetry-store'

/**
 * Sesiuni: pornirea și oprirea înregistrării, redarea și exportul CSV.
 *
 * Înregistrarea rulează pe server, deci continuă chiar dacă browserul se
 * închide - dashboardul nu trebuie să fie o dependență a colectării de date.
 */
export function SessionsPage() {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const recordingSessionId = useTelemetryStore(
    (state) => state.recordingSessionId,
  )
  const replaySession = useSessionStore((state) => state.session)
  const loading = useSessionStore((state) => state.loading)
  const error = useSessionStore((state) => state.error)

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchSessions(50),
    refetchInterval: 10_000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  const start = useMutation({
    mutationFn: () => startSession(note),
    onSuccess: () => {
      setNote('')
      invalidate()
    },
  })

  const stop = useMutation({ mutationFn: stopSession, onSuccess: invalidate })

  return (
    <>
      <section className="mt-7">
        <Panel
          title="Înregistrare"
          subtitle={
            recordingSessionId
              ? `Sesiune activă: ${recordingSessionId}`
              : 'Nicio înregistrare în curs'
          }
        >
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Notă (opțional): tur de probă, cursă, test frâne…"
              disabled={Boolean(recordingSessionId)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white placeholder:text-zinc-600 disabled:opacity-50"
            />

            {recordingSessionId ? (
              <button
                type="button"
                onClick={() => stop.mutate()}
                disabled={stop.isPending}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
              >
                <CircleStop size={16} aria-hidden="true" />
                Oprește înregistrarea
              </button>
            ) : (
              <button
                type="button"
                onClick={() => start.mutate()}
                disabled={start.isPending}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
              >
                <Radio size={16} aria-hidden="true" />
                Pornește înregistrarea
              </button>
            )}
          </div>

          {(start.isError || stop.isError) && (
            <p className="mt-3 text-sm text-rose-300">
              Operația a eșuat. Verifică dacă ai rol de operator și dacă
              serviciul răspunde.
            </p>
          )}
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Sesiuni înregistrate"
          subtitle={
            isLoading ? 'Se încarcă…' : `${sessions.length} sesiuni salvate`
          }
          bodyClassName="overflow-x-auto"
        >
          {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}

          {sessions.length === 0 && !isLoading ? (
            <p className="text-sm text-zinc-500">
              Nicio sesiune salvată. Pornește o înregistrare cât timp mașina
              trimite date.
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
                  <th className="pb-2 font-medium">Sesiune</th>
                  <th className="pb-2 font-medium">Început</th>
                  <th className="pb-2 font-medium">Durată</th>
                  <th className="pb-2 font-medium">Eșantioane</th>
                  <th className="pb-2 font-medium">Alarme</th>
                  <th className="pb-2 font-medium">
                    <span className="sr-only">Acțiuni</span>
                  </th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    isRecording={session.id === recordingSessionId}
                    isReplaying={session.id === replaySession?.id}
                    disabled={loading}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </section>
    </>
  )
}

function SessionRow({
  session,
  isRecording,
  isReplaying,
  disabled,
}: {
  session: SessionInfo
  isRecording: boolean
  isReplaying: boolean
  disabled: boolean
}) {
  const duration =
    session.ended_at === null
      ? null
      : (new Date(session.ended_at).getTime() -
          new Date(session.started_at).getTime()) /
        1000

  return (
    <tr
      className={clsx(
        'border-t border-white/5',
        isReplaying && 'bg-violet-500/10',
      )}
    >
      <td className="py-2">
        <span className="font-medium text-zinc-100">{session.id}</span>
        {session.note ? (
          <span className="ml-2 text-xs text-zinc-500">{session.note}</span>
        ) : null}
        {isRecording ? (
          <span className="ml-2 rounded bg-rose-500/20 px-1.5 py-0.5 text-[11px] text-rose-200">
            în curs
          </span>
        ) : null}
      </td>
      <td className="py-2 text-zinc-400">
        {formatDateTime(session.started_at)}
      </td>
      <td className="py-2 tabular-nums">
        {duration === null ? '—' : formatDuration(duration)}
      </td>
      <td className="py-2 tabular-nums">
        {formatNumber(session.sample_count, 0)}
      </td>
      <td className="py-2 tabular-nums">
        {formatNumber(session.alarm_count, 0)}
      </td>
      <td className="py-2">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void replayDriver.load(session)}
            disabled={disabled || session.sample_count === 0}
            className="flex min-h-9 items-center gap-1.5 rounded-lg bg-white/5 px-3 text-xs text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            <Play size={14} aria-hidden="true" />
            Redare
          </button>
          <a
            href={exportUrl(session.id)}
            download
            className="flex min-h-9 items-center gap-1.5 rounded-lg bg-white/5 px-3 text-xs text-zinc-200 transition-colors hover:bg-white/10"
          >
            <Download size={14} aria-hidden="true" />
            CSV
          </a>
        </div>
      </td>
    </tr>
  )
}
