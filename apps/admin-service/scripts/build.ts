/**
 * GH63 — bundle du service d'administration et du proxy Docker (deux points d'entrée, une image).
 * Tout est embarqué (fastify compris) : l'image n'a pas de node_modules à installer.
 */
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(__dirname, '..')

build({
  absWorkingDir: root,
  entryPoints: { index: 'src/index.ts', 'docker-proxy/server': 'src/docker-proxy/main.ts' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  alias: { '@polenta/types': '../../packages/types/src/index.ts' },
  logLevel: 'info',
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
