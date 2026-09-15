import { useEffect, useRef } from 'react'
import { anchorStationary } from '../lib/gps'
import { collectFixes } from '../lib/gps-buffer'
import { telemetryBuffer } from '../lib/telemetry-buffer'
import {
  metersPerPixel,
  mixColor,
  niceStep,
  projectTrack,
  type Position,
  type Projected,
} from '../lib/track-projection'

/**
 * Harta traseului, desenată pe canvas din coordonatele GPS primite.
 *
 * Deliberat fără tile-uri externe: documentul de arhitectură cere ca sistemul
 * să funcționeze complet fără internet, iar în pitlane o hartă cu tile-uri
 * remote ar afișa pătrate gri exact când e nevoie de ea. Traseul se
 * auto-scalează după punctele primite, deci funcționează pe orice circuit fără
 * configurare.
 */

const REDRAW_INTERVAL_MS = 100
const PADDING = 18
/** Câte poziții păstrăm pe urmă. La 10 Hz, 3000 înseamnă ultimele 5 minute. */
const TRAIL_POINTS = 3000

const COLD = [96, 165, 250] as const // albastru: viteză mică
const HOT = [251, 191, 36] as const // chihlimbar: viteză mare
const LOW = [52, 211, 153] as const // verde: punctul cel mai de jos
const HIGH = [244, 114, 182] as const // roz: punctul cel mai de sus

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
}

export function TrackMap({
  height = 320,
  className,
  colorBy = 'speed',
}: TrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef<TrackColorBy>(colorBy)
  modeRef.current = colorBy

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
      )
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => render(canvas, context, modeRef.current))
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
          ? 'Harta traseului, colorată după altitudine'
          : 'Harta traseului cu poziția curentă a mașinii'
      }
      data-color-by={colorBy}
    />
  )
}

function render(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  colorBy: TrackColorBy,
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

  // Fixurile trec prin ancorare înainte de desen, altfel dispersia normală a
  // receptorului se desenează ca traseu: pe o mașină oprită ieșea o urmă de
  // zeci de metri, auto-scalată până umplea pânza, cu bara de scară la 10 m.
  // Ancorarea păstrează prima citire validă ca punct de pornire și raportează
  // aceeași poziție cât timp vehiculul nu s-a mutat cu adevărat.
  //
  // Viteza se ia separat, pe timp exact: nu este o proprietate a fixului GNSS,
  // ci semnalul de viteză al vehiculului, care colorează urma.
  const speedByTime = new Map(
    telemetryBuffer.toSeries('vehicle_speed_kph', undefined, TRAIL_POINTS),
  )
  const points: Position[] = anchorStationary(collectFixes(TRAIL_POINTS)).map(
    (fix) => ({
      lat: fix.latitude,
      lon: fix.longitude,
      speed: speedByTime.get(fix.timeMs) ?? 0,
      // O poziție fără altitudine rămâne fără altitudine: `0` ar desena
      // traseul la nivelul mării pe harta colorată după elevație.
      ...(fix.altitude === undefined || fix.altitude === null
        ? {}
        : { elevation: fix.altitude }),
    }),
  )

  if (points.length < 2) {
    drawPlaceholder(context, width, height)
    return
  }

  const projected = projectTrack(points, width, height, PADDING)
  const hasElevation = projected.some((point) => point.elevation !== undefined)
  drawTrail(context, projected, colorBy === 'elevation' && hasElevation)
  drawStart(context, projected[0])
  drawCurrent(context, projected[projected.length - 1])
  drawScale(context, points, projected, width, height)
}

function drawTrail(
  context: CanvasRenderingContext2D,
  points: Projected[],
  byElevation: boolean,
) {
  const values = points.map((point) =>
    byElevation ? (point.elevation ?? Number.NaN) : point.speed,
  )
  const usable = values.filter((value) => !Number.isNaN(value))
  const min = usable.length > 0 ? Math.min(...usable) : 0
  const max = usable.length > 0 ? Math.max(...usable) : 1
  // Un interval minim: pe un traseu plan, altfel fiecare metru de zgomot ar
  // deveni un salt de culoare de la un capăt la celălalt al paletei.
  const span = Math.max(max - min, byElevation ? 5 : 1)

  const [cold, hot] = byElevation ? [LOW, HIGH] : [COLD, HOT]

  context.lineWidth = 2.5
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    const value = values[index]

    // Fără valoare pentru segmentul curent, desenăm neutru — nu inventăm o
    // poziție în paletă pentru un punct despre care nu știm nimic.
    context.strokeStyle = Number.isNaN(value)
      ? 'rgba(113, 113, 122, 0.8)'
      : mixColor(cold, hot, (value - min) / span)
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }
}

function drawStart(context: CanvasRenderingContext2D, point: Projected) {
  context.strokeStyle = 'rgba(244, 244, 245, 0.75)'
  context.lineWidth = 2
  context.beginPath()
  context.arc(point.x, point.y, 6, 0, Math.PI * 2)
  context.stroke()
}

function drawCurrent(context: CanvasRenderingContext2D, point: Projected) {
  context.fillStyle = 'rgba(16, 185, 129, 0.25)'
  context.beginPath()
  context.arc(point.x, point.y, 10, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = '#10b981'
  context.beginPath()
  context.arc(point.x, point.y, 5, 0, Math.PI * 2)
  context.fill()
}

/** Bară de scară, ca distanțele de pe hartă să fie interpretabile. */
function drawScale(
  context: CanvasRenderingContext2D,
  points: Position[],
  projected: Projected[],
  width: number,
  height: number,
) {
  const perPixel = metersPerPixel(
    points[0],
    points[points.length - 1],
    projected,
  )
  if (!Number.isFinite(perPixel) || perPixel <= 0) return

  const step = niceStep(Math.min(120, width / 3) * perPixel)
  const pixels = step / perPixel
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

function drawPlaceholder(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  context.fillStyle = 'rgba(113, 113, 122, 0.9)'
  context.font = '13px "IBM Plex Sans Variable", sans-serif'
  context.textAlign = 'center'
  context.fillText('Se așteaptă poziția GPS…', width / 2, height / 2)
  context.textAlign = 'start'
}
