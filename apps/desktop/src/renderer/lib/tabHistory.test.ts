import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT, historyMenuEntries, historyNavDirection, recordLocation, stepHistory,
  type HistoryNavKeyEvent, type TabHistory, type TabHistoryEntry,
} from './tabHistory'

const e = (pathname: string, searchParams: Record<string, string> = {}): TabHistoryEntry => ({ pathname, searchParams, title: pathname })
const start = (...paths: string[]): TabHistory => ({ history: paths.map(p => e(p)), historyIndex: paths.length - 1 })
const paths = (s: TabHistory) => s.history.map(h => h.pathname)

describe('GH228 — historique d\'un onglet', () => {
  it('push adds an entry, replace rewrites the current one (U1)', () => {
    const pushed = recordLocation(start('/a'), e('/b'), true)
    expect(paths(pushed)).toEqual(['/a', '/b'])
    expect(pushed.historyIndex).toBe(1)
    const replaced = recordLocation(pushed, e('/c'), false)
    expect(paths(replaced)).toEqual(['/a', '/c'])
    expect(replaced.historyIndex).toBe(1)
  })

  it('push from the middle drops the forward entries (U2)', () => {
    const s = { ...start('/a', '/b', '/c'), historyIndex: 0 }
    const next = recordLocation(s, e('/d'), true)
    expect(paths(next)).toEqual(['/a', '/d'])
    expect(next.historyIndex).toBe(1)
  })

  it('push to the current destination replaces it (U3)', () => {
    const s = recordLocation(start('/a', '/b'), { ...e('/b'), title: 'B' }, true)
    expect(paths(s)).toEqual(['/a', '/b'])
    expect(s.history[1].title).toBe('B')
    expect(paths(recordLocation(start('/a'), e('/a', { x: '1' }), true))).toEqual(['/a', '/a'])
  })

  it('caps the stack, forgetting the oldest entries (U4)', () => {
    let s = start('/0')
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) s = recordLocation(s, e(`/${i}`), true)
    expect(s.history).toHaveLength(HISTORY_LIMIT)
    expect(s.history[0].pathname).toBe('/6')
    expect(s.historyIndex).toBe(HISTORY_LIMIT - 1)
  })

  it('stepHistory stays inside the stack (U5)', () => {
    const s = { ...start('/a', '/b', '/c'), historyIndex: 1 }
    expect(stepHistory(s, -1)).toBe(0)
    expect(stepHistory(s, 1)).toBe(2)
    expect(stepHistory(s, -2)).toBeNull()
    expect(stepHistory(s, 2)).toBeNull()
    expect(stepHistory(s, 0)).toBeNull()
  })

  it('menu entries, closest first, capped (U6)', () => {
    const s = { ...start('/a', '/b', '/c', '/d'), historyIndex: 2 }
    expect(historyMenuEntries(s, -1).map(x => x.index)).toEqual([1, 0])
    expect(historyMenuEntries(s, 1).map(x => x.index)).toEqual([3])
    expect(historyMenuEntries(s, -1, 1).map(x => x.index)).toEqual([1])
  })
})

describe('GH228 — raccourcis Précédent / Suivant (U7)', () => {
  const k = (key: string, mods: Partial<HistoryNavKeyEvent> = {}): HistoryNavKeyEvent =>
    ({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods })

  it('Windows / Linux: Alt+arrows, even in a field', () => {
    expect(historyNavDirection(k('ArrowLeft', { altKey: true }), false, false)).toBe(-1)
    expect(historyNavDirection(k('ArrowRight', { altKey: true }), false, true)).toBe(1)
    expect(historyNavDirection(k('ArrowLeft', { altKey: true, ctrlKey: true }), false, false)).toBeNull()
    expect(historyNavDirection(k('ArrowLeft', { altKey: true, shiftKey: true }), false, false)).toBeNull()
    expect(historyNavDirection(k('ArrowLeft'), false, false)).toBeNull()
    expect(historyNavDirection(k('[', { ctrlKey: true }), false, false)).toBeNull()
  })

  it('macOS: Cmd+[ everywhere, Cmd/Alt+arrows outside fields only', () => {
    expect(historyNavDirection(k('[', { metaKey: true, code: 'BracketLeft' }), true, true)).toBe(-1)
    expect(historyNavDirection(k('¨', { metaKey: true, code: 'BracketRight' }), true, false)).toBe(1)
    expect(historyNavDirection(k('ArrowLeft', { metaKey: true }), true, false)).toBe(-1)
    expect(historyNavDirection(k('ArrowLeft', { metaKey: true }), true, true)).toBeNull()
    expect(historyNavDirection(k('ArrowRight', { altKey: true }), true, false)).toBe(1)
    expect(historyNavDirection(k('ArrowRight', { altKey: true }), true, true)).toBeNull()
  })

  it('media keys, and already handled events', () => {
    expect(historyNavDirection(k('BrowserBack'), false, true)).toBe(-1)
    expect(historyNavDirection(k('BrowserForward'), true, false)).toBe(1)
    expect(historyNavDirection(k('ArrowLeft', { altKey: true, defaultPrevented: true }), false, false)).toBeNull()
  })
})
