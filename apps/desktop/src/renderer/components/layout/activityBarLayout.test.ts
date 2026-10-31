import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Panel } from './AppLayout'
import {
  ACTIVITY_BAR_LAYOUT_KEY, applyOrder, hiddenSet, loadLayout, movePanel, saveLayout, toggleHidden,
} from './activityBarLayout'

const DEFAULTS: Panel[] = ['account', 'project', 'dashboard', 'requirements', 'version', 'parameters']

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: k => data.get(k) ?? null,
    key: i => [...data.keys()][i] ?? null,
    removeItem: k => { data.delete(k) },
    setItem: (k, v) => { data.set(k, String(v)) },
  }
}

describe('applyOrder', () => {
  it('U1 — sans préférence, ordre par défaut', () => {
    expect(applyOrder(DEFAULTS, null)).toEqual(DEFAULTS)
  })
  it('U2 — panneaux absents de la préférence ajoutés en fin', () => {
    expect(applyOrder(DEFAULTS, { order: ['parameters', 'account', 'project'], hidden: [] }))
      .toEqual(['parameters', 'account', 'project', 'dashboard', 'requirements', 'version'])
  })
  it('U3 — ids inconnus ignorés', () => {
    expect(applyOrder(DEFAULTS, { order: ['foo' as Panel, 'version'], hidden: [] })[0]).toBe('version')
    expect(applyOrder(DEFAULTS, { order: ['foo' as Panel], hidden: [] })).toEqual(DEFAULTS)
  })
})

describe('hiddenSet', () => {
  it('U4 — Compte et Projet jamais masqués', () => {
    expect([...hiddenSet(DEFAULTS, { order: [], hidden: ['account', 'project', 'parameters'] })]).toEqual(['parameters'])
  })
  it('U5 — ids inconnus ignorés', () => {
    expect(hiddenSet(DEFAULTS, { order: [], hidden: ['foo' as Panel] }).size).toBe(0)
  })
})

describe('movePanel', () => {
  it('U6 — avant, après, sur soi-même', () => {
    expect(movePanel(DEFAULTS, 'version', 'dashboard', 'before'))
      .toEqual(['account', 'project', 'version', 'dashboard', 'requirements', 'parameters'])
    expect(movePanel(DEFAULTS, 'account', 'parameters', 'after'))
      .toEqual(['project', 'dashboard', 'requirements', 'version', 'parameters', 'account'])
    expect(movePanel(DEFAULTS, 'version', 'version', 'before')).toBe(DEFAULTS)
  })
})

describe('toggleHidden', () => {
  it('U7 — aller-retour, no-op sur Compte', () => {
    const hidden = toggleHidden([], 'parameters')
    expect(hidden).toEqual(['parameters'])
    expect(toggleHidden(hidden, 'parameters')).toEqual([])
    expect(toggleHidden([], 'account')).toEqual([])
  })
})

describe('loadLayout / saveLayout', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('U8 — clé absente, JSON invalide, forme invalide, forme valide', () => {
    expect(loadLayout()).toBeNull()
    localStorage.setItem(ACTIVITY_BAR_LAYOUT_KEY, '{')
    expect(loadLayout()).toBeNull()
    localStorage.setItem(ACTIVITY_BAR_LAYOUT_KEY, '{"order":3,"hidden":[]}')
    expect(loadLayout()).toBeNull()
    saveLayout({ order: ['parameters'], hidden: ['version'] })
    expect(loadLayout()).toEqual({ order: ['parameters'], hidden: ['version'] })
  })

  it('U9 — localStorage qui lève', () => {
    const throwing = () => { throw new Error('denied') }
    vi.stubGlobal('localStorage', { getItem: throwing, setItem: throwing, removeItem: throwing })
    expect(loadLayout()).toBeNull()
    expect(() => saveLayout({ order: [], hidden: [] })).not.toThrow()
  })
})
