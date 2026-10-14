import { describe, it, expect, vi } from 'vitest'
import { withGraphInvalidation } from '../ipc/index'
import type { Handler } from '../ipc/registry'

describe('GH74 — oubli immédiat du graphe après une écriture IPC', () => {
  function setup() {
    const handlers = new Map<string, Handler>()
    const graph = { invalidate: vi.fn() }
    const r = withGraphInvalidation({ handle: (ch, fn) => { handlers.set(ch, fn) } }, graph as never)
    return { handlers, graph, r }
  }

  it('oublie le graphe du repo après un channel d\'écriture, même en cas d\'échec', async () => {
    const { handlers, graph, r } = setup()
    r.handle('campaigns:create', async () => ({ id: 'CAMP-0001' }))
    r.handle('requirements:update', async () => { throw new Error('refusé') })
    await expect(handlers.get('campaigns:create')!(null, '/repo', {})).resolves.toEqual({ id: 'CAMP-0001' })
    await expect(handlers.get('requirements:update')!(null, '/repo', {})).rejects.toThrow('refusé')
    expect(graph.invalidate.mock.calls).toEqual([['/repo'], ['/repo']])
  })

  it('laisse les lectures inchangées', async () => {
    const { handlers, graph, r } = setup()
    const list = async () => []
    r.handle('campaigns:list', list)
    expect(handlers.get('campaigns:list')).toBe(list)
    await handlers.get('campaigns:list')!(null, '/repo')
    expect(graph.invalidate).not.toHaveBeenCalled()
  })
})
