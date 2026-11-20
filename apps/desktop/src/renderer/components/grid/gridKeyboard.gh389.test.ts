import { describe, expect, it } from 'vitest'
import { nextCell, type KeyboardRow } from './gridKeyboard'

// GH389 U3 — navigation clavier.
const rows: KeyboardRow[] = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }]
const cols = ['id', 'title', 'decision']
const at = (rowId: string, col: string) => ({ rowId, col })

describe('GH389 U3 — gridKeyboard', () => {
  it('↓ ×3 puis → ×2 depuis la première cellule', () => {
    let cell = at('r1', 'id')
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) cell = nextCell(rows, cols, cell, { key })!.cell
    expect(cell).toEqual(at('r4', 'decision'))
  })

  it('↑/↓ bornés, la ligne devient la sélection', () => {
    expect(nextCell(rows, cols, at('r1', 'title'), { key: 'ArrowUp' })).toEqual({ cell: at('r1', 'title'), selectRow: true })
    expect(nextCell(rows, cols, at('r4', 'title'), { key: 'ArrowDown' })!.cell).toEqual(at('r4', 'title'))
  })

  it('←/→ bornés', () => {
    expect(nextCell(rows, cols, at('r2', 'id'), { key: 'ArrowLeft' })!.cell).toEqual(at('r2', 'id'))
    expect(nextCell(rows, cols, at('r2', 'decision'), { key: 'ArrowRight' })!.cell).toEqual(at('r2', 'decision'))
  })

  it('Tab en fin de ligne → ligne suivante, première colonne', () => {
    expect(nextCell(rows, cols, at('r1', 'decision'), { key: 'Tab' })).toEqual({ cell: at('r2', 'id'), selectRow: true })
    expect(nextCell(rows, cols, at('r1', 'id'), { key: 'Tab' })!.cell).toEqual(at('r1', 'title'))
  })

  it('Maj+Tab en début de ligne → ligne précédente, dernière colonne', () => {
    expect(nextCell(rows, cols, at('r2', 'id'), { key: 'Tab', shift: true })!.cell).toEqual(at('r1', 'decision'))
    expect(nextCell(rows, cols, at('r1', 'id'), { key: 'Tab', shift: true })!.cell).toEqual(at('r1', 'id'))
  })

  it('Tab sur la dernière cellule : reste', () => {
    expect(nextCell(rows, cols, at('r4', 'decision'), { key: 'Tab' })!.cell).toEqual(at('r4', 'decision'))
  })

  it('Maj+↓ étend la sélection', () => {
    expect(nextCell(rows, cols, at('r1', 'id'), { key: 'ArrowDown', shift: true })).toEqual({ cell: at('r2', 'id'), extendSelection: true })
  })

  it('Entrée / F2 : édition si éditable, sinon action de la ligne', () => {
    const isEditable = (c: { col: string }) => c.col === 'decision'
    expect(nextCell(rows, cols, at('r1', 'decision'), { key: 'Enter' }, { isEditable })!.action).toBe('edit')
    expect(nextCell(rows, cols, at('r1', 'decision'), { key: 'F2' }, { isEditable })!.action).toBe('edit')
    expect(nextCell(rows, cols, at('r1', 'id'), { key: 'Enter' }, { isEditable })!.action).toBe('activate')
  })

  it('Espace bascule la ligne', () => {
    expect(nextCell(rows, cols, at('r2', 'title'), { key: ' ' })!.action).toBe('toggle')
  })

  it('←/→ sur une ligne de groupe : replier / déplier', () => {
    const tree: KeyboardRow[] = [{ id: 'f1', group: { col: 'name', expanded: true } }, { id: 'r1' }]
    const treeCols = ['id', 'name']
    expect(nextCell(tree, treeCols, at('f1', 'name'), { key: 'ArrowLeft' })!.action).toBe('collapse')
    expect(nextCell(tree, treeCols, at('f1', 'name'), { key: 'ArrowRight' })!.action).toBe('expand')
    // La colonne du groupe est gardée en descendant.
    expect(nextCell(tree, treeCols, at('f1', 'name'), { key: 'ArrowDown' })!.cell).toEqual(at('r1', 'name'))
    // Tab sur un groupe : une seule cellule, passe à la ligne suivante.
    expect(nextCell(tree, treeCols, at('f1', 'name'), { key: 'Tab' })!.cell).toEqual(at('r1', 'id'))
  })

  it('colonne de dépli : → déplie, ← replie, sinon déplacement', () => {
    const expanded = new Set(['r2'])
    const opts = { expandCol: '__expand', isExpanded: (id: string) => expanded.has(id) }
    const c = ['__expand', 'id']
    expect(nextCell(rows, c, at('r1', '__expand'), { key: 'ArrowRight' }, opts)!.action).toBe('expand')
    expect(nextCell(rows, c, at('r2', '__expand'), { key: 'ArrowRight' }, opts)).toEqual({ cell: at('r2', 'id') })
    expect(nextCell(rows, c, at('r2', '__expand'), { key: 'ArrowLeft' }, opts)!.action).toBe('collapse')
  })

  it('grille vide → null ; sans cellule active, la première touche pose la première cellule', () => {
    expect(nextCell([], cols, null, { key: 'ArrowDown' })).toBeNull()
    expect(nextCell(rows, [], null, { key: 'ArrowDown' })).toBeNull()
    expect(nextCell(rows, cols, null, { key: 'ArrowDown' })!.cell).toEqual(at('r1', 'id'))
    expect(nextCell(rows, cols, null, { key: 'Enter' })).toBeNull()
    expect(nextCell(rows, cols, at('r1', 'id'), { key: 'a' })).toBeNull()
  })
})
