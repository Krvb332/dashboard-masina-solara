import type { SignalDefinition } from '../schemas/telemetry'

/** Tonurile vizuale folosite pentru valori și alarme. */
export type MetricTone = 'default' | 'success' | 'warning' | 'danger'

/**
 * Culoarea unei valori rezultă din pragurile declarate în catalogul serverului,
 * nu din reguli scrise în interfață. Praguri și alarme rămân astfel sincronizate.
 */
export function toneFor(
  definition: SignalDefinition | undefined,
  value: number | null,
): MetricTone {
  if (!definition || value === null) return 'default'

  const { crit_above, crit_below, warn_above, warn_below } = definition

  if (
    (crit_above !== null && value >= crit_above) ||
    (crit_below !== null && value <= crit_below)
  ) {
    return 'danger'
  }

  if (
    (warn_above !== null && value >= warn_above) ||
    (warn_below !== null && value <= warn_below)
  ) {
    return 'warning'
  }

  const hasThresholds =
    crit_above !== null ||
    crit_below !== null ||
    warn_above !== null ||
    warn_below !== null

  return hasThresholds ? 'success' : 'default'
}
