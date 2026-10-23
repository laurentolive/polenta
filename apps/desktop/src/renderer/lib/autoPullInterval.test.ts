import { describe, expect, it } from 'vitest'
import { effectivePullIntervalMinutes } from './autoPullInterval'

describe('GH65 — effectivePullIntervalMinutes', () => {
  it('entier dans [1, 60] : valeur conservée', () => {
    expect(effectivePullIntervalMinutes(1)).toBe(1)
    expect(effectivePullIntervalMinutes(15)).toBe(15)
    expect(effectivePullIntervalMinutes(60)).toBe(60)
  })

  it('1.25 — absent ou invalide : 5', () => {
    for (const v of [undefined, null, 0, -3, 'abc', '10', 1.5, 120, Number.NaN, Infinity]) {
      expect(effectivePullIntervalMinutes(v)).toBe(5)
    }
  })
})
