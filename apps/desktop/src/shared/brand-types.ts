/**
 * GH49 — types de la marque (marque blanche). Sans dépendance : importé à la fois par le code
 * applicatif (main, preload, renderer, serveur MCP) et par les scripts de build.
 */

export type BrandUpdate =
  | { provider: 'github'; owner: string; repo: string }
  | { provider: 'generic'; url: string; releasesUrl?: string }

/**
 * Ce qui est figé dans le binaire au build (`define` __POLENTA_BRAND__) — doit rester
 * sérialisable en JSON. Source : `apps/desktop/brands/<id>/brand.yaml`, lu et validé par
 * `scripts/brand.ts`.
 */
export interface BrandInfo {
  /** `[a-z0-9-]+`, égal au nom du dossier de la marque ; nomme aussi le service keytar des comptes
   * (Polenta → 'polenta', valeur historique). */
  id: string
  /** Nom affiché partout (fenêtre, UI, installeur, fichiers générés) ; nomme aussi le dossier userData. */
  productName: string
  /** Identifiant OS de l'application, unique par marque. */
  appId: string
  /** Nom npm packagé (dossier d'installation NSIS, cache de l'updater) — défaut : `id`. */
  executableName: string
  website?: string
  /** Absent → mise à jour automatique désactivée pour cette marque. */
  update?: BrandUpdate
  /** Page des releases (lien « notes de version » du badge de mise à jour) — dérivée de `update`. */
  releasesUrl?: string
  hasLogo: boolean
}

/** Surcharges de tokens de `src/renderer/theme.config.ts`, triplets "R G B". */
export type BrandTheme = Record<string, { light?: string; dark?: string }>
