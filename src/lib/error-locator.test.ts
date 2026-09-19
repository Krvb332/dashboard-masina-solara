import { describe, expect, it } from 'vitest'
import { makeSignal } from '../test/fixtures'
import {
  anchorSelector,
  findErrorTarget,
  locateError,
  locateSignal,
  signalSelector,
} from './error-locator'

const catalogByKey = Object.fromEntries(
  [
    makeSignal({ key: 'battery_soc_pct', group: 'energy', overview: true }),
    makeSignal({ key: 'battery_voltage_v', group: 'energy' }),
    makeSignal({ key: 'battery_temp_max_c', group: 'thermal', overview: true }),
    makeSignal({ key: 'motor_temp_c', group: 'thermal' }),
    makeSignal({ key: 'gps_hdop', group: 'gps' }),
    makeSignal({ key: 'tpms_fl_pressure_bar', group: 'chassis' }),
    makeSignal({ key: 'board_uptime_s', group: 'board' }),
    makeSignal({ key: 'lap_number', group: 'status' }),
    makeSignal({ key: 'motor_fault_code', group: 'motor' }),
    makeSignal({ key: 'cell_min_index', group: 'energy' }),
    makeSignal({ key: 'cell_07_v', group: 'energy' }),
  ].map((signal) => [signal.key, signal]),
)

describe('locateError', () => {
  it('duce legătura și fluxul la panoul cu sănătatea fluxului', () => {
    expect(
      locateError({ id: 'connection', source: 'connection' }, catalogByKey),
    ).toEqual({ path: '/sistem', selectors: [anchorSelector('connection')] })

    expect(
      locateError({ id: 'stream:invalid', source: 'stream' }, catalogByKey),
    ).toEqual({
      path: '/sistem',
      selectors: [anchorSelector('stream-invalid')],
    })
  })

  it('duce un bit al controllerului la rândul lui, cu panoul ca rezervă', () => {
    expect(
      locateError({ id: 'fault:17', source: 'fault' }, catalogByKey),
    ).toEqual({
      path: '/sistem',
      selectors: ['[data-fault-bit="17"]', anchorSelector('faults')],
    })
  })

  it('duce o alarmă la semnalul ei', () => {
    expect(
      locateError(
        {
          id: 'alarm:pack-low',
          source: 'alarm',
          signalKey: 'battery_voltage_v',
        },
        catalogByKey,
      ),
    ).toEqual({
      path: '/energie',
      selectors: [signalSelector('battery_voltage_v')],
    })
  })

  it('o alarmă fără semnal atașat nu are unde să ducă', () => {
    expect(
      locateError({ id: 'alarm:generic', source: 'alarm' }, catalogByKey),
    ).toBeNull()
  })

  it('un senzor defect se găsește după cheia din id chiar fără signalKey', () => {
    expect(
      locateError({ id: 'signal:gps_hdop', source: 'signal' }, catalogByKey),
    ).toEqual({ path: '/traseu', selectors: [signalSelector('gps_hdop')] })
  })
})

describe('locateSignal', () => {
  it('semnalele din prezentarea generală au cardul pe prima pagină', () => {
    expect(
      locateSignal('battery_temp_max_c', catalogByKey.battery_temp_max_c).path,
    ).toBe('/')
    expect(
      locateSignal('battery_soc_pct', catalogByKey.battery_soc_pct).path,
    ).toBe('/')
  })

  it('restul urmează pagina grupului', () => {
    const paths = Object.fromEntries(
      [
        'battery_voltage_v',
        'motor_temp_c',
        'gps_hdop',
        'tpms_fl_pressure_bar',
        'board_uptime_s',
      ].map((key) => [key, locateSignal(key, catalogByKey[key]).path]),
    )

    expect(paths).toEqual({
      battery_voltage_v: '/energie',
      motor_temp_c: '/sistem',
      gps_hdop: '/traseu',
      tpms_fl_pressure_bar: '/sistem',
      board_uptime_s: '/sistem',
    })
  })

  it('turul și distanța se citesc pe pagina de traseu, nu după grup', () => {
    expect(locateSignal('lap_number', catalogByKey.lap_number).path).toBe(
      '/traseu',
    )
    expect(locateSignal('distance_km', undefined).path).toBe('/traseu')
  })

  it('un semnal necunoscut cade pe pagina de sistem, unde tabelul le are pe toate', () => {
    expect(locateSignal('semnal_nou', undefined)).toEqual({
      path: '/sistem',
      selectors: [signalSelector('semnal_nou')],
    })
  })

  it('codul de eroare duce întâi la panoul de biți', () => {
    expect(
      locateSignal('motor_fault_code', catalogByKey.motor_fault_code),
    ).toEqual({
      path: '/sistem',
      selectors: [anchorSelector('faults'), signalSelector('motor_fault_code')],
    })
  })

  it('indicele celulei minime cade pe grila de celule', () => {
    expect(locateSignal('cell_min_index', catalogByKey.cell_min_index)).toEqual(
      {
        path: '/energie',
        selectors: [signalSelector('cell_min_index'), anchorSelector('cells')],
      },
    )
    // O celulă are bara ei, dar grila rămâne rezervă dacă catalogul o pierde.
    expect(locateSignal('cell_07_v', catalogByKey.cell_07_v).selectors).toEqual(
      [signalSelector('cell_07_v'), anchorSelector('cells')],
    )
  })

  it('scapă ghilimelele din cheie în selector', () => {
    expect(signalSelector('a"b')).toBe('[data-signal="a\\"b"]')
  })
})

describe('findErrorTarget', () => {
  it('respectă ordinea selectorilor, nu ordinea din document', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<ul data-error-anchor="faults"><li data-fault-bit="17">x</li></ul>'

    const found = findErrorTarget(
      ['[data-fault-bit="17"]', anchorSelector('faults')],
      root,
    )
    expect(found?.tagName).toBe('LI')
  })

  it('cade pe rezervă când primul selector nu există', () => {
    const root = document.createElement('div')
    root.innerHTML = '<ul data-error-anchor="faults"></ul>'

    const found = findErrorTarget(
      ['[data-fault-bit="17"]', anchorSelector('faults')],
      root,
    )
    expect(found?.tagName).toBe('UL')
  })

  it('întoarce null fără rădăcină sau fără potrivire', () => {
    expect(findErrorTarget(['[data-signal="x"]'], null)).toBeNull()
    expect(
      findErrorTarget(['[data-signal="x"]'], document.createElement('div')),
    ).toBeNull()
  })
})
