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
  const bare = path.join(seed, 'demo-ll800-produit.git')
  if (!fs.existsSync(bare)) {
    fs.mkdirSync(seed, { recursive: true })
    execFileSync('git', ['clone', '--bare', '--quiet', E2E.demoSource, bare], { stdio: 'inherit' })
  }

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
