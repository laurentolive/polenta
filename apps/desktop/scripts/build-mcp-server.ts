/**
 * Bundle autonome du serveur MCP (T122 sprint 4) — mêmes options que l'ancienne ligne de commande
 * esbuild de `build:mcp-server`, plus la marque (GH49) injectée en `define` : le serveur packagé
 * avec une marque lit les comptes (service keytar) de cette marque.
 */
import path from 'node:path'
import { build } from 'esbuild'
import { loadBrand } from './brand'
import { buildScriptWorker, copyDashboardLib } from './script-worker-build'

const root = path.resolve(__dirname, '..')
const brand = loadBrand()

build({
  absWorkingDir: root,
  entryPoints: ['src/mcp-server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'out/mcp-server/index.cjs',
  external: ['keytar', 'react-native', 'react-native-fetch-blob', 'react-native-fs'],
  alias: { electron: './src/mcp-server/electron-shim.ts' },
  define: { __POLENTA_BRAND__: JSON.stringify(brand.info) },
  logLevel: 'info',
})
  // GH74 — worker du moteur de scripts et .wasm de QuickJS ; bibliothèque de départ à côté du bundle.
  .then(() => buildScriptWorker('out/mcp-server'))
  .then(() => copyDashboardLib('out/mcp-server'))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
