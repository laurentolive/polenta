import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { FullConfig } from '@playwright/test'
import { E2E, STACKS_FILE } from './env'
import { planStack, startStack } from './stack'

/**
 * Global setup : repo nu de la démo cloné une fois (`<run>/seed`), puis une pile par worker
 * (GH387, `support/stack.ts`) — sa forge git HTTP reçoit une copie du repo nu, son serveur web et
 * son faux service d'administration écoutent sur des ports libres. Les piles sont décrites dans
 * `<run>/stacks.json` (lu par `env.ts` dans les workers) et vivent le temps de l'exécution.
 */
export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  const seed = path.join(E2E.root, 'seed')
  fs.mkdirSync(seed, { recursive: true })
  fs.cpSync(cachedDemo(), path.join(seed, 'demo-ll800-produit.git'), { recursive: true })

  const stacks = await Promise.all(Array.from({ length: Math.max(1, config.workers) }, (_, i) => planStack(i)))
  fs.writeFileSync(STACKS_FILE, JSON.stringify(stacks, null, 2))
  const started = await Promise.allSettled(stacks.map(s => startStack(s, seed)))
  const stops = started.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
  const teardown = async () => { await Promise.all(stops.map(stop => stop())) }
  const failed = started.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) {
    await teardown()
    throw failed.reason
  }
  return teardown
}

/**
 * GH387 — repo nu de la démo gardé d'une exécution à l'autre (`%TEMP%/polenta-e2e-web/cache`) : mis
 * à jour depuis `E2E.demoSource` quand la source répond, utilisé tel quel sinon (coupure réseau
 * passagère), cloné s'il n'existe pas encore.
 */
function cachedDemo(): string {
  const key = E2E.demoSource.replace(/[^a-zA-Z0-9]+/g, '_').slice(-80)
  const cache = path.join(path.dirname(E2E.root), 'cache', `${key}.git`)
  if (!fs.existsSync(cache)) {
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    const tmp = `${cache}.${process.pid}`
    execFileSync('git', ['clone', '--bare', '--quiet', E2E.demoSource, tmp], { stdio: 'inherit' })
    fs.renameSync(tmp, cache)
    return cache
  }
  try {
    execFileSync('git', ['--git-dir', cache, 'fetch', '--quiet', '--prune', '--force', E2E.demoSource,
      '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (err) {
    process.stderr.write(`[e2e] démo non mise à jour (${E2E.demoSource}), copie en cache utilisée : ${String(err).split('\n')[0]}\n`)
  }
  return cache
}
