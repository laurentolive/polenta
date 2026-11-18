import { describe, expect, it } from 'vitest'
import { autoWidth, clampFreezeCount, columnWidth, draggedWidth, dropSide, freezeOffsets, reorderColumns, MIN_AUTO_WIDTH } from './columnLayout'

// GH389 U2 — largeurs, gel, réordonnancement.
describe('GH389 U2 — columnLayout', () => {
  it('largeur auto : texte le plus long, bornée', () => {
    expect(autoWidth('ID', ['SYS-001'], 400)).toBe(7 * 7 + 24)
    expect(autoWidth('ID', [], 400)).toBe(MIN_AUTO_WIDTH)
    expect(autoWidth('Titre', ['x'.repeat(200)], 300)).toBe(300)
    expect(autoWidth('Titre long en tête', ['a'], 400)).toBe(18 * 7 + 24)
  })

  it('largeur choisie prioritaire sur l’auto', () => {
    expect(columnWidth('a', { a: 250 }, { a: 90 })).toBe(250)
    expect(columnWidth('a', {}, { a: 90 })).toBe(90)
    expect(columnWidth('b', {}, {})).toBe(120)
    expect(draggedWidth(100, -95)).toBe(20)
    expect(draggedWidth(100, 33.6)).toBe(134)
  })

  it('offsets de gel cumulés depuis la colonne de tête', () => {
    expect(freezeOffsets([100, 80, 60], 24, 2)).toEqual([24, 124])
    expect(freezeOffsets([100, 80], 0, 5)).toEqual([0, 100])
    expect(freezeOffsets([100], 0, 0)).toEqual([])
  })

  it('gel borné au nombre de colonnes', () => {
    expect(clampFreezeCount(5, 3)).toBe(3)
    expect(clampFreezeCount(-1, 3)).toBe(0)
    expect(clampFreezeCount(2, 3)).toBe(2)
    expect(clampFreezeCount(Number.NaN, 3)).toBe(0)
  })

  it('côté de dépôt', () => {
    expect(dropSide(10, { left: 0, width: 100 })).toBe('before')
    expect(dropSide(60, { left: 0, width: 100 })).toBe('after')
  })

  it('réordonnancement avant / après, colonne de tête immobile', () => {
    const order = ['__expand', 'a', 'b', 'c', 'd']
    const fixed = new Set(['__expand'])
    expect(reorderColumns(order, 'd', 'b', 'before', fixed)).toEqual(['__expand', 'a', 'd', 'b', 'c'])
    expect(reorderColumns(order, 'a', 'c', 'after', fixed)).toEqual(['__expand', 'b', 'c', 'a', 'd'])
    expect(reorderColumns(order, 'a', 'c', 'before', fixed)).toEqual(['__expand', 'b', 'a', 'c', 'd'])
    expect(reorderColumns(order, 'a', 'b', 'before', fixed)).toBeNull()
    expect(reorderColumns(order, 'a', '__expand', 'before', fixed)).toBeNull()
    expect(reorderColumns(order, '__expand', 'c', 'after', fixed)).toBeNull()
    expect(reorderColumns(order, 'x', 'c', 'after', fixed)).toBeNull()
  })
})
