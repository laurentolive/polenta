import { describe, expect, it, vi } from 'vitest'
import { TabDragRegistry, TAB_DRAG_TTL_MS, type TabDragHost } from './tab-drag'
import { isTabDragPayload, type TabDragPayload } from '../../shared/tab-drag'

const entry = (pathname: string) => ({ pathname, searchParams: { projectId: 'A' }, title: pathname })
const payload = (over: Partial<TabDragPayload> = {}): TabDragPayload => ({
  tab: { ...entry('/req/SYS-1'), history: [entry('/product'), entry('/req/SYS-1')], historyIndex: 1 },
  projectId: 'A',
  tabCount: 3,
  ...over,
})

function setup(projects: Record<number, string | null>) {
  let t = 1_000
  const moved: [number, string][] = []
  const host: TabDragHost = {
    projectOf: id => projects[id] ?? null,
    isAlive: () => true,
    notifyMoved: (source, id) => { moved.push([source, id]) },
    now: () => t,
  }
  return { reg: new TabDragRegistry(host), moved, advance: (ms: number) => { t += ms } }
}

describe('GH343 — T20 glisser d’onglet : acceptation et prise', () => {
  it('la source ne peut pas prendre son propre onglet ; même projet ou fenêtre sans projet : accepté ; autre projet : refusé', async () => {
    const { reg } = setup({ 1: 'A', 2: 'A', 3: 'B', 4: null })
    reg.start(1, 'd1', payload())
    expect(reg.info(1)).toEqual({ sameWindow: true, accept: false })
    expect(reg.info(2)).toEqual({ sameWindow: false, accept: true })
    expect(reg.info(3)).toEqual({ sameWindow: false, accept: false })
    expect(reg.info(4)).toEqual({ sameWindow: false, accept: true })
    expect(await reg.take(1, 'd1', 0)).toBeNull()
    expect(await reg.take(3, 'd1', 0)).toBeNull()
  })

  it('pris une seule fois ; mauvais id refusé', async () => {
    const { reg, moved } = setup({ 1: 'A', 2: 'A', 4: null })
    reg.start(1, 'd1', payload())
    reg.markReady(1, 'd1')
    expect(await reg.take(2, 'autre', 0)).toBeNull()
    expect(await reg.take(2, 'd1')).toEqual(payload())
    expect(await reg.take(4, 'd1', 0)).toBeNull()
    expect(moved).toEqual([[1, 'd1']])
  })

  it('expiration : glisser oublié après la durée de vie', () => {
    const { reg, advance } = setup({ 1: 'A', 2: 'A' })
    reg.start(1, 'd1', payload())
    advance(TAB_DRAG_TTL_MS + 1)
    expect(reg.info(2)).toBeNull()
  })

  it('un second glisser remplace le premier', async () => {
    const { reg } = setup({ 1: 'A', 2: 'A' })
    reg.start(1, 'd1', payload())
    reg.start(1, 'd2', payload())
    expect(await reg.take(2, 'd1', 0)).toBeNull()
    expect(await reg.take(2, 'd2', 0)).not.toBeNull()
  })
})

describe('GH343 — T21 attente des enregistrements de la source', () => {
  it('la prise attend `ready` puis prévient la source', async () => {
    const { reg, moved } = setup({ 1: 'A', 2: 'A' })
    reg.start(1, 'd1', payload())
    let done = false
    const taking = reg.take(2, 'd1', 10_000).then(p => { done = true; return p })
    await new Promise(r => setTimeout(r, 20))
    expect(done).toBe(false)
    expect(moved).toEqual([])
    reg.markReady(1, 'd1')
    expect(await taking).not.toBeNull()
    expect(moved).toEqual([[1, 'd1']])
  })

  it('source qui ne répond pas : transfert après le délai', async () => {
    vi.useFakeTimers()
    try {
      const { reg } = setup({ 1: 'A', 2: 'A' })
      reg.start(1, 'd1', payload())
      const taking = reg.take(2, 'd1', 2_500)
      await vi.advanceTimersByTimeAsync(2_500)
      expect(await taking).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('GH343 — fin du geste côté source', () => {
  it('lâché hors des fenêtres avec plusieurs onglets : nouvelle fenêtre ; dernier onglet ou lâché sur une fenêtre : rien', () => {
    const { reg } = setup({ 1: 'A' })
    reg.start(1, 'd1', payload())
    expect(reg.end(1, 'd1', { dropped: false, cursorOverAppWindow: false })).toBe(true)
    reg.start(1, 'd2', payload({ tabCount: 1 }))
    expect(reg.end(1, 'd2', { dropped: false, cursorOverAppWindow: false })).toBe(false)
    reg.start(1, 'd3', payload())
    expect(reg.end(1, 'd3', { dropped: false, cursorOverAppWindow: true })).toBe(false)
    expect(reg.info(1)).toBeNull()
  })

  it('déposé sur une autre fenêtre : le glisser reste pour sa prise', async () => {
    const { reg } = setup({ 1: 'A', 2: 'A' })
    reg.start(1, 'd1', payload())
    expect(reg.end(1, 'd1', { dropped: true, cursorOverAppWindow: true })).toBe(false)
    expect(await reg.take(2, 'd1', 0)).not.toBeNull()
  })
})

describe('GH343 — contrôle du payload', () => {
  it('forme valide acceptée, index d’historique hors bornes ou route invalide refusés', () => {
    expect(isTabDragPayload(payload())).toBe(true)
    expect(isTabDragPayload(payload({ draft: { key: 'form:x', state: { a: 1 } } }))).toBe(true)
    expect(isTabDragPayload({ ...payload(), tab: { ...payload().tab, historyIndex: 5 } })).toBe(false)
    expect(isTabDragPayload({ ...payload(), tab: { ...payload().tab, pathname: 'http://x' } })).toBe(false)
    expect(isTabDragPayload({ ...payload(), tabCount: 0 })).toBe(false)
    expect(isTabDragPayload(null)).toBe(false)
  })
})
