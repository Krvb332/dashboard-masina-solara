import { describe, expect, it } from 'vitest'
import {
  classify,
  runConsistencyChecks,
  summarizeConsistency,
  type ValueLookup,
} from './consistency'

/**
 * Un control pozitiv pentru fiecare verificare negativă: înainte să ne bazăm pe
 * faptul că o nepotrivire *nu* este raportată, arătăm că aceeași verificare
 * chiar raportează una când există. Altfel „niciun semnal greșit" ar putea
 * însemna doar „verificarea nu funcționează".
 */

function lookupFrom(values: Record<string, number>): ValueLookup {
  return (key) => (key in values ? values[key] : null)
}

/** Un pachet coerent: 32 de celule de 3,6 V, 115,2 V, 20 A, 2304 W. */
function coherentPack(): Record<string, number> {
  const cells: Record<string, number> = {}
  for (let index = 1; index <= 32; index += 1) {
    cells[`cell_${String(index).padStart(2, '0')}_v`] = 3.6
  }

  return {
    ...cells,
    battery_voltage_v: 115.2,
    battery_current_a: 20,
    battery_power_w: 2304,
    cell_voltage_min_v: 3.58,
    cell_voltage_max_v: 3.62,
    cell_voltage_delta_v: 0.04,
    battery_temp_min_c: 30,
    battery_temp_max_c: 36,
    battery_temp_delta_c: 6,
    mppt1_power_w: 200,
    mppt2_power_w: 210,
    mppt3_power_w: 190,
    mppt4_power_w: 200,
    solar_power_w: 800,
    vehicle_speed_kph: 44,
    gps_speed_kph: 45,
  }
}

const statusOf = (
  results: ReturnType<typeof runConsistencyChecks>,
  key: string,
) => results.find((result) => result.key === key)?.status

describe('un lanț de măsurători coerent', () => {
  it('trece toate verificările', () => {
    const results = runConsistencyChecks(lookupFrom(coherentPack()))
    const summary = summarizeConsistency(results)

    expect(summary.mismatch).toBe(0)
    expect(summary.unknown).toBe(0)
    expect(summary.ok).toBe(summary.total)
  })
})

describe('greșeli de scalare — control pozitiv pentru fiecare verificare', () => {
  it('prinde o putere de pachet raportată de zece ori mai mică', () => {
    const values = { ...coherentPack(), battery_power_w: 230.4 }
    expect(
      statusOf(runConsistencyChecks(lookupFrom(values)), 'battery_power'),
    ).toBe('mismatch')
  })

  it('prinde un MPPT care lipsește din totalul solar', () => {
    const values = { ...coherentPack(), solar_power_w: 600 }
    expect(
      statusOf(runConsistencyChecks(lookupFrom(values)), 'solar_power'),
    ).toBe('mismatch')
  })

  it('prinde un dezechilibru de celule care nu corespunde extremelor', () => {
    const values = { ...coherentPack(), cell_voltage_delta_v: 0.4 }
    expect(
      statusOf(runConsistencyChecks(lookupFrom(values)), 'cell_delta'),
    ).toBe('mismatch')
  })

  it('prinde o deltă de temperatură luată de pe alt senzor', () => {
    const values = { ...coherentPack(), battery_temp_delta_c: 22 }
    expect(
      statusOf(runConsistencyChecks(lookupFrom(values)), 'battery_temp_delta'),
    ).toBe('mismatch')
  })

  it('prinde un pachet cu alt număr de celule decât cel din catalog', () => {
    const values = coherentPack()
    // Doar 24 de celule montate: suma iese 86,4 V, nu 115,2 V.
    for (let index = 25; index <= 32; index += 1) {
      delete values[`cell_${String(index).padStart(2, '0')}_v`]
    }
    // Suma parțială nu se compară: o celulă tăcută nu este o mapare greșită.
    expect(
      statusOf(runConsistencyChecks(lookupFrom(values)), 'pack_voltage'),
    ).toBe('unknown')

    const rescaled = coherentPack()
    for (let index = 1; index <= 32; index += 1) {
      rescaled[`cell_${String(index).padStart(2, '0')}_v`] = 2.7
    }
    expect(
      statusOf(runConsistencyChecks(lookupFrom(rescaled)), 'pack_voltage'),
    ).toBe('mismatch')
  })

  it('prinde o circumferință de roată greșită în firmware', () => {
    const values = { ...coherentPack(), vehicle_speed_kph: 62 }
    expect(
      statusOf(runConsistencyChecks(lookupFrom(values)), 'speed_source'),
    ).toBe('mismatch')
  })
})

describe('absența datelor', () => {
  it('un semnal lipsă dă „necunoscut”, nu „în regulă”', () => {
    const results = runConsistencyChecks(lookupFrom({}))
    const summary = summarizeConsistency(results)

    expect(summary.ok).toBe(0)
    expect(summary.mismatch).toBe(0)
    expect(summary.unknown).toBe(summary.total)
  })

  it('o singură lipsă nu invalidează celelalte verificări', () => {
    const values = coherentPack()
    delete values.gps_speed_kph

    const results = runConsistencyChecks(lookupFrom(values))
    expect(statusOf(results, 'speed_source')).toBe('unknown')
    expect(statusOf(results, 'battery_power')).toBe('ok')
  })
})

describe('toleranțe', () => {
  it('abaterea absolută protejează valorile mici', () => {
    // 0 W așteptat, 30 W raportat: relativ ar fi infinit, absolut este în limită.
    const result = classify({
      key: 'test',
      label: 'test',
      expected: 0,
      actual: 30,
      unit: 'W',
      decimals: 0,
      tolerancePct: 5,
      toleranceAbs: 60,
      hint: '',
    })
    expect(result.status).toBe('ok')
  })

  it('abaterea relativă prinde erorile la valori mari', () => {
    const result = classify({
      key: 'test',
      label: 'test',
      expected: 4000,
      actual: 3000,
      unit: 'W',
      decimals: 0,
      tolerancePct: 5,
      toleranceAbs: 60,
      hint: '',
    })
    expect(result.status).toBe('mismatch')
    expect(result.deviation).toBe(1000)
  })
})
