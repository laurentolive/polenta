/**
 * GH129 — point d'entrée de la CLI en dev (`tsx`, sans `define` de build) : pose la marque avant de
 * charger la CLI, comme `mcp-server/dev-entry.ts`. Marque : `--brand <id>`, sinon POLENTA_BRAND,
 * sinon polenta. Le bundle (`out/mcp-server/polenta-cli.cjs`) part directement de index.ts.
 */
const brandArg = process.argv.indexOf('--brand')
if (brandArg !== -1 && process.argv[brandArg + 1]) {
  process.env['POLENTA_BRAND'] = process.argv[brandArg + 1]
  process.argv.splice(brandArg, 2)
}

void import('../../scripts/register-brand').then(() => import('./index'))
export {}
