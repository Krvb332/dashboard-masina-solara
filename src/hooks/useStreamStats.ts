import { useMemo } from 'react'
import { subtractStats } from '../lib/stream-stats'
import type { StreamStats } from '../schemas/telemetry'
import { useTelemetryStore } from '../stores/telemetry-store'

/**
 * Contoarele de flux așa cum trebuie afișate: raportate la ultima resetare.
 *
 * Toate locurile care arată „mesaje primite/pierdute" trec pe aici, ca butonul
 * de reset să însemne același lucru peste tot în interfață.
 */
export function useStreamStats(): StreamStats {
  const stats = useTelemetryStore((state) => state.stats)
  const baseline = useTelemetryStore((state) => state.statsBaseline)

  return useMemo(() => subtractStats(stats, baseline), [stats, baseline])
}
