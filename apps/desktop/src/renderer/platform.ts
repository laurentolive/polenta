/**
 * GH44 — plateforme d'exécution du renderer : application desktop (preload Electron) ou navigateur
 * (`web/bridge.ts`, qui pose `window.polenta.platform = 'web'`). Les composants masquent ce qui
 * n'a pas de sens hors du poste local plutôt que d'afficher un bouton inopérant.
 */
export const platform: 'desktop' | 'web' =
  (window.polenta as { platform?: 'web' } | undefined)?.platform === 'web' ? 'web' : 'desktop'

export const isWeb = platform === 'web'

export const capabilities = {
  /** Choisir un dossier, afficher un fichier dans l'explorateur, ouvrir un fichier exporté. */
  localFilesystem: !isWeb,
  /** Ouvrir un `.drawio` dans l'application draw.io du poste (#46 pour le web). */
  externalDrawioEditor: !isWeb,
  /** Mise à jour automatique de l'application (le serveur web est mis à jour par l'exploitant). */
  autoUpdate: !isWeb,
  /** Comptes multiples, PAT, Device Flow : sur le web, le compte est celui de la session. */
  accountManagement: !isWeb,
  /**
   * GH63 — administration du serveur (version web) : la visibilité réelle vient de
   * `GET /admin/api/me` (propriétaire de l'organisation). Le desktop n'envoie aucune requête admin.
   */
  serverAdmin: isWeb,
} as const
