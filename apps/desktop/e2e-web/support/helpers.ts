import type { BrowserContext, Page } from '@playwright/test'

/** Appel d'un channel par le bridge de la page (même chemin que les composants : `window.polenta`). */
export function invoke<T = unknown>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([ch, a]) => (window as unknown as { polenta: { invoke(c: string, ...x: unknown[]): Promise<unknown> } })
      .polenta.invoke(ch as string, ...(a as unknown[])),
    [channel, args] as const,
  ) as Promise<T>
}

/**
 * GH387 — appel d'un channel depuis le process de test, sans page : `POST /rpc/<channel>` avec les
 * cookies de session du contexte (même requête que le bridge web). Sert à préparer un projet avant
 * d'avoir chargé l'application.
 */
export async function rpc<T = unknown>(context: BrowserContext, channel: string, ...args: unknown[]): Promise<T> {
  const csrf = (await context.cookies()).find(c => c.name === 'polenta_csrf')?.value ?? ''
  const res = await context.request.post(`/rpc/${encodeURIComponent(channel)}`, {
    headers: { 'x-polenta-csrf': csrf },
    data: { args, undefinedArgs: args.flatMap((a, i) => (a === undefined ? [i] : [])) },
  })
  const body = await res.json().catch(() => null) as { ok?: boolean; value?: T; error?: { message?: string } } | null
  if (!body?.ok) throw new Error(`${channel} : ${body?.error?.message ?? `erreur serveur (${res.status()})`}`)
  return body.value as T
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
