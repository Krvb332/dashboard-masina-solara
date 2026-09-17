import { useErrorStore } from '../stores/error-store'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'
import { useDriverStore } from '../stores/driver-store'
import { analyticsTotals, resetAnalytics } from './analytics-control'
import { resetDerivedBuffer } from './derived-buffer'
import { replayDriver } from './replay-driver'
import { resetBuffer } from './telemetry-buffer'

/**
 * Punctul unic prin care interfața poate reporni lanțul de telemetrie.
 *
 * Clientul WebSocket trăiește într-un efect din `useTelemetryStream`, deci nu
 * este accesibil din alte componente. În loc să-l ridicăm în store (unde ar
 * ajunge să fie re-creat la fiecare randare), hookul își înregistrează aici
 * comenzile, iar butonul de reset le cheamă fără să știe nimic despre socket.
 */

export type TelemetryControl = {
  /** Repornește legătura acum, fără să aștepte backofful. */
  reconnect: () => void
}

let control: TelemetryControl | null = null

/**
 * Snapshotul care urmeaza dupa un reset manual trebuie sa vina fara istoric.
 *
 * Serverul trimite la FIECARE conectare un snapshot cu pana la 600 de
 * esantioane, si are dreptate sa o faca: un dashboard deschis acum nu trebuie
 * sa astepte zece minute ca sa aiba un grafic. Dar `resetTelemetry` reconecteaza
 * exact pentru a reporni legatura, deci fara steagul asta secventa devine
 * "golesc graficul -> reconectez -> serverul mi-l umple la loc", si butonul
 * pare ca nu face nimic.
 *
 * Distinctia este a clientului, nu a serverului: o conectare obisnuita VREA
 * istoricul, doar cea de dupa un reset nu.
 */
let discardNextSnapshotHistory = false

/** Adevarat o singura data, pentru snapshotul de dupa un reset manual. */
export function consumeSnapshotHistoryDiscard(): boolean {
  const discard = discardNextSnapshotHistory
  discardNextSnapshotHistory = false
  return discard
}

/** Chemat de `useTelemetryStream` la montare. Întoarce funcția de dezînregistrare. */
export function registerTelemetryControl(next: TelemetryControl): () => void {
  control = next
  return () => {
    // Doar dacă nu s-a înregistrat deja altcineva între timp: la remontarea din
    // StrictMode, efectul nou apucă să se înregistreze înaintea curățării celui vechi.
    if (control === next) control = null
  }
}

export function isTelemetryControlReady(): boolean {
  return control !== null
}

/**
 * Aduce interfața la zero și repornește legătura.
 *
 * Șterge STRICT ce ține de browser: seriile din grafice, ultima stare, statisticile
 * de flux, tururile, jurnalul de erori. Datele de pe server rămân neatinse — nici
 * înregistrarea în curs nu se oprește, pentru că butonul curăță un ecran, nu o cursă.
 *
 * Dacă tocmai se reda o sesiune, redarea se închide: după reset ecranul arată
 * ce trimite mașina acum, iar a rămâne în „replay" cu bufferul gol ar fi doar
 * derutant.
 */
export function resetTelemetry(): void {
  if (useSessionStore.getState().mode === 'replay') {
    // `exit()` face deja golirea bufferului și a store-ului, dar o repetăm mai
    // jos oricum: pașii trebuie să fie identici în ambele moduri.
    replayDriver.exit()
  }

  resetBuffer()
  resetDerivedBuffer()
  useTelemetryStore.getState().reset()
  useErrorStore.getState().clearAll()

  // Stintul pilotului se taie aici, nu se șterge: energia consumată până acum
  // rămâne în istoricul lui, iar de la zero începe o bucată nouă. Fără tăiere,
  // linia de bază ar rămâne peste contoarele resetate și bilanțul stintului ar
  // deveni permanent zero.
  const telemetry = useTelemetryStore.getState()
  useDriverStore.getState().splitStint({
    totals: analyticsTotals(),
    vehicleId: telemetry.vehicleId,
    sessionId: telemetry.sessionId,
  })
  resetAnalytics()

  // Se ridica INAINTE de reconectare: snapshotul poate sosi imediat.
  discardNextSnapshotHistory = true
  control?.reconnect()
}
