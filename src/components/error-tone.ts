import {
  AlertTriangle,
  Info,
  OctagonAlert,
  Plug,
  Radio,
  SquareActivity,
  TriangleAlert,
  Waves,
} from 'lucide-react'
import type { Severity } from '../schemas/telemetry'
import type { ErrorSource } from '../stores/error-store'

/**
 * Vocabularul vizual comun al erorilor: aceleași culori, aceleași cuvinte și
 * aceleași pictograme în notificare și în panou. Dacă notificarea spune „Critic"
 * cu roșu, panoul nu are voie să spună altceva pentru aceeași intrare.
 */

export const severityStyles: Record<Severity, string> = {
  critical: 'border-rose-400/25 bg-rose-400/[0.09] text-rose-100',
  warning: 'border-amber-400/20 bg-amber-400/[0.07] text-amber-100',
  info: 'border-sky-400/20 bg-sky-400/[0.07] text-sky-100',
}

export const severityLabels: Record<Severity, string> = {
  critical: 'Critic',
  warning: 'Avertizare',
  info: 'Informație',
}

export const severityIcons: Record<Severity, typeof AlertTriangle> = {
  critical: OctagonAlert,
  warning: AlertTriangle,
  info: Info,
}

export const sourceLabels: Record<ErrorSource, string> = {
  alarm: 'Alarmă',
  fault: 'Controller',
  connection: 'Legătură',
  stream: 'Flux',
  signal: 'Senzor',
}

export const sourceIcons: Record<ErrorSource, typeof AlertTriangle> = {
  alarm: TriangleAlert,
  fault: SquareActivity,
  connection: Plug,
  stream: Waves,
  signal: Radio,
}
