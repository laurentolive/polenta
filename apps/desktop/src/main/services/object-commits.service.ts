import { isObjectCommitKind, objectHistoryFile, type ObjectCommit } from '@polenta/types'
import type { GitService } from './git.service'

// GH446 — commits qui modifient le fichier d'un objet (popup « Historique »). Donnée brute : la liste est celle
// de Git (premier parent, du plus récent au plus ancien), sans compteur ni regroupement.

/** IPC `history:commits`. Un kind inconnu lève l'erreur (critère 7) ; le fichier n'est jamais lu hors du dossier de son type. */
export async function listObjectCommits(
  git: Pick<GitService, 'fileCommits'>, repoPath: string, kind: string, id: string,
): Promise<ObjectCommit[]> {
  if (!isObjectCommitKind(kind)) throw new Error(`history:commits — unknown object kind: ${kind}`)
  return git.fileCommits(repoPath, objectHistoryFile(kind, id))
}
