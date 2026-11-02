import { describe, expect, it } from 'vitest'
import { normalizeZoomFactor, stepZoom } from './zoom'

describe('GH237 — paliers de zoom', () => {
  it('U1 — palier suivant / précédent, bornes, retour à 100 %', () => {
    expect(stepZoom(1, 'in')).toBe(1.1)
    expect(stepZoom(1, 'out')).toBe(0.9)
    expect(stepZoom(1.1, 'in')).toBe(1.25)
    expect(stepZoom(3, 'in')).toBe(3)
    expect(stepZoom(0.5, 'out')).toBe(0.5)
    expect(stepZoom(2.5, 'reset')).toBe(1)
  })

  it('U2 — normalisation des valeurs lues', () => {
    expect(normalizeZoomFactor(undefined)).toBe(1)
    expect(normalizeZoomFactor('abc')).toBe(1)
    expect(normalizeZoomFactor(NaN)).toBe(1)
    expect(normalizeZoomFactor(7)).toBe(3)
    expect(normalizeZoomFactor(0.1)).toBe(0.5)
    expect(normalizeZoomFactor(1.12)).toBe(1.1)
  })
})
