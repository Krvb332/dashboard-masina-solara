/**
 * Configurarea aplicației, citită din variabilele Vite.
 *
 * Sursa de telemetrie poate fi forțată prin `VITE_TELEMETRY_SOURCE`:
 * - `websocket` — se conectează la `VITE_WS_URL`;
 * - `simulator` — generează date local, fără server;
 * - `auto` (implicit) — websocket dacă `VITE_WS_URL` este setat, altfel simulator.
 */

type TelemetrySourceKind = 'websocket' | 'simulator'

const rawSource = import.meta.env.VITE_TELEMETRY_SOURCE as string | undefined
const rawWsUrl = import.meta.env.VITE_WS_URL as string | undefined
const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined

function resolveSource(): TelemetrySourceKind {
  if (rawSource === 'websocket' || rawSource === 'simulator') return rawSource
  return rawWsUrl ? 'websocket' : 'simulator'
}

export const env = {
  apiUrl: rawApiUrl ?? '',
  wsUrl: rawWsUrl ?? '',
  telemetrySource: resolveSource(),

  /** Frecvența maximă de actualizare a interfeței, indiferent de rata de pe fir. */
  uiRefreshHz: 10,
  /** Câte eșantioane păstrăm în memorie pentru grafice (10 Hz × 300 s). */
  historySize: 3_000,
  /** După cât timp fără mesaje considerăm datele învechite. */
  staleAfterMs: 2_000,
  /** După cât timp fără mesaje considerăm legătura pierdută. */
  connectionLostAfterMs: 6_000,
} as const

export type { TelemetrySourceKind }
