import clsx from 'clsx'
import {
  CloudRain,
  Cloudy,
  Compass,
  Droplets,
  Eye,
  Gauge,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { NO_VALUE, formatAge, formatClock, formatNumber } from '../lib/format'
import { primaryAdvice } from '../lib/coaching'
import { conditionLabel } from '../lib/weather-conditions'
import { useWeatherAdvice, useWeatherImpact } from '../hooks/useWeather'
import { useWeatherStore } from '../stores/weather-store'
import { useTick } from '../hooks/useTick'

/**
 * Condițiile meteo măsurate, așa cum vin de la furnizor.
 *
 * Panoul face un singur lucru bine: arată ce este afară și cât de veche este
 * informația. Interpretarea — ce înseamnă pentru mașină — stă în
 * `WeatherImpactPanel`, pentru că sunt două întrebări diferite și cine se uită
 * la ecran are de obicei doar una.
 *
 * Starea raportului este afișată *înainte* de cifre, nu după. O observație de
 * acum douăzeci de minute arată identic cu una de acum treizeci de secunde, iar
 * diferența dintre ele poate fi diferența dintre „a stat vântul” și „a căzut
 * internetul".
 */

const cardinalLabels: Record<string, string> = {
  NORTH: 'nord',
  NORTH_NORTHEAST: 'nord-nord-est',
  NORTHEAST: 'nord-est',
  EAST_NORTHEAST: 'est-nord-est',
  EAST: 'est',
  EAST_SOUTHEAST: 'est-sud-est',
  SOUTHEAST: 'sud-est',
  SOUTH_SOUTHEAST: 'sud-sud-est',
  SOUTH: 'sud',
  SOUTH_SOUTHWEST: 'sud-sud-vest',
  SOUTHWEST: 'sud-vest',
  WEST_SOUTHWEST: 'vest-sud-vest',
  WEST: 'vest',
  WEST_NORTHWEST: 'vest-nord-vest',
  NORTHWEST: 'nord-vest',
  NORTH_NORTHWEST: 'nord-nord-vest',
}

function windLabel(cardinal: string | null, degrees: number | null): string {
  const name = cardinal === null ? null : (cardinalLabels[cardinal] ?? null)
  if (name === null && degrees === null) return NO_VALUE
  if (name === null) return `${formatNumber(degrees as number, 0)}°`
  if (degrees === null) return `din ${name}`
  return `din ${name} (${formatNumber(degrees, 0)}°)`
}

export function WeatherStatusLine() {
  const report = useWeatherStore((state) => state.report)
  const error = useWeatherStore((state) => state.error)
  const loading = useWeatherStore((state) => state.loading)
  // Vechimea trebuie să curgă pe ecran chiar dacă nu mai vine niciun răspuns.
  useTick(5000)

  if (report.status === 'unavailable') {
    return (
      <p
        className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-400"
        role="status"
      >
        <span className="font-medium text-zinc-300">
          Fără date meteo
          {loading ? ' — se încearcă…' : '.'}
        </span>{' '}
        {report.reason ?? error ?? 'Serviciul de vreme nu este disponibil.'}{' '}
        Cifrele rămân „{NO_VALUE}”; nu se afișează valori presupuse.
      </p>
    )
  }

  const observed =
    report.current?.observed_at === null ||
    report.current?.observed_at === undefined
      ? NO_VALUE
      : formatClock(report.current.observed_at)

  return (
    <p
      className={clsx(
        'rounded-xl border px-4 py-3 text-sm',
        report.status === 'stale'
          ? 'border-amber-400/30 bg-amber-500/[0.08] text-amber-100'
          : 'border-white/10 bg-white/[0.02] text-zinc-400',
      )}
      role="status"
    >
      {report.status === 'stale' ? (
        <>
          <span className="font-medium">Observație învechită</span> — furnizorul
          nu mai răspunde, se afișează ultima citire bună, de acum{' '}
          {formatAge((report.age_s ?? 0) * 1000)}.{' '}
          {report.reason ? (
            <span className="opacity-80">{report.reason}</span>
          ) : null}
        </>
      ) : (
        <>
          Măsurat la {observed}, acum {formatAge((report.age_s ?? 0) * 1000)}.
        </>
      )}
      {report.location ? (
        <span className="ml-1 text-zinc-500">
          Poziție{' '}
          {report.location.source === 'gps'
            ? 'de la GPS-ul mașinii'
            : 'configurată'}
          : {formatNumber(report.location.latitude, 4)},{' '}
          {formatNumber(report.location.longitude, 4)}.
        </span>
      ) : null}
    </p>
  )
}

/** O linie de valoare meteo. `null` se afișează „—”, niciodată `0`. */
function Reading({
  icon,
  label,
  value,
  unit,
  decimals = 0,
  text,
}: {
  icon: ReactNode
  label: string
  value?: number | null
  unit?: string
  decimals?: number
  text?: string | null
}) {
  const missing =
    text === undefined
      ? value === null || value === undefined || !Number.isFinite(value)
      : text === null

  const shown =
    text !== undefined
      ? (text ?? NO_VALUE)
      : missing
        ? NO_VALUE
        : `${formatNumber(value as number, decimals)}${unit ? ` ${unit}` : ''}`

  return (
    <li
      className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
      data-reading={label}
      data-missing={missing ? 'true' : 'false'}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-400">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={clsx(
          'shrink-0 text-sm font-semibold tabular-nums',
          missing ? 'text-zinc-600' : 'text-zinc-100',
        )}
      >
        {shown}
      </span>
    </li>
  )
}

export function WeatherPanel() {
  const report = useWeatherStore((state) => state.report)
  const values = report.current?.values ?? null
  const condition = report.current?.condition ?? null

  return (
    <div className="grid gap-3">
      <WeatherStatusLine />

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-4xl font-semibold text-white tabular-nums">
          {values?.temperature_c === null || values?.temperature_c === undefined
            ? NO_VALUE
            : `${formatNumber(values.temperature_c, 1)} °C`}
        </p>
        <p className="text-sm text-zinc-400">
          {conditionLabel(condition?.type, condition?.description) ??
            'Condiții necunoscute'}
          {values?.feels_like_c !== null && values?.feels_like_c !== undefined
            ? ` · resimțit ${formatNumber(values.feels_like_c, 1)} °C`
            : ''}
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        <Reading
          icon={<Wind size={15} aria-hidden="true" />}
          label="Vânt"
          value={values?.wind_speed_kph}
          unit="km/h"
        />
        <Reading
          icon={<Compass size={15} aria-hidden="true" />}
          label="Direcția vântului"
          text={
            values === null
              ? null
              : windLabel(values.wind_cardinal, values.wind_from_deg)
          }
        />
        <Reading
          icon={<Wind size={15} aria-hidden="true" />}
          label="Rafale"
          value={values?.wind_gust_kph}
          unit="km/h"
        />
        <Reading
          icon={<Cloudy size={15} aria-hidden="true" />}
          label="Nebulozitate"
          value={values?.cloud_cover_pct}
          unit="%"
        />
        <Reading
          icon={<Droplets size={15} aria-hidden="true" />}
          label="Umiditate"
          value={values?.relative_humidity_pct}
          unit="%"
        />
        <Reading
          icon={<Thermometer size={15} aria-hidden="true" />}
          label="Punct de rouă"
          value={values?.dew_point_c}
          unit="°C"
          decimals={1}
        />
        <Reading
          icon={<Gauge size={15} aria-hidden="true" />}
          label="Presiune (nivelul mării)"
          value={values?.pressure_hpa}
          unit="hPa"
        />
        <Reading
          icon={<Sun size={15} aria-hidden="true" />}
          label="Indice UV"
          value={values?.uv_index}
        />
        <Reading
          icon={<CloudRain size={15} aria-hidden="true" />}
          label="Probabilitate de precipitații"
          value={values?.precipitation_probability_pct}
          unit="%"
        />
        <Reading
          icon={<CloudRain size={15} aria-hidden="true" />}
          label="Precipitații (ultima oră)"
          value={values?.precipitation_mm}
          unit="mm"
          decimals={1}
        />
        <Reading
          icon={<Eye size={15} aria-hidden="true" />}
          label="Vizibilitate"
          value={values?.visibility_km}
          unit="km"
          decimals={1}
        />
        <Reading
          icon={<CloudRain size={15} aria-hidden="true" />}
          label="Probabilitate de furtună"
          value={values?.thunderstorm_probability_pct}
          unit="%"
        />
      </ul>
    </div>
  )
}

/**
 * Rezumatul meteo pentru pagina de prezentare.
 *
 * Patru cifre și o singură propoziție: exact cât încape într-o privire aruncată
 * între două ture. Restul — formulele, prognoza, recomandările complete — stă
 * pe pagina dedicată, la un clic distanță.
 */
export function WeatherSummary() {
  const report = useWeatherStore((state) => state.report)
  const impact = useWeatherImpact()
  const advice = useWeatherAdvice()
  const values = report.current?.values ?? null
  const main = primaryAdvice(advice)

  if (report.status === 'unavailable') {
    return (
      <p className="text-sm text-zinc-500" role="status">
        Fără date meteo. {report.reason ?? ''} Secțiunea completă este la{' '}
        <Link
          to="/vreme"
          className="text-sky-300 underline-offset-2 hover:underline"
        >
          Vreme
        </Link>
        .
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-2xl font-semibold text-white tabular-nums">
          {values?.temperature_c === null || values?.temperature_c === undefined
            ? NO_VALUE
            : `${formatNumber(values.temperature_c, 1)} °C`}
        </p>
        <p className="text-sm text-zinc-400">
          {conditionLabel(
            report.current?.condition.type,
            report.current?.condition.description,
          ) ?? 'Condiții necunoscute'}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <SummaryItem
          label="Vânt frontal"
          value={impact.headwindKph}
          unit="km/h"
          decimals={0}
        />
        <SummaryItem
          label="Nebulozitate"
          value={values?.cloud_cover_pct ?? null}
          unit="%"
          decimals={0}
        />
        <SummaryItem
          label="Iradianță"
          value={impact.estimatedGhiWM2}
          unit="W/m²"
          decimals={0}
        />
        <SummaryItem
          label="Densitatea aerului"
          value={impact.airDensityKgM3}
          unit="kg/m³"
          decimals={3}
        />
      </dl>

      {main !== null ? (
        <p
          className={clsx(
            'rounded-xl border px-3 py-2 text-sm',
            main.level === 'critical'
              ? 'border-rose-400/30 bg-rose-500/[0.09] text-rose-100'
              : main.level === 'warning'
                ? 'border-amber-400/30 bg-amber-500/[0.08] text-amber-100'
                : main.level === 'good'
                  ? 'border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-100'
                  : 'border-sky-400/25 bg-sky-500/[0.07] text-sky-100',
          )}
          data-advice={main.id}
        >
          <span className="font-semibold">{main.title}.</span> {main.action}
        </p>
      ) : null}
    </div>
  )
}

function SummaryItem({
  label,
  value,
  unit,
  decimals,
}: {
  label: string
  value: number | null
  unit: string
  decimals: number
}) {
  const missing = value === null || !Number.isFinite(value)

  return (
    <div
      className="min-w-0 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5"
      data-summary={label}
      data-missing={missing ? 'true' : 'false'}
    >
      <dt className="truncate text-[11px] tracking-wide text-zinc-500 uppercase">
        {label}
      </dt>
      <dd
        className={clsx(
          'tabular-nums',
          missing ? 'text-zinc-600' : 'text-zinc-100',
        )}
      >
        {missing
          ? NO_VALUE
          : `${formatNumber(value as number, decimals)} ${unit}`}
      </dd>
    </div>
  )
}
