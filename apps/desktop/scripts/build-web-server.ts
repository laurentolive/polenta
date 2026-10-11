/**
 * Bundle du serveur web (GH44) — mêmes options que l'ancienne ligne de commande esbuild de
 * `build:web-server`, plus la marque (GH49) injectée en `define`, comme le serveur MCP
 * (scripts/build-mcp-server.ts) : les services partagés lisent `BRAND` dès leur chargement.
 */
import path from 'node:path'
import { build } from 'esbuild'
import { loadBrand } from './brand'

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
  external: ['keytar', 'fsevents', 'fastify', '@fastify/*', 'react-native', 'react-native-fetch-blob', 'react-native-fs'],
  alias: { electron: './src/mcp-server/electron-shim.ts' },
  define: { __POLENTA_BRAND__: JSON.stringify(brand.info) },
  logLevel: 'info',
}).catch(() => process.exit(1))
