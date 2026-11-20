import { describe, expect, it } from 'vitest'
import { clampMenuPosition } from './useMenuPosition'

// Menu contextuel `fixed` : jamais hors de la fenêtre (1000 × 700, menu 176 × 220).
describe('clampMenuPosition', () => {
  it('reste au point du clic quand il tient dans la fenêtre', () => {
    expect(clampMenuPosition(300, 200, 176, 220, 1000, 700)).toEqual({ left: 300, top: 200 })
  })

  it('remonte quand il est ouvert près du bas (entrées du bas accessibles)', () => {
    // Clic à y=650 : 650 + 220 dépasse 700 − 8 ; le menu est ramené à 700 − 8 − 220 = 472.
    expect(clampMenuPosition(300, 650, 176, 220, 1000, 700)).toEqual({ left: 300, top: 472 })
  })

  it('se décale vers la gauche quand il est ouvert près du bord droit', () => {
    expect(clampMenuPosition(990, 100, 176, 220, 1000, 700)).toEqual({ left: 816, top: 100 })
  })

  it('ne sort jamais par le haut ou la gauche, même plus grand que la fenêtre', () => {
    expect(clampMenuPosition(-5, -5, 176, 220, 1000, 700)).toEqual({ left: 8, top: 8 })
    expect(clampMenuPosition(100, 100, 176, 900, 1000, 700)).toEqual({ left: 100, top: 8 })
  })
})
