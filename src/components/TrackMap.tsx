import { useEffect, useRef } from 'react'
import { anchorStationary } from '../lib/gps'
import { collectFixes } from '../lib/gps-buffer'
import { matchRun, type MatchedFix } from '../lib/map-matching'
import { telemetryBuffer } from '../lib/telemetry-buffer'
import { speedKphFromRpm } from '../lib/telemetry-math'
import {
  mixColor,
  niceStep,
  referenceFrame,
  type MapFrame,
} from '../lib/track-projection'
import { trackReference } from '../lib/track-reference'

/**
 * Harta traseului: circuitul desenat din referință, mașina proiectată pe el.
 *
 * Deliberat fără tile-uri externe: documentul de arhitectură cere ca sistemul
 * să funcționeze complet fără internet, iar în pitlane o hartă cu tile-uri
 * remote ar afișa pătrate gri exact când e nevoie de ea.
 *
 * **Ce s-a schimbat față de harta auto-scalată.** Înainte, forma desenată era
 * chiar urma GPS, iar fereastra se potrivea după ea. Două consecințe, amândouă
 * neplăcute: urma ieșea de pe asfalt cu tot zgomotul receptorului, iar scara se
 * schimba la fiecare cadru, deci traseul părea că respiră. Acum circuitul este
 * cunoscut: se desenează el, o dată, într-un cadru fix; poziția mașinii se
 * proiectează pe el. Același loc de pe asfalt cade mereu în același pixel.
 *
 * Urma brută rămâne desenată, estompat, sub cea proiectată. Nu este ornament:
 * este singurul loc din care operatorul poate vedea cât de mult corectează
 * maparea. O hartă care arată doar poziția lipită pe traseu ar arăta la fel de
 * curat și cu un receptor defect.
 */

const REDRAW_INTERVAL_MS = 100
const PADDING = 18
/** Câte poziții păstrăm pe urmă. La 10 Hz, 3000 înseamnă ultimele 5 minute. */
const TRAIL_POINTS = 3000

const COLD = [96, 165, 250] as const // albastru: viteză mică
const HOT = [251, 191, 36] as const // chihlimbar: viteză mare
const LOW = [52, 211, 153] as const // verde: punctul cel mai de jos
const HIGH = [244, 114, 182] as const // roz: punctul cel mai de sus

/** Culoarea asfaltului sub urmă. */
const TRACK_LINE = 'rgba(113, 113, 122, 0.55)'
/** Urma brută, înainte de proiecție. */
const RAW_LINE = 'rgba(248, 113, 113, 0.35)'

/** După ce mărime se colorează urma. */
export type TrackColorBy = 'speed' | 'elevation'

type TrackMapProps = {
  height?: number
  className?: string
  /**
   * Elevația se desenează doar dacă receptorul chiar o trimite; altfel urma
   * revine la culoarea după viteză, în loc să apară uniformă și să sugereze un
   * traseu perfect plan.
   */
  colorBy?: TrackColorBy
  /** Arată urma brută sub cea proiectată. */
  showRaw?: boolean
}

export function TrackMap({
  height = 320,
  className,
  colorBy = 'speed',
  showRaw = true,
}: TrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef<TrackColorBy>(colorBy)
  const rawRef = useRef<boolean>(showRaw)
  modeRef.current = colorBy
  rawRef.current = showRaw

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    let frame = requestAnimationFrame(draw)
    let lastDraw = 0

    function draw(now: number) {
      frame = requestAnimationFrame(draw)
      if (now - lastDraw < REDRAW_INTERVAL_MS) return
      lastDraw = now
      render(
        canvas as HTMLCanvasElement,
        context as CanvasRenderingContext2D,
        modeRef.current,
        rawRef.current,
      )
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() =>
            render(canvas, context, modeRef.current, rawRef.current),
          )
    resizeObserver?.observe(canvas)

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ height }}
      className={className ?? 'w-full rounded-xl bg-black/25'}
      role="img"
      aria-label={
        colorBy === 'elevation'
          ? `${trackReference.name} — hartă colorată după altitudine`
          : `${trackReference.name} — hartă cu poziția curentă a mașinii`
      }
      data-color-by={colorBy}
      data-track={trackReference.name}
    />
  )
}

function render(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  colorBy: TrackColorBy,
  showRaw: boolean,
) {
  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) return

  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio
    canvas.height = height * ratio
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)

  // Cadrul se calculează din circuit, nu din date: se desenează la fel și
  // înainte să sosească primul fix.
  const frame = referenceFrame(trackReference, width, height, PADDING)

  drawCircuit(context, frame)
  drawScale(context, frame, width, height)

  // Ancorarea rămâne înaintea proiecției. Cele două rezolvă lucruri diferite:
  // ancorarea ține pe loc o mașină oprită, proiecția o ține pe asfalt. Fără
  // ancorare, o mașină staționară ar aluneca înainte și înapoi pe traseu, în
  // ritmul zgomotului — mai puțin vizibil decât un ghem, dar la fel de fals.
  const fixes = anchorStationary(collectFixes(TRAIL_POINTS))
  if (fixes.length === 0) {
    drawWaiting(context, width, height)
    return
  }

  const run = matchRun(fixes)
  if (run.fixes.length === 0) {
    drawWaiting(context, width, height)
    return
  }

  const speedByTime = groundSpeedByTime()

  if (showRaw) drawRawTrail(context, frame, run.fixes)
  drawTrail(context, frame, run.fixes, speedByTime, colorBy)

  const first = run.fixes[0]
  const last = run.fixes[run.fixes.length - 1]
  drawStart(context, frame, first)
  drawCurrent(context, frame, last)

  if (!last.match.onTrack) drawOffTrack(context, width)
}

/**
 * Viteza pe fiecare eșantion, pentru colorarea urmei: cea raportată de placă
 * sau, când lipsește cu totul, cea dedusă din turație × Ø 548 mm — aceeași
 * regulă ca peste tot în dashboard.
 */
function groundSpeedByTime(): Map<number, number> {
  const reported = telemetryBuffer.toSeries(
    'vehicle_speed_kph',
    undefined,
    TRAIL_POINTS,
  )
  if (reported.length > 0) return new Map(reported)

  const rpm = telemetryBuffer.toSeries('motor_rpm', undefined, TRAIL_POINTS)
  return new Map(
    rpm.map(([time, value]) => [time, speedKphFromRpm(value) ?? Number.NaN]),
  )
}

/** Linia mediană a circuitului, desenată o dată, din referință. */
function drawCircuit(context: CanvasRenderingContext2D, frame: MapFrame) {
  const nodes = trackReference.nodes
  if (nodes.length < 2) return

  context.strokeStyle = TRACK_LINE
  // Asfaltul are vreo doisprezece metri; desenat la scara hărții, dă o bandă
  // pe care urma se vede deasupra, nu o linie subțire lângă ea.
  context.lineWidth = Math.max(
    3,
    Math.min(14, 12 / frame.metersPerPixel),
  )
  context.lineCap = 'round'
  context.lineJoin = 'round'

  context.beginPath()
  for (let index = 0; index < nodes.length; index += 1) {
    const point = frame.project(nodes[index][0], nodes[index][1])
    if (index === 0) context.moveTo(point.x, point.y)
    else context.lineTo(point.x, point.y)
  }
  context.closePath()
  context.stroke()

  // Linia de start/sosire, perpendiculară pe traseu.
  drawStartLine(context, frame)
}

function drawStartLine(context: CanvasRenderingContext2D, frame: MapFrame) {
  const nodes = trackReference.nodes
  const start = frame.project(nodes[0][0], nodes[0][1])
  const next = frame.project(nodes[1][0], nodes[1][1])

  const dx = next.x - start.x
  const dy = next.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.001) return

  // Normala la direcția de mers, scalată la lățimea desenată a asfaltului.
  const half = Math.max(5, Math.min(12, 10 / frame.metersPerPixel))
  const nx = (-dy / length) * half
  const ny = (dx / length) * half

  context.strokeStyle = 'rgba(244, 244, 245, 0.9)'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(start.x - nx, start.y - ny)
  context.lineTo(start.x + nx, start.y + ny)
  context.stroke()
}

/** Urma brută, așa cum a venit de la receptor. */
function drawRawTrail(
  context: CanvasRenderingContext2D,
  frame: MapFrame,
  fixes: MatchedFix[],
) {
  context.strokeStyle = RAW_LINE
  context.lineWidth = 1
  context.beginPath()

  for (let index = 0; index < fixes.length; index += 1) {
    const point = frame.project(fixes[index].raw.lat, fixes[index].raw.lon)
    if (index === 0) context.moveTo(point.x, point.y)
    else context.lineTo(point.x, point.y)
  }
  context.stroke()
}

/** Urma proiectată, colorată după viteză sau altitudine. */
function drawTrail(
  context: CanvasRenderingContext2D,
  frame: MapFrame,
  fixes: MatchedFix[],
  speedByTime: Map<number, number>,
  colorBy: TrackColorBy,
) {
  const byElevation = colorBy === 'elevation'
  const values = fixes.map((fix) =>
    byElevation
      ? fix.match.elevationM
      : (speedByTime.get(fix.timeMs) ?? Number.NaN),
  )
  const usable = values.filter((value) => !Number.isNaN(value))
  const min = usable.length > 0 ? Math.min(...usable) : 0
  const max = usable.length > 0 ? Math.max(...usable) : 1
  // Un interval minim: pe o porțiune plană, altfel fiecare metru ar deveni un
  // salt de culoare de la un capăt la celălalt al paletei.
  const span = Math.max(max - min, byElevation ? 5 : 1)

  const [cold, hot] = byElevation ? [LOW, HIGH] : [COLD, HOT]

  context.lineWidth = 2.5
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (let index = 1; index < fixes.length; index += 1) {
    const from = fixes[index - 1]
    const to = fixes[index]

    // Segmentele care leagă o poziție de pe traseu de una din afara lui nu
    // descriu un drum: se sare peste ele, ca să nu apară o linie dreaptă prin
    // mijlocul circuitului.
    if (!from.match.onTrack || !to.match.onTrack) continue

    const value = values[index]
    context.strokeStyle = Number.isNaN(value)
      ? 'rgba(161, 161, 170, 0.8)'
      : mixColor(cold, hot, (value - min) / span)

    const a = frame.project(from.match.lat, from.match.lon)
    const b = frame.project(to.match.lat, to.match.lon)
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
    context.stroke()
  }
}

function drawStart(
  context: CanvasRenderingContext2D,
  frame: MapFrame,
  fix: MatchedFix,
) {
  const point = frame.project(fix.match.lat, fix.match.lon)
  context.strokeStyle = 'rgba(244, 244, 245, 0.75)'
  context.lineWidth = 2
  context.beginPath()
  context.arc(point.x, point.y, 6, 0, Math.PI * 2)
  context.stroke()
}

function drawCurrent(
  context: CanvasRenderingContext2D,
  frame: MapFrame,
  fix: MatchedFix,
) {
  // Mașina în afara coridorului se desenează unde chiar este raportată, nu pe
  // asfalt: altfel harta ar ascunde tocmai anomalia.
  const position = fix.match.onTrack
    ? frame.project(fix.match.lat, fix.match.lon)
    : frame.project(fix.raw.lat, fix.raw.lon)

  const color = fix.match.onTrack ? '#10b981' : '#f87171'
  const halo = fix.match.onTrack
    ? 'rgba(16, 185, 129, 0.25)'
    : 'rgba(248, 113, 113, 0.25)'

  context.fillStyle = halo
  context.beginPath()
  context.arc(position.x, position.y, 10, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = color
  context.beginPath()
  context.arc(position.x, position.y, 5, 0, Math.PI * 2)
  context.fill()
}

/** Bară de scară. Scara este constantă, deci și bara. */
function drawScale(
  context: CanvasRenderingContext2D,
  frame: MapFrame,
  width: number,
  height: number,
) {
  if (!Number.isFinite(frame.metersPerPixel) || frame.metersPerPixel <= 0) {
    return
  }

  const step = niceStep(Math.min(120, width / 3) * frame.metersPerPixel)
  const pixels = step / frame.metersPerPixel
  const y = height - 14
  const x = 14

  context.strokeStyle = 'rgba(161, 161, 170, 0.65)'
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(x, y)
  context.lineTo(x + pixels, y)
  context.moveTo(x, y - 4)
  context.lineTo(x, y + 4)
  context.moveTo(x + pixels, y - 4)
  context.lineTo(x + pixels, y + 4)
  context.stroke()

  context.fillStyle = 'rgba(161, 161, 170, 0.8)'
  context.font = '11px "IBM Plex Sans Variable", sans-serif'
  context.fillText(
    step >= 1000 ? `${step / 1000} km` : `${step} m`,
    x + pixels + 8,
    y + 4,
  )
}

function drawWaiting(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  // Circuitul este deja desenat: mesajul spune doar că mașina lipsește de pe
  // el, nu că harta nu are ce arăta.
  context.fillStyle = 'rgba(113, 113, 122, 0.9)'
  context.font = '13px "IBM Plex Sans Variable", sans-serif'
  context.textAlign = 'center'
  context.fillText('Se așteaptă poziția GPS…', width / 2, height / 2)
  context.textAlign = 'start'
}

function drawOffTrack(context: CanvasRenderingContext2D, width: number) {
  context.fillStyle = 'rgba(248, 113, 113, 0.95)'
  context.font = '12px "IBM Plex Sans Variable", sans-serif'
  context.textAlign = 'center'
  context.fillText('Poziție în afara circuitului', width / 2, 18)
  context.textAlign = 'start'
}
