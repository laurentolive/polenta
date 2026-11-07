/**
 * Bundle autonome du serveur MCP (T122 sprint 4) — mêmes options que l'ancienne ligne de commande
 * esbuild de `build:mcp-server`, plus la marque (GH49) injectée en `define` : le serveur packagé
 * avec une marque lit les comptes (service keytar) de cette marque.
 */
import path from 'node:path'
import { build, type BuildOptions } from 'esbuild'
import { loadBrand } from './brand'
import { buildScriptWorker, copyDashboardLib } from './script-worker-build'

const root = path.resolve(__dirname, '..')
const brand = loadBrand()
// GH129 — dépendances ESM (fdir, via tinyglobby) qui lisent `import.meta.url`, vide dans un bundle CJS.
const IMPORT_META_BANNER = "var __polentaImportMetaUrl = require('url').pathToFileURL(__filename).href;"

/** GH129 — options communes au serveur MCP et à la CLI : un seul endroit pour les externes, alias et define. */
const nodeBundle = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['keytar', 'react-native', 'react-native-fetch-blob', 'react-native-fs'],
  alias: { electron: './src/mcp-server/electron-shim.ts' },
  define: { __POLENTA_BRAND__: JSON.stringify(brand.info), 'import.meta.url': '__polentaImportMetaUrl' },
  banner: { js: IMPORT_META_BANNER },
} satisfies BuildOptions

build({ ...nodeBundle, entryPoints: ['src/mcp-server/index.ts'], outfile: 'out/mcp-server/index.cjs', logLevel: 'info' })
  // GH129 — CLI (`polenta-cli.cjs import-results …`) : même graphe de services, même dossier (copié dans
  // l'application installée par `extraResources`) ; publiée seule en asset de release (Node.js 20+ seul).
  .then(() => build({
    ...nodeBundle, entryPoints: ['src/cli/index.ts'], outfile: 'out/mcp-server/polenta-cli.cjs', target: 'node20', logLevel: 'warning',
  }))
  // GH74 — worker du moteur de scripts et .wasm de QuickJS ; bibliothèque de départ à côté du bundle.
  .then(() => buildScriptWorker('out/mcp-server'))
  .then(() => copyDashboardLib('out/mcp-server'))
  // GH74 — compilateur Vega-Lite en ESM séparé (Vega 6 : ESM seul, await de premier niveau).
  .then(() => build({
    absWorkingDir: root,
    entryPoints: ['src/mcp-server/vega-compile.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'out/mcp-server/vega-compile.mjs',
    logLevel: 'warning',
  }))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
