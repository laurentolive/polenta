// GH446 — fichier d'un objet dans le repo, pour son historique Git (popup « Historique »). Partagé par le
// client et le main : la liste des commits et le diff désignent le même fichier.

/** Objets dont la popup « Historique » affiche les commits. */
export type ObjectCommitKind = 'requirement' | 'test' | 'campaign' | 'issue' | 'version' | 'validation'

const OBJECT_DIRS: Record<ObjectCommitKind, string> = {
  requirement: 'requirements',
  test: 'tests',
  campaign: 'campaigns',
  issue: 'issues',
  version: 'versions',
  validation: 'validations',
}

export function isObjectCommitKind(value: string): value is ObjectCommitKind {
  return Object.prototype.hasOwnProperty.call(OBJECT_DIRS, value)
}

/** Chemin du fichier de l'objet dans le repo (`requirements/<ID>.yaml`, `versions/<ID>.yaml`…). L'ID n'est pas
 *  libre : il vient du client web, et ne doit pouvoir désigner qu'un fichier du dossier attendu. */
export function objectHistoryFile(kind: ObjectCommitKind, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) throw new Error(`identifiant d'objet invalide : ${id}`)
  return `${OBJECT_DIRS[kind]}/${id}.yaml`
}

/** Une entrée de la liste : un commit qui modifie le fichier de l'objet (premier parent, du plus récent au plus ancien). */
export interface ObjectCommit {
  oid: string
  /** Date du commit (ISO 8601). */
  at: string
  /** Auteur du commit. */
  by: string
  /** Première ligne du message. */
  subject: string
}
