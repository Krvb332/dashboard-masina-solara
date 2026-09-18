import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { CircleStop, Download, Play, Radio } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Panel } from '../../components/Panel'
import { SESSIONS_QUERY_KEY, useRecording } from '../../hooks/useRecording'
import { exportUrl, fetchSessions } from '../../lib/api'
import { formatDateTime, formatDuration, formatNumber } from '../../lib/format'
import { describeRecordingError } from '../../lib/recording'
import { replayDriver } from '../../lib/replay-driver'
import type { SessionInfo } from '../../schemas/telemetry'
import { useSessionStore } from '../../stores/session-store'

/**
 * Sesiuni: pornirea și oprirea înregistrării, redarea și exportul CSV.
 *
 * Înregistrarea rulează pe server, deci continuă chiar dacă browserul se
 * închide - dashboardul nu trebuie să fie o dependență a colectării de date.
 * Butonul din antet și panoul de aici folosesc același hook, ca să nu existe
 * două păreri despre dacă se înregistrează sau nu.
 */
export function SessionsPage() {
  const [note, setNote] = useState('')
  const {
    recordingSessionId,
    isStarting,
    isStopping,
    error: recordingError,
    start,
    stop,
  } = useRecording()
  const replaySession = useSessionStore((state) => state.session)
  const loading = useSessionStore((state) => state.loading)
  const error = useSessionStore((state) => state.error)

  // Nota aparține înregistrării care tocmai a pornit; câmpul rămâne oricum
  // dezactivat cât timp ea rulează.
  useEffect(() => {
    if (recordingSessionId !== null) setNote('')
  }, [recordingSessionId])

  const {
    data: sessions = [],
    isLoading,
    error: listError,
  } = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: () => fetchSessions(50),
    refetchInterval: 10_000,
  })

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
                onClick={stop}
                disabled={isStopping}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
              >
                <CircleStop size={16} aria-hidden="true" />
                Oprește înregistrarea
              </button>
            ) : (
              <button
                type="button"
                onClick={() => start(note)}
                disabled={isStarting}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
              >
                <Radio size={16} aria-hidden="true" />
                Pornește înregistrarea
              </button>
            )}
          </div>

          {recordingError && (
            <p className="mt-3 text-sm text-rose-300" role="alert">
              {recordingError}
            </p>
          )}
        </Panel>
      </section>

      <section className="mt-4">
        <Panel
          title="Sesiuni înregistrate"
          subtitle={
            isLoading
              ? 'Se încarcă…'
              : listError
                ? 'Lista nu a putut fi încărcată'
                : `${sessions.length} sesiuni salvate`
          }
          bodyClassName="overflow-x-auto"
        >
          {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}

          {listError ? (
            // Fără asta, un 401 arăta ca „0 sesiuni salvate" — o listă goală
            // de bună-credință, nu o listă pe care n-o avem voie s-o vedem.
            <p className="text-sm text-rose-300" role="alert">
              {describeRecordingError(listError)}
            </p>
          ) : sessions.length === 0 && !isLoading ? (
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
