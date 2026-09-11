import clsx from 'clsx'
import { useMemo } from 'react'
import { useSignal } from '../hooks/useSignal'
import { useTick } from '../hooks/useTick'
import { formatNumber, NO_VALUE } from '../lib/format'
import {
  anchorStationary,
  bearingDeg,
  elevationProfile,
  haversineMeters,
  inspectFixes,
  speedFromFixes,
  trackLengthMeters,
} from '../lib/gps'
import { collectFixes } from '../lib/gps-buffer'

/**
 * Verificarea mapării poziției: latitudine, longitudine și altitudine chiar
 * ajung corect în hartă?
 *
 * Întrebarea nu este retorică. O hartă desenată din date greșite arată tot ca o
 * hartă — o buclă frumoasă care nu are nimic de-a face cu circuitul. Panoul de
 * față confruntă poziția cu mărimi măsurate independent:
 *
 *  - **viteza** calculată din două fixuri, față de viteza raportată de mașină;
 *  - **lungimea urmei**, care pe un circuit închis trebuie să semene cu
 *    lungimea lui reală;
 *  - **altitudinea**, prezentă sau nu, și cât din traseu o are.
 *
 * Când cele două viteze diferă mult, una dintre surse minte: fie coordonatele
 * sunt scalate greșit în firmware (grade zecimale față de grade-minute este
 * greșeala clasică), fie senzorul de roată are altă circumferință configurată.
 */

/** Cât de des recalculăm. Verificarea traversează toată urma, nu e gratis. */
const REFRESH_MS = 2000

/** Peste atâta diferență procentuală, cele două viteze nu descriu același lucru. */
const SPEED_MISMATCH_PCT = 25

export function GpsMappingPanel() {
  const now = useTick(REFRESH_MS)
  // `gps_speed_kph` a fost scos. Panoul era scris pentru un vehicul cu sursă de
  // viteză independentă de GNSS — o roată cu senzor — și punea cele două una
  // lângă alta. Mașina asta nu are așa ceva: `vehicle_speed_kph` *este* viteza
  // raportată de GNSS. Rândul cerea o cheie care nu exista nici în catalog, nici
  // printre semnalele derivate local, deci arăta „—" la nesfârșit.
  //
  // Comparația care a rămas are însă sens și funcționează: viteza dedusă din
  // pozițiile succesive, față de cea raportată de modul. Sunt două căi diferite
  // către același număr, iar dezacordul dintre ele chiar spune ceva.
  const wheelSpeed = useSignal('vehicle_speed_kph')

  const report = useMemo(() => {
    // `now` este dependența care declanșează recalcularea; bufferul nu emite
    // evenimente, deci ceasul este singurul semnal de „mai uită-te o dată".
    void now

    const fixes = collectFixes()

    // Raportul de calitate rămâne pe fixurile brute: el spune ce a sosit și de
    // ce a fost respins, iar pe date filtrate n-ar mai avea ce număra.
    const quality = inspectFixes(fixes)

    // Tot ce înseamnă deplasare se măsoară pe fixuri ancorate. Altfel, o mașină
    // oprită raporta lungime de traseu, viteză dedusă și direcție — toate
    // calculate din dispersia receptorului, toate false, și tocmai în panoul
    // care există ca să confirme că poziția e corectă.
    const anchored = anchorStationary(fixes)
    const profile = elevationProfile(anchored)
    const lengthM = trackLengthMeters(anchored)

    const usable = anchored.filter((fix) => fix.latitude !== 0)
    const last = usable[usable.length - 1]
    const previous = usable[usable.length - 2]

    const derivedSpeedMs =
      previous && last ? speedFromFixes(previous, last) : null
    const heading = previous && last ? bearingDeg(previous, last) : null
    const stepM = previous && last ? haversineMeters(previous, last) : null

    return { quality, profile, lengthM, derivedSpeedMs, heading, stepM, last }
  }, [now])

  const derivedKph =
    report.derivedSpeedMs === null ? null : report.derivedSpeedMs * 3.6

  const mismatchPct =
    derivedKph !== null && wheelSpeed.fresh && (wheelSpeed.value ?? 0) > 5
      ? (Math.abs(derivedKph - (wheelSpeed.value as number)) /
          (wheelSpeed.value as number)) *
        100
      : null

  return (
    <div className="grid gap-4">
      <dl className="grid gap-2 sm:grid-cols-2">
        <Row
          label="Fixuri folosibile"
          value={
            report.quality.total === 0
              ? NO_VALUE
              : `${report.quality.usable} din ${report.quality.total}`
          }
          tone={
            report.quality.total === 0
              ? 'muted'
              : report.quality.usable === report.quality.total
                ? 'ok'
                : report.quality.usable === 0
                  ? 'bad'
                  : 'warn'
          }
        />
        <Row
          label="Fixuri cu altitudine"
          value={
            report.quality.usable === 0
              ? NO_VALUE
              : `${report.quality.withAltitude} din ${report.quality.usable}`
          }
          tone={
            report.quality.withAltitude === 0
              ? 'bad'
              : report.quality.withAltitude === report.quality.usable
                ? 'ok'
                : 'warn'
          }
        />
        <Row
          label="Lungime urmă"
          value={
            report.lengthM > 0
              ? `${formatNumber(report.lengthM / 1000, 3)} km`
              : NO_VALUE
          }
        />
        <Row
          label="Pas între fixuri"
          value={
            report.stepM === null
              ? NO_VALUE
              : `${formatNumber(report.stepM, 2)} m`
          }
        />
        <Row
          label="Viteză din poziție"
          value={
            derivedKph === null
              ? NO_VALUE
              : `${formatNumber(derivedKph, 1)} km/h`
          }
        />
        <Row
          label="Viteză raportată"
          value={
            wheelSpeed.fresh
              ? `${formatNumber(wheelSpeed.value as number, 1)} km/h`
              : NO_VALUE
          }
        />
        <Row
          label="Direcție"
          value={
            report.heading === null
              ? NO_VALUE
              : `${formatNumber(report.heading, 0)}°`
          }
        />
        <Row
          label="Altitudine acum"
          value={
            report.last?.altitude === null ||
            report.last?.altitude === undefined
              ? NO_VALUE
              : `${formatNumber(report.last.altitude, 1)} m`
          }
        />
        <Row
          label="Urcat / coborât"
          value={
            report.profile.points.length === 0
              ? NO_VALUE
              : `${formatNumber(report.profile.gainM, 0)} m / ${formatNumber(report.profile.lossM, 0)} m`
          }
        />
      </dl>

      <Verdict mismatchPct={mismatchPct} quality={report.quality} />

      {Object.keys(report.quality.reasons).length > 0 && (
        <div>
          <p className="text-xs tracking-wide text-zinc-500 uppercase">
            Motivele respingerii
          </p>
          <ul className="mt-2 grid gap-1 text-sm text-zinc-400">
            {Object.entries(report.quality.reasons).map(([reason, count]) => (
              <li key={reason} className="flex justify-between gap-4">
                <span>{reason}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Verdict({
  mismatchPct,
  quality,
}: {
  mismatchPct: number | null
  quality: ReturnType<typeof inspectFixes>
}) {
  if (quality.total === 0) {
    return (
      <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-500">
        Nicio poziție primită. Verificarea mapării pornește la primul fix.
      </p>
    )
  }

  if (quality.usable === 0) {
    return (
      <p className="rounded-lg border border-rose-400/25 bg-rose-500/[0.08] px-3 py-2 text-sm text-rose-100">
        Niciun fix nu trece validarea. Coordonatele sosesc, dar nu descriu o
        poziție reală — de verificat scalarea din firmware înainte de orice
        altceva.
      </p>
    )
  }

  if (mismatchPct === null) {
    return (
      <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-400">
        Comparația de viteze cere mașina în mișcare, peste 5 km/h. Până atunci
        se poate verifica doar forma urmei.
      </p>
    )
  }

  if (mismatchPct > SPEED_MISMATCH_PCT) {
    return (
      <p className="rounded-lg border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2 text-sm text-amber-100">
        Viteza dedusă din poziție diferă cu {formatNumber(mismatchPct, 0)} % de
        cea raportată. Una dintre surse este scalată greșit: cel mai des,
        coordonatele sosesc în grade și minute, nu în grade zecimale, sau
        circumferința roții din firmware nu corespunde anvelopei montate.
      </p>
    )
  }

  return (
    <p className="rounded-lg border border-emerald-400/25 bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-100">
      Poziția și viteza se confirmă reciproc (diferență{' '}
      {formatNumber(mismatchPct, 0)} %). Maparea latitudine / longitudine este
      coerentă cu restul telemetriei.
    </p>
  )
}

const tones = {
  ok: 'text-emerald-200',
  warn: 'text-amber-200',
  bad: 'text-rose-200',
  muted: 'text-zinc-500',
  none: 'text-zinc-200',
} as const

function Row({
  label,
  value,
  tone = 'none',
}: {
  label: string
  value: string
  tone?: keyof typeof tones
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={clsx('font-medium tabular-nums', tones[tone])}>{value}</dd>
    </div>
  )
}
