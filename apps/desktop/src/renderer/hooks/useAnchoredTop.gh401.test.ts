import { describe, expect, it } from 'vitest'
import { anchoredTop } from './useAnchoredTop'

// GH401 — popover `fixed` ouvert sous une ancre : jamais hors de la fenêtre (hauteur 900).
describe('anchoredTop', () => {
  it('sous l\'ancre quand il y tient', () => {
    expect(anchoredTop(112, 505, 480, 900)).toBe(505)
  })

  it('au-dessus de l\'ancre quand il ne tient pas dessous (ligne en bas de la fenêtre)', () => {
    // Ancre 870–891 : dessous, 112 px ne tiennent pas ; au-dessus : 870 − 4 − 112.
    expect(anchoredTop(112, 895, 870, 900)).toBe(754)
  })

  it('collé au bas de la fenêtre quand il ne tient ni dessous ni dessus', () => {
    expect(anchoredTop(500, 404, 380, 900)).toBe(392)
  })

  it('plus haut que la fenêtre : aligné sur la marge du haut', () => {
    expect(anchoredTop(1200, 404, 380, 900)).toBe(8)
  })
})
