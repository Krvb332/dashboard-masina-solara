import { describe, expect, it } from 'vitest'
import {
  PACK_POWER_CEILING_W,
  PACK_POWER_KNEE_W,
  compressPackPowerW,
  expandPackPowerW,
  isCompressedPowerSignal,
  isPackPowerCompressed,
} from './power-scale'

describe('scala de afișare a puterii de pachet', () => {
  it('lasă neatinse valorile de sub prag', () => {
    for (const watts of [0, 120, 1500, 3299.9, PACK_POWER_KNEE_W]) {
      expect(compressPackPowerW(watts)).toBe(watts)
      expect(compressPackPowerW(-watts)).toBe(-watts)
    }
  })

  it('comprimă peste prag și rămâne sub plafon', () => {
    // Pe tot domeniul plauzibil pentru mașină (vârfuri până în 25 kW) curba
    // stă strict sub plafon; dincolo de ~29 kW diferența nu mai încape în
    // dubla precizie și afișarea se lipește de 4 000 W, ceea ce este exact
    // comportamentul dorit la saturație.
    for (const watts of [3301, 4000, 6000, 12_000, 25_000]) {
      const shown = compressPackPowerW(watts)
      expect(shown).toBeGreaterThan(PACK_POWER_KNEE_W)
      expect(shown).toBeLessThan(PACK_POWER_CEILING_W)
    }
    expect(compressPackPowerW(1e6)).toBeLessThanOrEqual(PACK_POWER_CEILING_W)
  })

  it('se racordează fără cot: panta la prag este 1', () => {
    const step = 1e-4
    const under =
      (compressPackPowerW(PACK_POWER_KNEE_W) -
        compressPackPowerW(PACK_POWER_KNEE_W - step)) /
      step
    const over =
      (compressPackPowerW(PACK_POWER_KNEE_W + step) -
        compressPackPowerW(PACK_POWER_KNEE_W)) /
      step

    expect(under).toBeCloseTo(1, 3)
    expect(over).toBeCloseTo(1, 3)
  })

  it('este monotonă și cu pantă descrescătoare peste prag', () => {
    let previousValue = compressPackPowerW(PACK_POWER_KNEE_W)
    let previousSlope = Number.POSITIVE_INFINITY

    for (let watts = PACK_POWER_KNEE_W + 100; watts <= 15_000; watts += 100) {
      const shown = compressPackPowerW(watts)
      const slope = (shown - previousValue) / 100

      expect(shown).toBeGreaterThan(previousValue)
      expect(slope).toBeLessThan(previousSlope)

      previousValue = shown
      previousSlope = slope
    }
  })

  it('tratează încărcarea simetric cu descărcarea', () => {
    expect(compressPackPowerW(-8000)).toBeCloseTo(-compressPackPowerW(8000), 9)
  })

  it('tinde spre 4 kW fără să îi treacă, oricât de mare e vârful', () => {
    expect(compressPackPowerW(3500)).toBeCloseTo(3473.97, 2)
    expect(compressPackPowerW(4000)).toBeCloseTo(3742.48, 2)
    expect(compressPackPowerW(5000)).toBeCloseTo(3938.29, 2)
    expect(compressPackPowerW(6000)).toBeCloseTo(3985.21, 2)
    expect(compressPackPowerW(10_000)).toBeCloseTo(3999.95, 2)
    expect(compressPackPowerW(1e9)).toBeLessThanOrEqual(PACK_POWER_CEILING_W)
  })

  it('se inversează înapoi în valoarea măsurată', () => {
    for (const watts of [-9000, -4200, -3300, -100, 0, 2500, 3300, 4800, 9000]) {
      expect(expandPackPowerW(compressPackPowerW(watts))).toBeCloseTo(watts, 6)
    }
  })

  it('propagă „nu am date" în loc să îl transforme în zero', () => {
    expect(compressPackPowerW(null)).toBeNull()
    expect(expandPackPowerW(null)).toBeNull()
    expect(compressPackPowerW(Number.NaN)).toBeNaN()
  })

  it('spune care semnale folosesc scala și când chiar a schimbat cifra', () => {
    expect(isCompressedPowerSignal('battery_power_w')).toBe(true)
    expect(isCompressedPowerSignal('solar_power_w')).toBe(false)
    expect(isCompressedPowerSignal('motor_power_w')).toBe(false)

    expect(isPackPowerCompressed(3200)).toBe(false)
    expect(isPackPowerCompressed(3400)).toBe(true)
    expect(isPackPowerCompressed(-3400)).toBe(true)
    expect(isPackPowerCompressed(null)).toBe(false)
  })
})
