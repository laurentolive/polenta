import * as fs from 'fs'
import * as path from 'path'
import { loadConfig } from './config'
import { buildServer } from './app'
import { applyServerHardening } from './hardening'

/** GH158 — version calculée au build (scripts/app-version.ts), injectée par build-web-server.ts. */
declare const __POLENTA_VERSION__: string | undefined

/**
 * GH44 — point d'entrée du serveur web Polenta. `appRoot` = `apps/desktop` : en dev (`tsx`) ce
 * fichier est dans `src/web-server/`, une fois bundlé dans `out/web-server/` ; dans l'image Docker,
 * `/app` (`POLENTA_WEB_APP_ROOT`).
 */
async function main(): Promise<void> {
  // Image Docker (GH44 S4) : `POLENTA_WEB_APP_ROOT=/app` (package.json, resources, web).
  const appRoot = process.env['POLENTA_WEB_APP_ROOT'] ?? path.resolve(__dirname, '..', '..')
  const config = loadConfig(appRoot)
  applyServerHardening({ dataDir: config.dataDir, gitHosts: config.gitHosts, gitAllowHttp: config.gitAllowHttp })
  // En dev (`tsx`, pas de define) : version de package.json.
  const version = typeof __POLENTA_VERSION__ !== 'undefined'
    ? __POLENTA_VERSION__
    : (JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf-8')) as { version: string }).version
  const { app } = await buildServer(config, version)
  if (config.auth.mode === 'dev' && !config.auth.token) {
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
