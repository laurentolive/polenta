import { afterEach, describe, expect, it } from 'vitest'
import { flushPendingEdits, registerEditFlusher, trackInflight } from './pendingEdits'

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

const delay = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

describe('GH342 flushPendingEdits (P5)', () => {
  it('attend un enregistrement lancé par un flusher après plusieurs étapes asynchrones (mutate)', async () => {
    let saved = false
    cleanups.push(registerEditFlusher(() => {
      // Comme `mutate()` de TanStack Query : l'appel au main part après quelques micro-tâches.
      void (async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve()
        await trackInflight(delay(50).then(() => { saved = true }))
      })()
    }))
    await flushPendingEdits()
    expect(saved).toBe(true)
  })

  it('rend la main au bout du délai si un appel ne se termine pas', async () => {
    void trackInflight(new Promise(() => {}))
    const t0 = Date.now()
    await flushPendingEdits(100)
    expect(Date.now() - t0).toBeLessThan(1_000)
  })

  it('un flusher qui échoue n’empêche pas les autres', async () => {
    let ran = false
    cleanups.push(registerEditFlusher(() => { throw new Error('boum') }))
    cleanups.push(registerEditFlusher(() => { ran = true }))
    await flushPendingEdits(50)
    expect(ran).toBe(true)
  })
})
