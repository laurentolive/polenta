import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TREE_LOCK_RENEW_MS, holdTreeEditLock, type TreeLockApi } from './treeEditLock'

// GH361 — tenue du verrou d'édition côté renderer (specs/GH361-tests.md D3).

function fakeApi(renew: () => boolean = () => true) {
  let n = 0
  const calls: string[] = []
  const api: TreeLockApi = {
    lock: vi.fn(async (_r: string, _n: string, t: string) => { calls.push(`lock:${t}`); return `L${++n}` }),
    renewLock: vi.fn(async (id: string) => { calls.push(`renew:${id}`); return renew() }),
    unlock: vi.fn(async (id: string) => { calls.push(`unlock:${id}`) }),
  }
  return { api, calls }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('holdTreeEditLock', () => {
  it('prend le verrou, appelle onAcquired, renouvelle, libère à l’arrêt', async () => {
    const { api, calls } = fakeApi()
    const acquired = vi.fn()
    const stop = holdTreeEditLock(api, '/r', 'root', 'req', acquired)
    await vi.advanceTimersByTimeAsync(0)
    expect(acquired).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(TREE_LOCK_RENEW_MS * 2)
    stop()
    await vi.advanceTimersByTimeAsync(TREE_LOCK_RENEW_MS)
    expect(calls).toEqual(['lock:req', 'renew:L1', 'renew:L1', 'unlock:L1'])
  })

  it('bail purgé : nouvelle prise et nouvelle relecture', async () => {
    let ok = true
    const { api, calls } = fakeApi(() => ok)
    const acquired = vi.fn()
    const stop = holdTreeEditLock(api, '/r', 'root', 'req', acquired)
    await vi.advanceTimersByTimeAsync(0)
    ok = false
    await vi.advanceTimersByTimeAsync(TREE_LOCK_RENEW_MS)
    expect(calls).toEqual(['lock:req', 'renew:L1', 'lock:req'])
    expect(acquired).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.at(-1)).toBe('unlock:L2')
  })

  it('arrêt pendant la prise : le bail obtenu est rendu, onAcquired non appelé', async () => {
    const { api, calls } = fakeApi()
    const acquired = vi.fn()
    const stop = holdTreeEditLock(api, '/r', 'root', 'req', acquired)
    stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['lock:req', 'unlock:L1'])
    expect(acquired).not.toHaveBeenCalled()
  })

  it('prise en échec : réessayée au tick suivant', async () => {
    const { api } = fakeApi()
    vi.mocked(api.lock).mockRejectedValueOnce(new Error('réseau'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const acquired = vi.fn()
    const stop = holdTreeEditLock(api, '/r', 'root', 'req', acquired)
    await vi.advanceTimersByTimeAsync(0)
    expect(acquired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(TREE_LOCK_RENEW_MS)
    expect(acquired).toHaveBeenCalledTimes(1)
    stop()
    err.mockRestore()
  })
})
