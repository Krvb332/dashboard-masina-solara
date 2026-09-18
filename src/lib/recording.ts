import { ApiError } from './api'

/**
 * Explicația unei erori de la endpoint-urile de sesiuni, pe înțelesul omului
 * din pitlane.
 *
 * Codul HTTP spune exact ce lipsește: token, rol sau înregistrare activă. Un
 * mesaj generic („operația a eșuat") trimite la ghicit între toate trei, iar
 * cel mai frecvent caz — dashboard pornit fără `VITE_API_TOKEN` pe un server
 * cu autentificare — nu are niciun indiciu vizibil.
 */
export function describeRecordingError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Serviciul cere un token de acces: VITE_API_TOKEN lipsește sau este greșit.'
      case 403:
        return 'Tokenul are doar rol de viewer; înregistrarea cere rolul de operator.'
      case 409:
        return 'Serverul nu are nicio înregistrare activă.'
      default:
        return `Serviciul a răspuns ${error.status}: ${error.message}`
    }
  }

  if (error instanceof Error) {
    return `Serviciul de telemetrie nu răspunde (${error.message}).`
  }

  return 'Operația a eșuat dintr-un motiv necunoscut.'
}
