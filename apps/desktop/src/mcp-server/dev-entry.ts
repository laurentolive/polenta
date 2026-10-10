/**
 * GH49 — point d'entrée du serveur MCP en dev (`tsx`, sans `define` de build) : pose la marque
 * avant de charger le serveur, dont les services lisent `BRAND` dès leur chargement. La marque
 * vient de `--brand <id>` (écrit dans .mcp.json par l'app `pnpm dev`), sinon de POLENTA_BRAND,
 * sinon polenta. Le bundle packagé part directement de index.ts (marque en `define`).
 */
const brandArg = process.argv.indexOf('--brand')
if (brandArg !== -1 && process.argv[brandArg + 1]) {
  process.env['POLENTA_BRAND'] = process.argv[brandArg + 1]
  process.argv.splice(brandArg, 2)
}

void import('../../scripts/register-brand').then(() => import('./index'))
