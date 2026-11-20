import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { FullConfig } from '@playwright/test'
import { E2E, STACKS_FILE } from './env'
import { planStacks, startStack } from './stack'

/**
 * Global setup : repo nu de la démo (cache entre exécutions, `cachedDemo`), puis une pile par worker
 * (GH387, `support/stack.ts`) — sa forge git HTTP reçoit une copie du repo nu, son serveur web et
 * son faux service d'administration écoutent sur des ports libres. Les piles sont décrites dans
 * `<run>/stacks.json` (lu par `env.ts` dans les workers) et vivent le temps de l'exécution.
 */
export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  const remotes = { 'demo-ll800-produit.git': cachedDemo() }
  const stacks = await planStacks(Math.max(1, config.workers))
  fs.mkdirSync(E2E.root, { recursive: true })
  fs.writeFileSync(STACKS_FILE, JSON.stringify(stacks, null, 2))
  const started = await Promise.allSettled(stacks.map(s => startStack(s, remotes)))
  const stops = started.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
  const teardown = async () => { await Promise.all(stops.map(stop => stop())) }
  const failed = started.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) {
    await teardown()
    throw failed.reason
  }
  return teardown
}

/** Mise à jour du cache tentée au plus une fois par période (plusieurs exécutions rapprochées). */
const CACHE_REFRESH_MS = 10 * 60_000

/**
 * GH387 — repo nu de la démo gardé d'une exécution à l'autre (`%TEMP%/polenta-e2e-web/cache`) : cloné
 * s'il n'existe pas, mis à jour depuis `E2E.demoSource` au plus toutes les 10 min, utilisé tel quel si
 * la source ne répond pas (coupure réseau passagère). Plusieurs worktrees peuvent démarrer en même
 * temps : clone dans un dossier propre au process, puis renommage (le premier gagne).
 */
function cachedDemo(): string {
  const key = E2E.demoSource.replace(/[^a-zA-Z0-9]+/g, '_').slice(-80)
  const cache = path.join(path.dirname(E2E.root), 'cache', `${key}.git`)
  const stamp = `${cache}.fetched`
  if (!fs.existsSync(cache)) {
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    const tmp = `${cache}.${process.pid}`
    execFileSync('git', ['clone', '--bare', '--quiet', E2E.demoSource, tmp], { stdio: 'inherit' })
    try {
      fs.renameSync(tmp, cache)
      fs.writeFileSync(stamp, '')
    } catch {
      fs.rmSync(tmp, { recursive: true, force: true }) // clone concurrent déjà en place
    }
    return cache
  }
  const fresh = fs.existsSync(stamp) && Date.now() - fs.statSync(stamp).mtimeMs < CACHE_REFRESH_MS
  if (fresh) return cache
  try {
    execFileSync('git', ['--git-dir', cache, 'fetch', '--quiet', '--prune', '--force', E2E.demoSource,
      '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'], { stdio: ['ignore', 'ignore', 'pipe'] })
    fs.writeFileSync(stamp, '')
  } catch (err) {
    process.stderr.write(`[e2e] démo non mise à jour (${E2E.demoSource}), copie en cache utilisée : ${String(err).split('\n')[0]}\n`)
  }
  return cache
}
