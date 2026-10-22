/**
 * Bundle du serveur web (GH44) — mêmes options que l'ancienne ligne de commande esbuild de
 * `build:web-server`, plus la marque (GH49) injectée en `define`, comme le serveur MCP
 * (scripts/build-mcp-server.ts) : les services partagés lisent `BRAND` dès leur chargement.
 */
import path from 'node:path'
import { build } from 'esbuild'
import { loadBrand } from './brand'
import { buildScriptWorker } from './script-worker-build'

const root = path.resolve(__dirname, '..')
const brand = loadBrand()

build({
  absWorkingDir: root,
  entryPoints: ['src/web-server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'out/web-server/index.cjs',
  // playwright-core (GH44 S4, impression) : binaires et chemins de navigateurs résolus à l'exécution.
  // @aws-sdk/client-s3 (GH131) : require paresseux de l'entrée S3 d'unzipper (GH120), non utilisée.
  external: ['keytar', 'fsevents', 'fastify', '@fastify/*', 'playwright-core', '@aws-sdk/client-s3', 'react-native', 'react-native-fetch-blob', 'react-native-fs'],
  alias: { electron: './src/mcp-server/electron-shim.ts' },
  define: { __POLENTA_BRAND__: JSON.stringify(brand.info) },
  logLevel: 'info',
})
  // GH74 — worker du moteur de scripts et .wasm de QuickJS (bibliothèque de départ : resources/ de l'image).
  .then(() => buildScriptWorker('out/web-server'))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
