import clsx from 'clsx'
import { useMemo } from 'react'
import { NO_VALUE, formatNumber } from '../lib/format'
import { conditionLabel } from '../lib/weather-conditions'
import { estimatedGhiWM2, solarPosition } from '../lib/weather-math'
import { useWeatherStore } from '../stores/weather-store'

/**
 * Prognoza orară, citită ca plan de cursă și nu ca buletin meteo.
 *
 * Coloana care contează este iradianța estimată: temperatura de peste patru ore
 * nu schimbă nimic, dar „la ora 17 rămân 180 W/m²" schimbă când se face
 * schimbul de pilot și cât se poate cheltui din pachet până atunci. O calculăm
 * aici, pentru fiecare oră, din poziția soarelui la acel moment și din
 * nebulozitatea prognozată — furnizorul nu o raportează.
 */

type HourRow = {
  key: string
  label: string
  temperatureC: number | null
  cloudPct: number | null
  ghiWM2: number | null
  windKph: number | null
  windFromDeg: number | null
  rainPct: number | null
  description: string | null
}

const hourFormatter = new Intl.DateTimeFormat('ro-RO', {
  hour: '2-digit',
  minute: '2-digit',
})

export function WeatherForecast() {
  const report = useWeatherStore((state) => state.report)

  const rows = useMemo<HourRow[]>(() => {
    const latitude = report.location?.latitude ?? null
    const longitude = report.location?.longitude ?? null

    return report.forecast.map((hour) => {
      const when = new Date(hour.start_time)
      const sun = solarPosition(when, latitude, longitude)

      return {
        key: hour.start_time,
        label: Number.isNaN(when.getTime())
          ? NO_VALUE
          : hourFormatter.format(when),
        temperatureC: hour.values.temperature_c,
        cloudPct: hour.values.cloud_cover_pct,
        ghiWM2: estimatedGhiWM2(
          sun?.elevationDeg ?? null,
          hour.values.cloud_cover_pct,
        ),
        windKph: hour.values.wind_speed_kph,
        windFromDeg: hour.values.wind_from_deg,
        rainPct: hour.values.precipitation_probability_pct,
        description: conditionLabel(
          hour.condition.type,
          hour.condition.description,
        ),
      }
    })
  }, [report])

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500" role="status">
        Fără prognoză. Apare odată cu primul răspuns al serviciului de vreme.
      </p>
    )
  }

  const peakGhi = Math.max(
    1,
    ...rows.map((row) => (row.ghiWM2 === null ? 0 : row.ghiWM2)),
  )

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-2" aria-label="Prognoză orară">
        {rows.map((row) => (
          <li
            key={row.key}
            className="w-32 shrink-0 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5"
            data-hour={row.label}
          >
            <p className="text-sm font-semibold text-zinc-200">{row.label}</p>
            <p
              className="mt-0.5 truncate text-[11px] text-zinc-500"
              title={row.description ?? undefined}
            >
              {row.description ?? NO_VALUE}
            </p>

            <p className="mt-2 text-lg font-semibold text-zinc-100 tabular-nums">
              {row.temperatureC === null
                ? NO_VALUE
                : `${formatNumber(row.temperatureC, 0)} °C`}
            </p>

            {/* Bara arată iradianța relativ la cea mai bună oră din interval:
                forma coloanelor spune dintr-o privire când se închide fereastra
                solară, fără ca nimeni să compare cifre între ele. */}
            <div
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
              role="presentation"
            >
              <div
                className={clsx(
                  'h-full rounded-full',
                  row.ghiWM2 !== null && row.ghiWM2 > peakGhi * 0.6
                    ? 'bg-amber-400'
                    : 'bg-sky-400/70',
                )}
                style={{
                  width: `${row.ghiWM2 === null ? 0 : (row.ghiWM2 / peakGhi) * 100}%`,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] text-zinc-400 tabular-nums">
              {row.ghiWM2 === null
                ? NO_VALUE
                : `${formatNumber(row.ghiWM2, 0)} W/m²`}
            </p>

            <dl className="mt-2 space-y-0.5 text-[11px] text-zinc-500">
              <div className="flex justify-between gap-2">
                <dt>Nori</dt>
                <dd className="tabular-nums">
                  {row.cloudPct === null
                    ? NO_VALUE
                    : `${formatNumber(row.cloudPct, 0)} %`}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Vânt</dt>
                <dd className="tabular-nums">
                  {row.windKph === null
                    ? NO_VALUE
                    : `${formatNumber(row.windKph, 0)} km/h`}
                  {row.windFromDeg === null ? null : (
                    <span
                      className="ml-1 inline-block"
                      style={{
                        // Săgeata arată încotro *merge* vântul, deci direcția
                        // din care bate, rotită cu 180°.
                        transform: `rotate(${row.windFromDeg + 180}deg)`,
                      }}
                      aria-hidden="true"
                    >
                      ↑
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Ploaie</dt>
                <dd className="tabular-nums">
                  {row.rainPct === null
                    ? NO_VALUE
                    : `${formatNumber(row.rainPct, 0)} %`}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}
