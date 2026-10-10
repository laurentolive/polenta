/**
 * GH49 — packaging electron-builder de la marque POLENTA_BRAND (défaut `polenta`), via l'API
 * programmatique (la configuration dépend de la marque : electron-builder.config.ts).
 * Lancé par `pnpm package`, après `electron-vite build` et `build:mcp-server`.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'electron-builder'
import { builderConfig } from '../electron-builder.config'
import { loadBrand } from './brand'

const brand = loadBrand()
console.log(`[package] marque ${brand.info.id} — ${brand.info.productName}`)

// Les bundles (electron-vite build, build:mcp-server) lisent POLENTA_BRAND chacun de leur côté :
// refuser de packager un mélange de marques (ex. serveur MCP lisant les comptes d'une autre marque).
const root = path.resolve(__dirname, '..')
const appIdMarker = `appId: ${JSON.stringify(brand.info.appId)}`
for (const bundle of ['out/main/index.js', 'out/mcp-server/index.cjs']) {
  const file = path.join(root, bundle)
  if (!existsSync(file) || !readFileSync(file, 'utf8').includes(appIdMarker)) {
    console.error(`[package] ${bundle} absent ou construit pour une autre marque que ${brand.info.id} — relancer le build complet (pnpm package) avec la même POLENTA_BRAND.`)
    process.exit(1)
  }
}

build({
  projectDir: path.resolve(__dirname, '..'),
  config: builderConfig(brand),
  publish: 'never',
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
