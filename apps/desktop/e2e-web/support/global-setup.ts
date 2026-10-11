import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { E2E } from './env'
import { startGitHttpServer } from './git-http-server'

/**
 * Repo nu de la démo servi en HTTP local : la « forge » des tests (clone depuis l'accueil web,
 * Publier). Le serveur git vit le temps de l'exécution.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  fs.mkdirSync(E2E.remotesDir, { recursive: true })
  fs.mkdirSync(E2E.downloadsDir, { recursive: true })
  const bare = path.join(E2E.remotesDir, 'demo-ll800-produit.git')
  if (!fs.existsSync(bare)) {
    execFileSync('git', ['clone', '--bare', '--quiet', E2E.demoSource, bare], { stdio: 'inherit' })
  }
  const server = await startGitHttpServer(E2E.remotesDir, E2E.gitPort)
  return async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
