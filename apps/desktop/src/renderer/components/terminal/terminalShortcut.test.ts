import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTerminalToggleShortcut, isVersionRoute, QuietRefresh } from './terminalShortcut'

// GH238 — raccourci du terminal, routes Version, rafraîchissement après une commande.

const key = (k: Partial<KeyboardEvent>) => ({
  key: '', code: '', repeat: false, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...k,
})

describe('isTerminalToggleShortcut', () => {
  it('Ctrl+ù (AZERTY), Ctrl+` (QWERTY), touche Backquote', () => {
    expect(isTerminalToggleShortcut(key({ key: 'ù', code: 'Quote' }))).toBe(true)
    expect(isTerminalToggleShortcut(key({ key: '`', code: 'Backquote' }))).toBe(true)
    expect(isTerminalToggleShortcut(key({ key: 'Dead', code: 'Backquote' }))).toBe(true)
  })

  it('sans Ctrl, avec Maj / Alt / Meta, ou auto-répétition → non', () => {
    expect(isTerminalToggleShortcut(key({ key: 'ù', ctrlKey: false }))).toBe(false)
    expect(isTerminalToggleShortcut(key({ key: 'ù', shiftKey: true }))).toBe(false)
    expect(isTerminalToggleShortcut(key({ key: 'ù', altKey: true }))).toBe(false)
    expect(isTerminalToggleShortcut(key({ key: 'ù', metaKey: true }))).toBe(false)
    expect(isTerminalToggleShortcut(key({ key: 'ù', repeat: true }))).toBe(false)
    expect(isTerminalToggleShortcut(key({ key: 'u', code: 'KeyU' }))).toBe(false)
  })
})

describe('isVersionRoute', () => {
  it('les 4 routes Version seulement', () => {
    for (const r of ['/graph', '/diff', '/version-diff', '/baseline']) expect(isVersionRoute(r)).toBe(true)
    for (const r of ['/requirements', '/graph-x', '/', '/versioning']) expect(isVersionRoute(r)).toBe(false)
  })
})

describe('QuietRefresh', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('sortie sans Entrée → aucun rafraîchissement', () => {
    const fn = vi.fn()
    const q = new QuietRefresh(fn)
    q.onInput('l')
    q.onOutput()
    vi.advanceTimersByTime(2000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('Entrée puis sorties rapprochées → un seul appel, 500 ms après la dernière sortie', () => {
    const fn = vi.fn()
    const q = new QuietRefresh(fn)
    q.onInput('\r')
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(300)
      q.onOutput()
    }
    vi.advanceTimersByTime(499)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('commande qui marque une pause : rafraîchi à chaque accalmie, donc à sa vraie fin', () => {
    const fn = vi.fn()
    const q = new QuietRefresh(fn)
    q.onInput('\r')
    vi.advanceTimersByTime(800)
    expect(fn).toHaveBeenCalledTimes(1)
    q.onOutput()
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('frappe de la commande suivante : désarmé, son écho ne rafraîchit pas', () => {
    const fn = vi.fn()
    const q = new QuietRefresh(fn)
    q.onInput('\r')
    vi.advanceTimersByTime(500)
    q.onInput('g')
    q.onOutput()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('dispose annule un rafraîchissement en attente', () => {
    const fn = vi.fn()
    const q = new QuietRefresh(fn)
    q.onInput('\r')
    q.dispose()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })
})
