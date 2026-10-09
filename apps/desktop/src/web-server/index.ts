import * as fs from 'fs'
import * as path from 'path'
import { loadConfig } from './config'
import { buildServer } from './app'
import { applyServerHardening } from './hardening'

/**
 * GH44 — point d'entrée du serveur web Polenta. `appRoot` = `apps/desktop` : en dev (`tsx`) ce
 * fichier est dans `src/web-server/`, une fois bundlé dans `out/web-server/`.
 */
async function main(): Promise<void> {
  const appRoot = path.resolve(__dirname, '..', '..')
  const config = loadConfig(appRoot)
  applyServerHardening({ dataDir: config.dataDir, gitHosts: config.gitHosts, gitAllowHttp: config.gitAllowHttp })
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf-8')) as { version: string }
  const { app } = await buildServer(config, pkg.version)
  if (!config.auth.token) {
    app.log.warn('POLENTA_WEB_DEV_TOKEN vide : clone/push vers un remote privé échoueront.')
  }
  await app.listen({ port: config.port, host: config.host })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { void app.close().then(() => process.exit(0)) })
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
