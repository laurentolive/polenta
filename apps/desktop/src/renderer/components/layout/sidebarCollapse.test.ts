import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_COLLAPSED_KEY, isEditableTarget, isSidebarToggleShortcut, loadSidebarCollapsed, saveSidebarCollapsed,
} from './sidebarCollapse'

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

function key(overrides: Partial<Parameters<typeof isSidebarToggleShortcut>[0]> = {}) {
  return {
    key: 'b', code: 'KeyB', repeat: false, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, target: { tagName: 'DIV' } as unknown as EventTarget, ...overrides,
  }
}

describe('préférence replié/déplié', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('U1 — clé absente → déplié', () => {
    expect(loadSidebarCollapsed()).toBe(false)
  })
  it('U2 — "1" → replié', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
    expect(loadSidebarCollapsed()).toBe(true)
  })
  it.each(['0', 'true', 'x'])('U3 — "%s" → déplié', v => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v)
    expect(loadSidebarCollapsed()).toBe(false)
  })
  it('U4 — localStorage qui lève', () => {
    const throwing = () => { throw new Error('denied') }
    vi.stubGlobal('localStorage', { getItem: throwing, setItem: throwing, removeItem: throwing })
    expect(loadSidebarCollapsed()).toBe(false)
    expect(() => saveSidebarCollapsed(true)).not.toThrow()
  })
  it('U5 — replié écrit "1", déplié supprime la clé', () => {
    saveSidebarCollapsed(true)
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1')
    saveSidebarCollapsed(false)
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBeNull()
  })
})

describe('isSidebarToggleShortcut', () => {
  it('U6 — Ctrl+b, Ctrl+B (Caps Lock), Cmd+b sur macOS, touche physique B (disposition non latine)', () => {
    expect(isSidebarToggleShortcut(key(), false)).toBe(true)
    expect(isSidebarToggleShortcut(key({ key: 'B' }), false)).toBe(true)
    expect(isSidebarToggleShortcut(key({ ctrlKey: false, metaKey: true }), true)).toBe(true)
    expect(isSidebarToggleShortcut(key({ key: 'и' }), false)).toBe(true)
  })
  it('U7 — b seul, Ctrl+Shift+B, Ctrl+Alt+B, Ctrl+N, Ctrl+B sur macOS, Cmd+B hors macOS', () => {
    expect(isSidebarToggleShortcut(key({ ctrlKey: false }), false)).toBe(false)
    expect(isSidebarToggleShortcut(key({ shiftKey: true }), false)).toBe(false)
    expect(isSidebarToggleShortcut(key({ altKey: true }), false)).toBe(false)
    expect(isSidebarToggleShortcut(key({ key: 'n', code: 'KeyN' }), false)).toBe(false)
    expect(isSidebarToggleShortcut(key(), true)).toBe(false)
    expect(isSidebarToggleShortcut(key({ ctrlKey: false, metaKey: true }), false)).toBe(false)
  })
  it('U8 — déjà traité (defaultPrevented) ou auto-répétition', () => {
    expect(isSidebarToggleShortcut(key({ defaultPrevented: true }), false)).toBe(false)
    expect(isSidebarToggleShortcut(key({ repeat: true }), false)).toBe(false)
  })
  it('U9 — cible éditable', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(isSidebarToggleShortcut(key({ target: { tagName } as unknown as EventTarget }), false)).toBe(false)
    }
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'STRONG', closest: () => ({}) } as unknown as EventTarget)).toBe(true)
  })
  it('U10 — cible non éditable ou absente', () => {
    expect(isSidebarToggleShortcut(key({ target: { tagName: 'BUTTON', closest: () => null } as unknown as EventTarget }), false)).toBe(true)
    expect(isSidebarToggleShortcut(key({ target: null }), false)).toBe(true)
  })
})
