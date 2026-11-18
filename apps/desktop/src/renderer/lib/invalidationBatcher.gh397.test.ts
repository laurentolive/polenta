import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { InvalidationBatcher } from './invalidationBatcher'

/**
 * GH397 — une rafale d'événements de fichier ne relance chaque lecture active qu'une fois, sans
 * annuler une tournée en cours, et reste visible rapidement (délais bornés).
 */
describe('InvalidationBatcher (GH397)', () => {
  let qc: QueryClient
  const unsubs: Array<() => void> = []

  beforeEach(() => {
    vi.useFakeTimers()
    qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } })
  })
  afterEach(() => {
    for (const u of unsubs.splice(0)) u()
    qc.clear()
    vi.useRealTimers()
  })

  /** Lecture active (observée) dont chaque exécution dure `ms`. */
  async function activeQuery(key: unknown[], ms = 0) {
    const calls = { n: 0 }
    const observer = new QueryObserver(qc, {
      queryKey: key,
      queryFn: () => {
        calls.n += 1
        return new Promise(resolve => setTimeout(() => resolve(calls.n), ms))
      },
    })
    unsubs.push(observer.subscribe(() => {}))
    await vi.advanceTimersByTimeAsync(ms + 1)
    calls.n = 0 // premier chargement non compté
    return calls
  }

  it('60 événements en rafale : le premier appliqué aussitôt, les 59 suivants en une relecture', async () => {
    const widgets = await activeQuery(['widget-query-result', 'repo', 'w1'])
    const links = await activeQuery(['links-list', 'repo'])
    const b = new InvalidationBatcher(qc)
    for (let i = 0; i < 60; i++) {
      b.add({ queryKey: ['widget-query-result'] })
      b.add({ queryKey: ['links-list'] })
      b.add({ predicate: q => q.queryKey[0] === 'links-list' })
      await vi.advanceTimersByTimeAsync(10) // un événement toutes les 10 ms
    }
    await vi.advanceTimersByTimeAsync(2000)
    expect(widgets.n).toBe(2) // avant GH397 : 60
    expect(links.n).toBe(2)
  })

  it('fraîcheur : événement isolé aussitôt ; rafale continue relue au plus tard maxWaitMs après', async () => {
    const q = await activeQuery(['requirements-all', 'repo'])
    const b = new InvalidationBatcher(qc, { quietMs: 150, maxWaitMs: 1000 })
    b.add({ queryKey: ['requirements-all', 'repo'] })
    b.add({ queryKey: ['requirements-all'] }) // même événement : une seule relecture
    await vi.advanceTimersByTimeAsync(1)
    expect(q.n).toBe(1)

    // Rafale continue (un événement toutes les 100 ms, jamais 150 ms de calme) : le premier aussitôt,
    // les suivants relus 1 s après le deuxième.
    await vi.advanceTimersByTimeAsync(500)
    for (let k = 0; k <= 10; k++) {
      b.add({ queryKey: ['requirements-all', 'repo'] })
      if (k === 1) expect(q.n).toBe(2)
      if (k === 10) expect(q.n).toBe(2)
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(q.n).toBe(3)
  })

  it("n'annule pas une tournée en cours : attend sa fin, puis relit une fois", async () => {
    const slow = await activeQuery(['widget-query-result', 'repo'], 3000)
    const b = new InvalidationBatcher(qc, { quietMs: 150, maxWaitMs: 1000, busyMaxMs: 8000 })
    b.add({ queryKey: ['widget-query-result'] })
    await vi.advanceTimersByTimeAsync(200)
    expect(slow.n).toBe(1) // tournée 1 lancée (3 s)
    for (let i = 0; i < 20; i++) {
      b.add({ queryKey: ['widget-query-result'] })
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(slow.n).toBe(1) // toujours la tournée 1, pas annulée ni relancée
    await vi.advanceTimersByTimeAsync(1500) // fin de la tournée 1 à ~3,2 s, puis pause (≤ 2 s)
    expect(slow.n).toBe(1)
    await vi.advanceTimersByTimeAsync(2200)
    expect(slow.n).toBe(2) // une seule relecture pour les 20 événements reçus pendant
    expect(b.pending).toBe(0)
  })

  it('pause après une tournée : égale à sa durée, et sans effet sur un événement isolé plus tard', async () => {
    const q = await activeQuery(['widget-query-result', 'repo'], 500)
    const b = new InvalidationBatcher(qc, { quietMs: 150, maxWaitMs: 1000, maxRestMs: 2000 })
    b.add({ queryKey: ['widget-query-result'] })
    await vi.advanceTimersByTimeAsync(151) // tournée 1 : 150 → 650 ms
    expect(q.n).toBe(1)
    b.add({ queryKey: ['widget-query-result'] }) // reçu pendant la tournée
    await vi.advanceTimersByTimeAsync(800) // ~950 ms : tournée finie, pause jusqu'à ~1150 ms
    expect(q.n).toBe(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(q.n).toBe(2)
    // Longtemps après : un événement isolé est relu après le seul délai de calme.
    await vi.advanceTimersByTimeAsync(10_000)
    b.add({ queryKey: ['widget-query-result'] })
    await vi.advanceTimersByTimeAsync(151)
    expect(q.n).toBe(3)
  })

  it('une lecture au repos (schéma) est relue sans attendre une lecture lourde en cours (widgets)', async () => {
    const widgets = await activeQuery(['widget-query-result', 'repo'], 3000)
    const schema = await activeQuery(['schema', 'repo'])
    const b = new InvalidationBatcher(qc, { quietMs: 150, maxWaitMs: 1000 })
    b.add({ queryKey: ['widget-query-result'] })
    await vi.advanceTimersByTimeAsync(200)
    expect(widgets.n).toBe(1) // tournée lourde en cours (3 s)
    b.add({ queryKey: ['widget-query-result'] })
    b.add({ queryKey: ['schema', 'repo'] })
    await vi.advanceTimersByTimeAsync(200)
    expect(schema.n).toBe(1) // relu tout de suite
    expect(widgets.n).toBe(1) // attend la fin de sa tournée
  })

  it('tournée trop longue : invalidation forcée après busyMaxMs', async () => {
    const stuck = await activeQuery(['widget-query-result', 'repo'], 60_000)
    const b = new InvalidationBatcher(qc, { quietMs: 150, maxWaitMs: 1000, busyMaxMs: 5000 })
    b.add({ queryKey: ['widget-query-result'] })
    await vi.advanceTimersByTimeAsync(200)
    expect(stuck.n).toBe(1)
    b.add({ queryKey: ['widget-query-result'] })
    await vi.advanceTimersByTimeAsync(4900)
    expect(stuck.n).toBe(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(stuck.n).toBe(2)
  })

  it('dispose : plus rien après démontage', async () => {
    const q = await activeQuery(['tree', 'repo'])
    const b = new InvalidationBatcher(qc)
    b.add({ queryKey: ['tree'] })
    b.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(q.n).toBe(0)
  })
})
