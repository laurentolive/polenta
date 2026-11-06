// GH26 — préférences de l'application (par machine/utilisateur OS, userData/app-settings.json),
// distinctes des préférences de projet versionnées dans schema.yaml.
export interface AppSettings {
  /** GH302 — téléchargement automatique des nouvelles versions (la vérification se fait toujours ;
   *  clé GH26 conservée pour reprendre le choix existant). Défaut : true. */
  autoCheckUpdates: boolean
  /** GH34 — dossier de la bibliothèque de gabarits d'export (chemin absolu). Absent = non configuré. */
  exportTemplatesDir?: string
  /** GH15 — délai de connexion réseau (s), 10–120. Absent du fichier = 10 (défaut) ; toujours renseigné par `get()`. */
  networkTimeoutSeconds?: number
  /** GH237 — zoom de l'interface, palier de `ZOOM_STEPS` (shared/zoom.ts). Absent = 1 (100 %). */
  zoomFactor?: number
  /** GH45 — lecture seule : la configuration machine impose `autoCheckUpdates: false` (jamais écrit). */
  autoCheckUpdatesLocked?: boolean
}

/** GH237 — commande de zoom de l'interface (palier suivant / précédent, retour à 100 %). */
export type ZoomAction = 'in' | 'out' | 'reset'

// GH26 — état de la mise à jour automatique (electron-updater), poussé par le main au renderer.
// GH302 — 'available' (détectée, pas téléchargée), 'installing' (installeur lancé).
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'installing'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  /** Renseigné dès qu'une version plus récente est trouvée ('available'). */
  availableVersion?: string
  /** Page de la release GitHub de availableVersion. */
  releaseUrl?: string
  /** GH302 — 'downloading' : avancement 0–100 (entier). */
  progress?: number
  /** GH302 — verrou DSI / forge (GH45) : information seulement, ni téléchargement ni installation. */
  managed?: boolean
  /** GH302 — web : version servie par le serveur, différente de celle chargée par la page. */
  servedVersion?: string
}

/** GH302 — ce que l'installation va fermer (confirmation du renderer). */
export interface UpdateInstallPlan {
  /** Serveurs MCP lancés depuis cette installation (Windows). */
  mcpServers: number
  /** Fenêtres de l'application autres que celle qui demande l'installation. */
  otherWindows: number
}

// GH238 — terminal de la vue Version (desktop) : shell détecté, ou Git Bash introuvable.
export type TerminalDetectResult =
  | { status: 'found'; shell: { name: string; file: string } }
  | { status: 'not-found'; winget: boolean }

/** `install-git` : `winget install Git.Git` dans le pseudo-terminal (Git absent, Windows). */
export type TerminalKind = 'shell' | 'install-git'
