import type { BrandInfo } from './brand-types'

/**
 * GH49 — marque de ce binaire, seul point de lecture de la marque dans le code applicatif
 * (main, preload, renderer, serveur MCP). Figée au build : `define` __POLENTA_BRAND__
 * (electron.vite.config.ts, scripts/build-mcp-server.ts) ; pour un point d'entrée exécuté
 * par `tsx` (scripts check-*, serveur MCP en dev), `scripts/register-brand.ts` la pose sur
 * `globalThis` avant tout import applicatif.
 *
 * Jamais de repli sur Polenta (spec §3.2) : un build sans marque échoue au démarrage plutôt
 * que de livrer à un client un binaire affichant « Polenta ».
 */
declare const __POLENTA_BRAND__: BrandInfo | undefined

function resolveBrand(): BrandInfo {
  const injected = typeof __POLENTA_BRAND__ !== 'undefined' ? __POLENTA_BRAND__ : undefined
  const brand = injected ?? (globalThis as { __POLENTA_BRAND__?: BrandInfo }).__POLENTA_BRAND__
  if (!brand) {
    throw new Error(
      '[brand] marque non injectée : build sans define __POLENTA_BRAND__, ou point d’entrée tsx ' +
        'qui n’importe pas scripts/register-brand.ts en premier.',
    )
  }
  return brand
}

export const BRAND: BrandInfo = resolveBrand()

export type { BrandInfo } from './brand-types'
