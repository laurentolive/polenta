import { api } from '../api'

/**
 * GH343 — « dernier projet ouvert » posé par l'arrivée d'une fenêtre sur un projet (pages /schema,
 * /preferences), une fois par projet et par fenêtre — plus à chaque montage de ces pages. Le
 * routeur remonte parfois toute la page au moment où l'on en part (cf. `TabsContext`, sessionCache) :
 * « Fermer le projet » depuis /schema remarquait aussitôt le projet fermé comme dernier ouvert, et
 * le lancement suivant y retournait. Les ouvertures explicites (récents, accueil) appellent
 * `markRecent` directement.
 *
 * État du module = état du renderer, donc propre à chaque fenêtre.
 */
let lastMarked: string | null = null

/** Accueil atteint après « Fermer le projet » (remontage parasite passé) : revenir ensuite au même
 *  projet dans cette fenêtre (Précédent, onglet rouvert) le marque de nouveau. */
export function resetRecentMark(): void {
  lastMarked = null
}

export function markRecentOnce(workspaceDir: string): void {
  if (workspaceDir === lastMarked) return
  lastMarked = workspaceDir
  void api.workspace.markRecent(workspaceDir)
}
