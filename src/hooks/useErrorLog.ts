import { useEffect, useMemo } from 'react'
import { activeFaults } from '../lib/mitsuba-faults'
import type { Severity } from '../schemas/telemetry'
import { useErrorStore, type ErrorReport } from '../stores/error-store'
import { useSessionStore } from '../stores/session-store'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Adună într-o singură listă tot ce înseamnă „ceva nu e în regulă".
 *
 * Se montează o singură dată, în shell, lângă `useTelemetryStream`. La fiecare
 * schimbare recalculează setul de erori prezente ACUM și îl predă jurnalului;
 * jurnalul se ocupă de istoric (ce a apărut, ce s-a stins, ce a reapărut).
 *
 * Patru surse, pentru că pe mașină chiar sunt patru lucruri diferite:
 *  - alarmele calculate pe server din praguri (tensiune, temperatură…);
 *  - masca de eroare a controllerului Mitsuba;
 *  - senzorii care raportează explicit defect (`sensor_error`);
 *  - sănătatea legăturii: deconectări și cadre invalide.
 */

/** Sub atâtea cadre invalide nu deranjăm pe nimeni: se întâmplă la repornire. */
const INVALID_FRAME_THRESHOLD = 3

export function useErrorLog(): void {
  const sync = useErrorStore((state) => state.sync)

  const alarms = useTelemetryStore((state) => state.alarms)
  const quality = useTelemetryStore((state) => state.quality)
  const catalogByKey = useTelemetryStore((state) => state.catalogByKey)
  const connection = useTelemetryStore((state) => state.connection)
  const invalidFrames = useTelemetryStore((state) => state.invalidFrames)
  const latest = useTelemetryStore((state) => state.latest)
  const mode = useSessionStore((state) => state.mode)

  const faultCode = latest?.signals.motor_fault_code ?? null

  const reports = useMemo(() => {
    const collected: ErrorReport[] = []

    for (const alarm of alarms) {
      if (!alarm.active) continue
      collected.push({
        id: `alarm:${alarm.id}`,
        source: 'alarm',
        severity: alarm.severity,
        title: alarm.label,
        message: alarm.message,
      })
    }

    if (faultCode !== null) {
      for (const fault of activeFaults(faultCode)) {
        collected.push({
          id: `fault:${fault.bit}`,
          source: 'fault',
          // Bitul 23 spune doar că protecția lucrează, nu că s-a stricat ceva.
          severity: fault.bit === 23 ? 'warning' : 'critical',
          title: `Controller: ${fault.label}`,
          message: fault.hint,
        })
      }
    }

    for (const [key, signal] of Object.entries(quality)) {
      if (signal.state !== 'sensor_error') continue
      collected.push({
        id: `signal:${key}`,
        source: 'signal',
        severity: 'warning',
        title: `Senzor defect: ${catalogByKey[key]?.label ?? key}`,
        message:
          'Semnalul sosește, dar valoarea este marcată ca invalidă de sursă.',
      })
    }

    // În redare nu există legătură live de evaluat: cadrele vin din arhivă.
    if (mode === 'live') {
      const link = connectionReport(connection)
      if (link) collected.push(link)

      if (invalidFrames >= INVALID_FRAME_THRESHOLD) {
        collected.push({
          id: 'stream:invalid',
          source: 'stream',
          severity: 'warning',
          title: 'Cadre invalide pe flux',
          message: `${invalidFrames} mesaje au fost respinse la validare și ignorate.`,
        })
      }
    }

    return collected
  }, [
    alarms,
    catalogByKey,
    connection,
    faultCode,
    invalidFrames,
    mode,
    quality,
  ])

  useEffect(() => {
    sync(reports)
  }, [reports, sync])
}

function connectionReport(
  connection: ReturnType<typeof useTelemetryStore.getState>['connection'],
): ErrorReport | null {
  const byState: Partial<
    Record<typeof connection, { severity: Severity; message: string }>
  > = {
    disconnected: {
      severity: 'critical',
      message: 'Legătura cu serviciul de telemetrie este întreruptă.',
    },
    reconnecting: {
      severity: 'warning',
      message: 'Legătura s-a pierdut; se încearcă reconectarea.',
    },
  }

  const detail = byState[connection]
  if (!detail) return null

  return {
    id: 'connection',
    source: 'connection',
    severity: detail.severity,
    title: 'Telemetrie indisponibilă',
    message: detail.message,
  }
}
