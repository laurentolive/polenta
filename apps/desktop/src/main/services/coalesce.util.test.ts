import { describe, expect, it, vi } from 'vitest'
import { coalesceRecent } from './coalesce.util'

function setup(windowMs = 30_000) {
  let clock = 0
  let calls = 0
  let release: (() => void) | null = null
  const fn = vi.fn(async (repo: string) => {
    calls += 1
    await new Promise<void>(resolve => { release = resolve })
    return `${repo}#${calls}`
  })
  const shared = coalesceRecent(fn, (repo: string) => repo, windowMs, () => clock)
  return {
    shared,
    fn,
    advance: (ms: number) => { clock += ms },
    finish: async () => { await Promise.resolve(); release?.() },
  }
}

describe('GH342 coalesceRecent (D2, D3)', () => {
  it('D2 — deux appels simultanés : une seule exécution, même résultat', async () => {
    const { shared, fn, finish } = setup()
    const a = shared('repo')
    const b = shared('repo')
    await finish()
    expect(await a).toBe('repo#1')
    expect(await b).toBe('repo#1')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('D2 — appel 10 s après : résultat récent renvoyé sans exécution', async () => {
    const { shared, fn, advance, finish } = setup()
    const a = shared('repo')
    await finish()
    await a
    advance(10_000)
    expect(await shared('repo')).toBe('repo#1')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('D3 — appel 40 s après : nouvelle exécution', async () => {
    const { shared, fn, advance, finish } = setup()
    const a = shared('repo')
    await finish()
    await a
    advance(40_000)
    const b = shared('repo')
    await finish()
    expect(await b).toBe('repo#2')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('clés distinctes : exécutions distinctes', async () => {
    const shared = coalesceRecent(async (repo: string) => repo, (repo: string) => repo, 30_000)
    expect(await Promise.all([shared('a'), shared('b')])).toEqual(['a', 'b'])
  })

  it('un échec n’est pas gardé : l’appel suivant réessaie', async () => {
    let n = 0
    const shared = coalesceRecent(async () => {
      n += 1
      if (n === 1) throw new Error('réseau')
      return 'ok'
    }, () => 'k', 30_000)
    await expect(shared()).rejects.toThrow('réseau')
    expect(await shared()).toBe('ok')
  })
})
