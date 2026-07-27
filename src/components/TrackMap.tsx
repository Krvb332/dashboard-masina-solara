import { useMemo } from 'react'
import { formatNumber } from '../lib/format'
import { historyBuffer, useTelemetryStore } from '../stores/telemetry-store'

const LAT_KEY = 'gps_latitude_deg'
const LON_KEY = 'gps_longitude_deg'

const METERS_PER_DEG_LAT = 111_320

/** Actualizăm harta de 2 ori pe secundă, nu la fiecare cadru. */
const VERSIONS_PER_UPDATE = 5

/** Numărul maxim de puncte desenate; peste atât, traseul se subeșantionează. */
const MAX_PATH_POINTS = 900

/** Lungimi „rotunde" pentru scara grafică, în metri. */
const SCALE_STEPS = [10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000]

type Geometry = {
  path: string
  current: { x: number; y: number } | null
  viewBox: string
  extent: number
  scale: { meters: number; label: string }
  originX: number
  originY: number
}

/**
 * Traseul parcurs, desenat din istoricul de coordonate GPS.
 *
 * Este o reprezentare relativă, nu o hartă: nu avem fundal cartografic, iar un
 * dashboard de pitlane trebuie să funcționeze fără internet. Coordonatele sunt
 * proiectate local în metri, iar `preserveAspectRatio` garantează că forma
 * circuitului nu este deformată — un viraj rotund rămâne rotund, indiferent de
 * proporțiile panoului.
 */
export function TrackMap({
  windowSeconds = 600,
  height = 300,
}: {
  windowSeconds?: number
  height?: number
}) {
  const version = useTelemetryStore((state) => state.historyVersion)
  const tick = Math.floor(version / VERSIONS_PER_UPDATE)

  const geometry = useMemo<Geometry | null>(() => {
    const { series } = historyBuffer.window([LAT_KEY, LON_KEY], windowSeconds)
    const latitudes = series[LAT_KEY] ?? []
    const longitudes = series[LON_KEY] ?? []

    // Proiecție locală: originea este prima poziție cunoscută, `x` spre est și
    // `y` spre nord. Longitudinea se scurtează cu cosinusul latitudinii.
    let originLat: number | null = null
    let originLon = 0
    let metersPerDegLon = METERS_PER_DEG_LAT
    const points: { x: number; y: number }[] = []

    for (let index = 0; index < latitudes.length; index += 1) {
      const lat = latitudes[index]
      const lon = longitudes[index]
      if (lat === null || lon === null) continue
      if (lat === undefined || lon === undefined) continue

      if (originLat === null) {
        originLat = lat
        originLon = lon
        metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
      }

      points.push({
        x: (lon - originLon) * metersPerDegLon,
        // În SVG axa y crește în jos, deci nordul primește semn negativ.
        y: -(lat - originLat) * METERS_PER_DEG_LAT,
      })
    }

    if (points.length === 0) return null

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const point of points) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }

    const width = Math.max(maxX - minX, 1)
    const depth = Math.max(maxY - minY, 1)
    const extent = Math.max(width, depth)
    const padding = extent * 0.08

    const step = Math.ceil(points.length / MAX_PATH_POINTS)
    const drawn = step > 1 ? points.filter((_, i) => i % step === 0) : points

    const path = drawn
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
      )
      .join(' ')

    const scaleMeters =
      SCALE_STEPS.find((candidate) => candidate > extent * 0.18) ??
      SCALE_STEPS.at(-1)!

    return {
      path,
      current: points.at(-1) ?? null,
      viewBox: `${minX - padding} ${minY - padding} ${width + padding * 2} ${depth + padding * 2}`,
      extent,
      scale: {
        meters: scaleMeters,
        label:
          scaleMeters >= 1_000
            ? `${formatNumber(scaleMeters / 1_000, 1)} km`
            : `${scaleMeters} m`,
      },
      originX: minX - padding * 0.4,
      originY: maxY + padding * 0.6,
    }
    // `tick` este dependența reală: bufferul de istoric se modifică pe loc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, windowSeconds])

  if (!geometry) {
    return (
      <div
        className="grid place-items-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500"
        style={{ height }}
      >
        Fără poziție GPS
      </div>
    )
  }

  const markerRadius = geometry.extent * 0.016
  const fontSize = geometry.extent * 0.032

  return (
    <svg
      viewBox={geometry.viewBox}
      preserveAspectRatio="xMidYMid meet"
      style={{ height, width: '100%' }}
      role="img"
      aria-label="Traseul parcurs, reconstituit din coordonatele GPS"
    >
      <path
        d={geometry.path}
        fill="none"
        stroke="#1684e8"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity={0.9}
      />

      {geometry.current && (
        <>
          <circle
            cx={geometry.current.x}
            cy={geometry.current.y}
            r={markerRadius * 2.2}
            fill="#fbbf24"
            opacity={0.18}
          />
          <circle
            cx={geometry.current.x}
            cy={geometry.current.y}
            r={markerRadius}
            fill="#fbbf24"
            stroke="#09090b"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}

      {/* Scară grafică: fără ea, o reprezentare relativă nu spune nimic despre distanțe. */}
      <g stroke="#71717a" strokeWidth={1.5} vectorEffect="non-scaling-stroke">
        <line
          x1={geometry.originX}
          y1={geometry.originY}
          x2={geometry.originX + geometry.scale.meters}
          y2={geometry.originY}
        />
        <line
          x1={geometry.originX}
          y1={geometry.originY - fontSize * 0.25}
          x2={geometry.originX}
          y2={geometry.originY + fontSize * 0.25}
        />
        <line
          x1={geometry.originX + geometry.scale.meters}
          y1={geometry.originY - fontSize * 0.25}
          x2={geometry.originX + geometry.scale.meters}
          y2={geometry.originY + fontSize * 0.25}
        />
      </g>
      <text
        x={geometry.originX}
        y={geometry.originY - fontSize * 0.5}
        fill="#a1a1aa"
        fontSize={fontSize}
        fontFamily="IBM Plex Sans"
      >
        {geometry.scale.label}
      </text>
    </svg>
  )
}
