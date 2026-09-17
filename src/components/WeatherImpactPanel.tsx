import { StatTile } from './StatTile'
import { toneAbove, toneBelow } from '../lib/stat-tone'
import { useWeatherImpact } from '../hooks/useWeather'
import { useWeatherStore } from '../stores/weather-store'

/**
 * Ce înseamnă vremea pentru mașină, în cifre cu formula la vedere.
 *
 * Fiecare valoare de aici este derivată, nu măsurată, și de aceea poartă
 * formula sub ea: cine citește „−184 W” trebuie să poată verifica din ce a
 * ieșit. Este aceeași regulă ca la panoul de consum, din același motiv — o
 * cifră pe care nu o poți reface este o părere.
 */
export function WeatherImpactPanel() {
  const impact = useWeatherImpact()
  const arrayAreaM2 = useWeatherStore((state) => state.arrayAreaM2)
  const setArrayArea = useWeatherStore((state) => state.setArrayArea)

  return (
    <div className="grid gap-4">
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Efectul aerului asupra mașinii"
      >
        <StatTile
          label="Densitatea aerului"
          value={impact.airDensityKgM3}
          unit="kg/m³"
          decimals={3}
          formula="p_uscat/(R_d·T) + e/(R_v·T)"
          hint="Aerul cald, umed sau de altitudine este mai rar, deci opune mai puțină rezistență."
        />
        <StatTile
          label="Față de atmosfera standard"
          value={
            impact.relativeDensity === null
              ? null
              : impact.relativeDensity * 100
          }
          unit="%"
          decimals={1}
          formula="ρ / 1,225"
          tone={
            impact.relativeDensity === null
              ? 'neutral'
              : impact.relativeDensity < 1
                ? 'good'
                : 'warn'
          }
        />
        <StatTile
          label="Vânt frontal"
          value={impact.headwindKph}
          unit="km/h"
          decimals={1}
          formula="v_vânt · cos(direcție − cap)"
          hint="Pozitiv = din față. Negativ = din spate."
          tone={toneAbove(impact.headwindKph, 8, 20)}
        />
        <StatTile
          label="Vânt lateral"
          value={impact.crosswindKph}
          unit="km/h"
          decimals={1}
          formula="v_vânt · sin(direcție − cap)"
          hint="Pozitiv = dinspre dreapta mașinii."
        />
      </section>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Efectul aerodinamic"
      >
        <StatTile
          label="Viteza aerului"
          value={impact.apparentAirSpeedKph}
          unit="km/h"
          decimals={1}
          formula="v_sol + v_frontal"
          hint="Viteza pe care o „vede” caroseria, nu cea de pe bord."
        />
        <StatTile
          label="Putere aerodinamică"
          value={impact.aeroPowerW}
          unit="W"
          decimals={0}
          formula="½·ρ·CdA·v_aer²·v_sol"
          tone={toneAbove(impact.aeroPowerW, 500, 900)}
        />
        <StatTile
          label="Costul vântului"
          value={impact.windPenaltyW}
          unit="W"
          decimals={0}
          formula="P_aero(cu vânt) − P_aero(aer liniștit)"
          hint="Cât din puterea aerodinamică este pusă acolo de vânt."
          tone={
            impact.windPenaltyW === null
              ? 'neutral'
              : impact.windPenaltyW > 60
                ? 'bad'
                : impact.windPenaltyW < -60
                  ? 'good'
                  : 'neutral'
          }
        />
        <StatTile
          label="Viteză economică"
          value={impact.economicSpeedKph}
          unit="km/h"
          decimals={1}
          formula="∛(P_aux / (ρ·CdA))"
          hint="Recalculată cu densitatea reală a aerului, nu cu cea standard."
        />
      </section>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Potențialul solar"
      >
        <StatTile
          label="Înălțimea soarelui"
          value={impact.solarElevationDeg}
          unit="°"
          decimals={1}
          formula="algoritm NOAA, din poziție și oră"
          tone={toneBelow(impact.solarElevationDeg, 15, 5)}
        />
        <StatTile
          label="Iradianță estimată"
          value={impact.estimatedGhiWM2}
          unit="W/m²"
          decimals={0}
          formula="GHI_senin · (1 − 0,75·nori^3,4)"
          hint="Haurwitz pentru cer senin, Kasten-Czeplak pentru atenuarea de nori."
        />
        <StatTile
          label="Pierdut în nori"
          value={impact.cloudLossPct}
          unit="%"
          decimals={0}
          formula="1 − GHI / GHI_senin"
          tone={toneAbove(impact.cloudLossPct, 30, 60)}
        />
        <StatTile
          label="Aria efectivă de captare"
          value={impact.effectiveApertureM2}
          unit="m²"
          decimals={2}
          formula="P_solar / GHI"
          hint="Suprafață × randament, dedusă din măsurători. O scădere bruscă la soare neschimbat înseamnă un șir căzut."
        />
      </section>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Panourile fotovoltaice"
      >
        <StatTile
          label="Temperatura celulelor"
          value={impact.cellTemperatureC}
          unit="°C"
          decimals={1}
          formula="T_aer + (NOCT − 20)/800 · GHI"
          tone={toneAbove(impact.cellTemperatureC, 55, 70)}
        />
        <StatTile
          label="Pierdere termică panouri"
          value={impact.pvTemperatureLossPct}
          unit="%"
          decimals={1}
          formula="−0,35 %/°C peste 25 °C"
          tone={toneAbove(impact.pvTemperatureLossPct, 8, 15)}
        />
        <StatTile
          label="Randament array"
          value={impact.solarYieldPct}
          unit="%"
          decimals={1}
          formula="P_solar / (GHI · suprafață)"
          hint="Apare doar după ce suprafața array-ului este completată mai jos."
        />
        <StatTile
          label="Soarele față de mașină"
          value={impact.sunRelativeBearingDeg}
          unit="°"
          decimals={0}
          formula="|azimut soare − cap compas|"
          hint="0° = soarele în față, 180° = în spate. Util pentru orientarea la staționare."
        />
      </section>

      <label className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-400">
        <span className="min-w-0">Suprafața array-ului fotovoltaic</span>
        <input
          type="number"
          min={0}
          step={0.1}
          inputMode="decimal"
          value={arrayAreaM2 ?? ''}
          placeholder="necunoscută"
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value)
            setArrayArea(Number.isFinite(parsed) ? parsed : null)
          }}
          className="min-h-9 w-28 rounded-lg border border-white/10 bg-black/30 px-2 text-right text-zinc-100 tabular-nums"
          aria-label="Suprafața array-ului fotovoltaic, în metri pătrați"
        />
        <span>m²</span>
        <span className="min-w-0 basis-full text-xs text-zinc-600">
          Cât timp câmpul este gol, randamentul array-ului rămâne „—”: un
          procent calculat pe o suprafață presupusă ar fi o părere afișată ca
          măsurătoare.
        </span>
      </label>
    </div>
  )
}
