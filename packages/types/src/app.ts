// GH26 — préférences de l'application (par machine/utilisateur OS, userData/app-settings.json),
// distinctes des préférences de projet versionnées dans schema.yaml.
export interface AppSettings {
  /** Vérifier, télécharger puis proposer les mises à jour au démarrage. Défaut : true. */
  autoCheckUpdates: boolean
  /** GH34 — dossier de la bibliothèque de gabarits d'export (chemin absolu). Absent = non configuré. */
  exportTemplatesDir?: string
}

// GH26 — état de la mise à jour automatique (electron-updater), poussé par le main au renderer.
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  /** Renseigné dès qu'une version plus récente est trouvée ('downloading'). */
  availableVersion?: string
  /** Page de la release GitHub de availableVersion. */
  releaseUrl?: string
}
