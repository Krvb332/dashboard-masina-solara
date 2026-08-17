import type { Sample } from '../schemas/telemetry'
import { TelemetryRingBuffer } from './ring-buffer'

/**
 * Bufferul unic de serii temporale al aplicației.
 *
 * Aceeași instanță este alimentată de WebSocket (live) și de driverul de replay.
 * O singură cale de date înseamnă că toate componentele funcționează identic în
 * ambele moduri, fără ramificații prin cod.
 */

/** 6000 de eșantioane = 10 minute la 10 Hz. */
export const BUFFER_CAPACITY = 6000

export const telemetryBuffer = new TelemetryRingBuffer(BUFFER_CAPACITY)

export function sampleTime(sample: Sample): number {
  // Folosim ceasul serverului: ceasul mașinii poate fi decalat, iar
  // sincronizarea lor este o problemă separată (punctul 6 din arhitectură).
  return new Date(sample.server_received_at).getTime()
}

export function pushSample(sample: Sample): void {
  telemetryBuffer.push(sampleTime(sample), sample.signals)
}

export function pushSamples(samples: Sample[]): void {
  for (const sample of samples) pushSample(sample)
}

export function resetBuffer(): void {
  telemetryBuffer.clear()
}
