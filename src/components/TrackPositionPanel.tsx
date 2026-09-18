import clsx from 'clsx'
import { useMemo } from 'react'
import { useSignal } from '../hooks/useSignal'
import { useTick } from '../hooks/useTick'
import { formatNumber, NO_VALUE } from '../lib/format'
import { collectFixes } from '../lib/gps-buffer'
import { anchorStationary } from '../lib/gps'
import { MATCHING, matchRun } from '../lib/map-matching'
import { trackReference } from '../lib/track-reference'

/**
 * Poziția pe circuit: unde este mașina pe traseu și cât de mult corectează
 * maparea.
 *
 * Panoul vecin, „Verificarea mapării poziției", răspunde la altă întrebare —
 * *ajung* coordonatele corect în sistem. Acesta răspunde la ce se face cu ele
 * după: pe ce sector se află mașina, la ce metru al turului, cât de departe de
 * mijlocul asfaltului.
 *
 * Abaterea laterală este cifra care merită urmărită. Ea este exact ce
 * proiecția înlătură din poziția desenată, deci o valoare mică înseamnă că nu
 * s-a corectat mai nimic, iar una mare — că harta ar fi arătat urma prin iarbă.
 * Rămâne afișată tocmai ca să nu devină invizibilă: o hartă din care zgomotul a
 * fost scos arată la fel de curat cu un receptor bun și cu unul defect.
 */

/** Cât de des recalculăm. Proiecția traversează toată urma, nu e gratis. */
const REFRESH_MS = 1000

export function TrackPositionPanel() {
  const now = useTick(REFRESH_MS)
  const altitude = useSignal('gps_altitude_m')

  const run = useMemo(() => {
    // `now` este dependența care declanșează recalcularea; bufferul nu emite
    // evenimente, deci ceasul este singurul semnal de „mai uită-te o dată".
    void now
    return matchRun(anchorStationary(collectFixes()))
  }, [now])

  const reference = trackReference
  const last = run.fixes[run.fixes.length - 1]
  const match = last?.match

  if (run.fixes.length === 0 || match === undefined) {
    return (
      <div className="grid gap-3">
        <CircuitHeading />
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-500">
          Nicio poziție primită. Circuitul este desenat, dar mașina nu este încă
          pe el.
        </p>
      </div>
    )
  }

  const lapFraction = (match.s / reference.lengthM) * 100

  return (
    <div className="grid gap-4">
      <CircuitHeading />

      <dl className="grid gap-2 sm:grid-cols-2">
        <Row
          label="Sector"
          value={
            match.sector.ref
              ? `${match.sector.ref} · ${match.sector.name}`
              : match.sector.name
          }
          tone={match.onTrack ? 'none' : 'muted'}
        />
        <Row
          label="Poziție pe tur"
          value={`${formatNumber(match.s, 0)} m · ${formatNumber(lapFraction, 0)} %`}
        />
        <Row
          label="Abatere de la mijloc"
          value={`${formatNumber(Math.abs(match.offsetM), 1)} m ${
            match.offsetM >= 0 ? 'stânga' : 'dreapta'
          }`}
          tone={
            !match.onTrack
              ? 'bad'
              : Math.abs(match.offsetM) > MATCHING.corridorM / 2
                ? 'warn'
                : 'ok'
          }
        />
        <Row
          label="Abatere mediană"
          value={
            run.medianOffsetM === null
              ? NO_VALUE
              : `${formatNumber(run.medianOffsetM, 1)} m`
          }
        />
        <Row
          label="Tur (în fereastra afișată)"
          value={`${run.lapCount + 1}`}
          tone={match.onTrack ? 'none' : 'muted'}
        />
        <Row
          label="Distanță pe traseu (fereastra afișată, ~10 min)"
          value={`${formatNumber(run.distanceM / 1000, 2)} km`}
        />
        <Row
          label="Altitudine traseu"
          value={`${formatNumber(match.elevationM, 1)} m`}
        />
        <Row
          label="Altitudine GPS"
          value={
            altitude.fresh
              ? `${formatNumber(altitude.value as number, 1)} m`
              : NO_VALUE
          }
          tone={altitude.fresh ? 'none' : 'muted'}
        />
        <Row
          label="Panta traseului"
          value={`${formatNumber(match.gradeFraction * 100, 1)} %`}
        />
        <Row
          label="Fixuri pe circuit"
          value={`${run.onTrack} din ${run.onTrack + run.offTrack}`}
          tone={
            run.offTrack === 0 ? 'ok' : run.onTrack === 0 ? 'bad' : 'warn'
          }
        />
      </dl>

      <Verdict
        onTrack={match.onTrack}
        offsetM={match.offsetM}
        offTrack={run.offTrack}
      />
    </div>
  )
}

function CircuitHeading() {
  const reference = trackReference
  const deviation =
    Math.abs(reference.lengthM - reference.officialLengthM) /
    reference.officialLengthM

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className="text-sm font-medium text-zinc-200">
        {reference.name}
        <span className="text-zinc-500"> · {reference.location}</span>
      </p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        Linia mediană măsoară {formatNumber(reference.lengthM, 0)} m, față de
        cei {formatNumber(reference.officialLengthM, 0)} m publicați — o abatere
        de {formatNumber(deviation * 100, 2)} %. Geometria vine din{' '}
        {reference.geometrySource}, altitudinea din {reference.elevationSource}.
      </p>
    </div>
  )
}

function Verdict({
  onTrack,
  offsetM,
  offTrack,
}: {
  onTrack: boolean
  offsetM: number
  offTrack: number
}) {
  if (!onTrack) {
    return (
      <p className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-sm text-rose-200">
        Poziția raportată este la {formatNumber(Math.abs(offsetM), 0)} m de
        circuit, peste coridorul de {MATCHING.corridorM} m. Harta o desenează
        acolo unde a fost raportată, nu pe asfalt: fie mașina chiar este în
        afara traseului, fie receptorul are o problemă pe care lipirea forțată
        pe circuit ar ascunde-o.
      </p>
    )
  }

  if (offTrack > 0) {
    return (
      <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-sm text-amber-200">
        Mașina este pe circuit acum, dar {offTrack} fixuri din urma afișată au
        căzut în afara coridorului. Pe o tură normală asta înseamnă ieșiri
        scurte de precizie, nu ieșiri de pe pistă.
      </p>
    )
  }

  return (
    <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-sm text-emerald-200">
      Toate pozițiile din urma afișată cad pe circuit. Poziția desenată,
      distanța și turul se calculează din traseu, deci nu moștenesc dispersia
      receptorului; abaterea de mai sus arată cât s-a corectat.
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
