/**
 * GH37 — résolution des conflits de merge dans l'outil. Une session couvre un merge en conflit
 * d'un repo (gauche = « mes modifications », droite = « version de destination ») ; elle est
 * persistée hors du repo (brouillon `userData/merge-drafts/`) jusqu'à finalisation ou abandon.
 */

export type MergeSide = 'left' | 'right'

/** Opération qui a produit le conflit — détermine les libellés et la suite après finalisation. */
export type MergeOrigin =
  | { kind: 'publish'; workBranch: string; integrationBranch: string; title: string; ephemeral: boolean }
  | { kind: 'merge'; from: string; into: string }

export type MergeConflictKind = 'both-modified' | 'both-added' | 'deleted-left' | 'deleted-right'

/** `object` = exigence/test/campagne… (fusion par champ), `text` = hunks de lignes, `binary` = choix d'un côté. */
export type MergeFileKind = 'object' | 'text' | 'binary'

export interface MergeFileEntry {
  path: string
  conflict: MergeConflictKind
  kind: MergeFileKind
  objectId?: string
  title?: string
  state: 'todo' | 'merged'
}

export interface MergeSessionInfo {
  id: string
  repoPath: string
  origin: MergeOrigin
  leftRef: string
  rightRef: string
  leftOid: string
  rightOid: string
  baseOid: string
  /** Branche mise à jour par la finalisation, et le côté dont elle provient. */
  targetRef: string
  targetSide: MergeSide
  files: MergeFileEntry[]
}

/** Avancement d'un fichier : texte de sortie (objet/texte) ou côté retenu (binaire, supprimé/modifié). */
export interface MergeFileDraft {
  state: 'todo' | 'merged'
  text?: string
  choice?: MergeSide
}

export interface MergeFileDetail extends MergeFileEntry {
  /** Contenus texte des trois versions — `null` = absent de ce côté (ou binaire). */
  base: string | null
  left: string | null
  right: string | null
  /** Sortie initiale calculée (régions de marqueurs comprises) — `null` si un seul côté existe ou binaire. */
  initialOutput: string | null
  blocks: { key: string; left?: string; right?: string }[]
  auto: { key: string; from: MergeSide | 'both' }[]
  draft?: MergeFileDraft
}

export interface MergeValidationIssue {
  code:
    | 'yaml'
    | 'unresolved'
    | 'notObject'
    | 'idMismatch'
    | 'unknownType'
    | 'unknownStatus'
    | 'emptyTitle'
    | 'fieldsNotObject'
  params?: Record<string, string | number>
}

export interface MergeValidation {
  errors: MergeValidationIssue[]
  warnings: MergeValidationIssue[]
}

export type MergeFinalizeResult =
  | { ok: true; sha: string; session: MergeSessionInfo }
  | { ok: false; reason: 'stale' | 'dirty-worktree' | 'unresolved' | 'invalid'; paths?: string[] }
