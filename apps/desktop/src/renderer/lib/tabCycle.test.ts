import { describe, expect, it } from 'vitest'
import { cycleTabId, tabCycleDirection } from './tabCycle'

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; meta?: boolean; alt?: boolean } = {}) => ({
  key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, metaKey: !!mods.meta, altKey: !!mods.alt,
})

describe('GH405 — tabCycleDirection', () => {
  it('U1 — Ctrl+Tab / Ctrl+PageDown suivant, Ctrl+Shift+Tab / Ctrl+PageUp précédent', () => {
    expect(tabCycleDirection(key('Tab', { ctrl: true }))).toBe(1)
    expect(tabCycleDirection(key('Tab', { ctrl: true, shift: true }))).toBe(-1)
    expect(tabCycleDirection(key('PageDown', { ctrl: true }))).toBe(1)
    expect(tabCycleDirection(key('PageUp', { ctrl: true }))).toBe(-1)
  })

  it('U2 — autres combinaisons ignorées', () => {
    expect(tabCycleDirection(key('Tab'))).toBeNull()
    expect(tabCycleDirection(key('Tab', { shift: true }))).toBeNull()
    expect(tabCycleDirection(key('Tab', { meta: true }))).toBeNull()
    expect(tabCycleDirection(key('Tab', { ctrl: true, meta: true }))).toBeNull()
    expect(tabCycleDirection(key('Tab', { ctrl: true, alt: true }))).toBeNull()
    expect(tabCycleDirection(key('PageUp', { ctrl: true, shift: true }))).toBeNull()
    expect(tabCycleDirection(key('PageDown', { ctrl: true, shift: true }))).toBeNull()
    expect(tabCycleDirection(key('PageUp'))).toBeNull()
    expect(tabCycleDirection(key('t', { ctrl: true }))).toBeNull()
  })
})

describe('GH405 — cycleTabId', () => {
  const tabs = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]

  it('U3 — ordre de la liste, en boucle', () => {
    expect(cycleTabId(tabs, 'A', 1)).toBe('B')
    expect(cycleTabId(tabs, 'C', 1)).toBe('A')
    expect(cycleTabId(tabs, 'A', -1)).toBe('C')
    expect(cycleTabId(tabs, 'B', -1)).toBe('A')
  })

  it('U4 — un seul onglet, liste vide, id inconnu : null', () => {
    expect(cycleTabId([{ id: 'A' }], 'A', 1)).toBeNull()
    expect(cycleTabId([], 'A', 1)).toBeNull()
    expect(cycleTabId(tabs, 'Z', 1)).toBeNull()
  })
})
