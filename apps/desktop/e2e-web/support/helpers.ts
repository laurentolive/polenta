import type { Page } from '@playwright/test'

/** Appel d'un channel par le bridge de la page (même chemin que les composants : `window.polenta`). */
export function invoke<T = unknown>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([ch, a]) => (window as unknown as { polenta: { invoke(c: string, ...x: unknown[]): Promise<unknown> } })
      .polenta.invoke(ch as string, ...(a as unknown[])),
    [channel, args] as const,
  ) as Promise<T>
}

/** Bruit connu, sans rapport avec l'application. */
const IGNORED = [/Download the React DevTools/i, /\[vite\]/]

/**
 * Erreurs de la page (console `error` + exceptions non capturées), relevées pour le critère
 * « aucune erreur console » (S2-20, AC 8).
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', msg => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORED.some(r => r.test(text))) return
    errors.push(`[console] ${text}`)
  })
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`))
  return errors
}

/** Écoute un channel d'événements du bridge ; les occurrences s'accumulent dans `window.__e2e[name]`. */
export async function recordEvents(page: Page, channel: string, name: string): Promise<void> {
  await page.evaluate(([ch, n]) => {
    const w = window as unknown as { __e2e?: Record<string, unknown[][]>; polenta: { on(c: string, cb: (...a: unknown[]) => void): () => void } }
    w.__e2e ??= {}
    w.__e2e[n as string] = []
    w.polenta.on(ch as string, (...args) => { w.__e2e![n as string].push(args) })
  }, [channel, name] as const)
}

export function recordedEvents(page: Page, name: string): Promise<unknown[][]> {
  return page.evaluate(n => (window as unknown as { __e2e?: Record<string, unknown[][]> }).__e2e?.[n] ?? [], name)
}
