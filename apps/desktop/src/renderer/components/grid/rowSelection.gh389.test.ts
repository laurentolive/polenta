import { describe, expect, it } from 'vitest'
import { checkboxClick, checkboxRowClick, groupState, selectRow, toggleGroup } from './rowSelection'

// GH389 U4 — sélection de lignes.
const displayed = ['a', 'b', 'c', 'd', 'e']
const sel = (...ids: string[]) => new Set(ids)
const ids = (s: Set<string> | null) => (s ? [...s].sort() : null)

describe('GH389 U4 — rowSelection (mode lignes)', () => {
  it('clic simple : la ligne seule', () => {
    const r = selectRow({ selected: sel('a'), displayed, anchor: 'a', target: 'c' })
    expect(ids(r.selected)).toEqual(['c'])
    expect(r.anchor).toBe('c')
  })

  it('clic sur la seule ligne déjà sélectionnée : inchangé', () => {
    expect(selectRow({ selected: sel('c'), displayed, anchor: 'c', target: 'c' }).selected).toBeNull()
  })

  it('Maj : plage depuis l’ancre, l’ancre reste', () => {
    const r = selectRow({ selected: sel('b'), displayed, anchor: 'b', target: 'd', shift: true })
    expect(ids(r.selected)).toEqual(['b', 'c', 'd'])
    expect(r.anchor).toBe('b')
    expect(ids(selectRow({ selected: sel('d'), displayed, anchor: 'd', target: 'a', shift: true }).selected)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('Ctrl : bascule', () => {
    expect(ids(selectRow({ selected: sel('a', 'b'), displayed, anchor: 'a', target: 'd', ctrl: true }).selected)).toEqual(['a', 'b', 'd'])
    expect(ids(selectRow({ selected: sel('a', 'b'), displayed, anchor: 'a', target: 'b', ctrl: true }).selected)).toEqual(['a'])
  })

  it('clic dans une sélection multiple : ne la réduit pas', () => {
    expect(selectRow({ selected: sel('a', 'b', 'c'), displayed, anchor: 'a', target: 'b' }).selected).toBeNull()
  })

  it('ancre masquée : Maj ignoré (clic simple)', () => {
    const r = selectRow({ selected: sel('z'), displayed, anchor: 'z', target: 'c', shift: true })
    expect(ids(r.selected)).toEqual(['c'])
    expect(r.anchor).toBe('c')
  })
})

describe('GH389 U4 — rowSelection (mode cases)', () => {
  it('clic de ligne et de case', () => {
    expect(ids(checkboxRowClick({ selected: sel('a'), displayed, anchor: 'a', target: 'c', shift: false }).selected)).toEqual(['a', 'c'])
    expect(ids(checkboxClick({ selected: sel('a', 'b'), displayed, anchor: 'b', target: 'd', shift: true }).selected)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('tri-état', () => {
    expect(groupState([], sel())).toBe('disabled')
    expect(groupState(['a', 'b'], sel())).toBe('none')
    expect(groupState(['a', 'b'], sel('a'))).toBe('some')
    expect(groupState(['a', 'b'], sel('a', 'b', 'z'))).toBe('all')
    expect(ids(toggleGroup(['a', 'b'], sel('a')))).toEqual(['a', 'b'])
    expect(ids(toggleGroup(['a', 'b'], sel('a', 'b', 'z')))).toEqual(['z'])
  })
})
