/**
 * GH44 — ce dont les handlers partagés ont besoin de l'hôte d'affichage (fenêtres Electron ou
 * navigateurs connectés au serveur web), cf. specs/GH44-design.md §3.2.
 */
export interface PlatformHost {
  kind: 'desktop' | 'web'
  /** Pousse un événement à toutes les vues ouvertes (fenêtres desktop / sockets de l'utilisateur). */
  broadcast(channel: string, ...args: unknown[]): void
  /** Dossier des gabarits d'export d'exemple (GH34) livrés avec l'application. */
  exportTemplateExamplesDir(): string
}
