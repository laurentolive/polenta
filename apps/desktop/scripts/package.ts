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
import { appVersion } from './app-version'

const brand = loadBrand()
// GH158 — version déduite du tag git, pas du package.json du repo (figé à 0.0.0-dev).
const version = appVersion()
console.log(`[package] marque ${brand.info.id} — ${brand.info.productName} ${version}`)

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

// Réécrite dans le package.json packagé : app.getVersion(), macro ${version} (nom de l'installeur)
// et latest.yml la lisent.
const config = builderConfig(brand)
config.extraMetadata = { ...config.extraMetadata, version }

build({
  projectDir: path.resolve(__dirname, '..'),
  config,
  publish: 'never',
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
