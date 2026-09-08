import type { LucideIcon } from 'lucide-react'
import { getSignalDefinition, type SignalKey } from '../config/signals'
import { useLiveSignal } from '../hooks/use-telemetry'
import { signalSeverity } from '../lib/alarms'
import { formatNumber, formatSignal, NO_DATA } from '../lib/format'
import { historyBuffer, useTelemetryStore } from '../stores/telemetry-store'
import { MetricCard, type MetricAccent, type MetricSeverity } from './MetricCard'

type SignalCardProps = {
  signal: SignalKey
  icon: LucideIcon
  /** Text sub valoare. Implicit se afișează variația din ultimul minut. */
  detail?: string
  /** Fereastra pentru variație, în secunde. */
  trendSeconds?: number
  /** Culoarea de identitate a cardului, folosită cât timp nu există alarmă. */
  accent?: MetricAccent
}

/**
 * Card conectat la un semnal din registru. Eticheta, unitatea, precizia și
 * pragurile vin din `config/signals`, deci un semnal nou nu necesită cod nou.
 */
export function SignalCard({
  signal,
  icon,
  detail,
  trendSeconds = 60,
  accent = 'blue',
}: SignalCardProps) {
  const definition = getSignalDefinition(signal)
  const { value, quality, isStale } = useLiveSignal(signal)

  // Ne reabonăm la fiecare publicare, ca variația să fie recalculată.
  useTelemetryStore((state) => state.historyVersion)

  if (!definition) {
    return (
      <MetricCard
        label={signal}
        value={NO_DATA}
        icon={icon}
        detail="Semnal necunoscut"
        accent="zinc"
      />
    )
  }

  const breach = quality === 'valid' ? signalSeverity(definition, value) : null
  const severity: MetricSeverity | null =
    breach === 'critical' || breach === 'warning' ? breach : null

  return (
    <MetricCard
      label={definition.label}
      value={value === null ? NO_DATA : formatSignal(value, definition)}
      detail={detail ?? describeTrend(signal, definition.decimals, trendSeconds)}
      icon={icon}
      accent={accent}
      severity={severity}
      stale={isStale}
    />
  )
}

function describeTrend(
  signal: string,
  decimals: number,
  seconds: number,
): string {
  const delta = historyBuffer.delta(signal, seconds)
  if (delta === null) return 'Se colectează istoric…'

  const minutes = Math.round(seconds / 60)
  const window =
    seconds < 60
      ? `ultimele ${seconds} s`
      : minutes === 1
        ? 'ultimul minut'
        : `ultimele ${minutes} min`

  if (Math.abs(delta) < 10 ** -decimals / 2) return `Stabil în ${window}`

  const sign = delta > 0 ? '+' : '−'
  return `${sign}${formatNumber(Math.abs(delta), decimals)} în ${window}`
}
