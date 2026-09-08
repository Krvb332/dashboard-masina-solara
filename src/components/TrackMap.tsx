import { useEffect, useRef } from 'react'
import { telemetryBuffer } from '../lib/telemetry-buffer'
import {
  metersPerPixel,
  mixColor,
  niceStep,
  pairPositions,
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

type TrackMapProps = {
  height?: number
  className?: string
}

export function TrackMap({ height = 320, className }: TrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
      render(canvas as HTMLCanvasElement, context as CanvasRenderingContext2D)
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => render(canvas, context))
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
      aria-label="Harta traseului cu poziția curentă a mașinii"
    />
  )
}

function render(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
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

  const points = pairPositions(
    telemetryBuffer.toSeries('gps_latitude_deg', undefined, TRAIL_POINTS),
    telemetryBuffer.toSeries('gps_longitude_deg', undefined, TRAIL_POINTS),
    telemetryBuffer.toSeries('vehicle_speed_kph', undefined, TRAIL_POINTS),
  )

  if (points.length < 2) {
    drawPlaceholder(context, width, height)
    return
  }

  const projected = projectTrack(points, width, height, PADDING)
  drawTrail(context, projected)
  drawStart(context, projected[0])
  drawCurrent(context, projected[projected.length - 1])
  drawScale(context, points, projected, width, height)
}

function drawTrail(context: CanvasRenderingContext2D, points: Projected[]) {
  const speeds = points.map((point) => point.speed)
  const minSpeed = Math.min(...speeds)
  const maxSpeed = Math.max(...speeds)
  const span = Math.max(maxSpeed - minSpeed, 1)

  context.lineWidth = 2.5
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]

    context.strokeStyle = mixColor(COLD, HOT, (to.speed - minSpeed) / span)
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
