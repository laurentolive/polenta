/**
 * GH37 — résolution des conflits de merge dans l'outil. Une session couvre un merge en conflit
 * d'un repo (gauche = « mes modifications », droite = « version de destination ») ; elle est
 * persistée hors du repo (brouillon `userData/merge-drafts/`) jusqu'à finalisation ou abandon.
 */

export type MergeSide = 'left' | 'right'

/** Opération qui a produit le conflit — détermine les libellés, la branche avancée par la
 *  finalisation et la suite après finalisation. */
export type MergeOrigin =
  | { kind: 'publish'; workBranch: string; integrationBranch: string; title: string; ephemeral: boolean }
  /** Vue graphe : merge de `from` dans `into` (la branche courante pour « merge »). */
  | { kind: 'merge'; from: string; into: string }
  /** Rafraîchir : la branche locale (gauche, avancée) reçoit `remoteRef` (droite). */
  | { kind: 'pull'; branch: string; remoteRef: string }

/** `renumbered` (sprint 3) : fichier sans conflit touché par la renumérotation « Garder les deux »,
 *  listé pour relecture avant d'être mergé. */
export type MergeConflictKind = 'both-modified' | 'both-added' | 'deleted-left' | 'deleted-right' | 'renumbered'

/** `object` = exigence/test/campagne… (fusion par champ), `links`/`parameters` = par lien / par
 *  paramètre, `text` = hunks de lignes, `binary` = choix d'un côté. */
export type MergeFileKind = 'object' | 'links' | 'parameters' | 'text' | 'binary'

export interface MergeFileEntry {
  path: string
  conflict: MergeConflictKind
  kind: MergeFileKind
  objectId?: string
  title?: string
  state: 'todo' | 'merged'
}

export interface MergeRenumber {
  oldId: string
  newId: string
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
  /** Arbre gauche réécrit par « Garder les deux » (sinon l'arbre de `leftOid`). */
  leftTreeOid?: string
  renumbers: MergeRenumber[]
  /** Branche mise à jour par la finalisation, et le côté dont elle provient. */
  targetRef: string
  targetSide: MergeSide
  files: MergeFileEntry[]
  /** Calculé à la lecture : une des deux branches a bougé depuis l'ouverture — la session ne peut
   *  plus être finalisée, il faut repartir d'une résolution neuve. */
  stale?: boolean
  /** Un brouillon périmé du même merge a été remplacé par cette session (à signaler une fois). */
  replacedStaleDraft?: boolean
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
  /** Binaire de type image : aperçus (data URL) des versions présentes. */
  images?: { base?: string; left?: string; right?: string }
  /** Sortie initiale calculée (régions de marqueurs comprises) — `null` pour un choix de côté. */
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
    | 'requiredEmpty'
    | 'ears'
    | 'invalidLinks'
    | 'invalidParameters'
  params?: Record<string, string | number>
}

export interface MergeValidation {
  errors: MergeValidationIssue[]
  warnings: MergeValidationIssue[]
}

/** « Garder les deux » : ID attribué à l'objet de gauche et fichiers réécrits (aperçu puis application). */
export interface MergeKeepBothResult {
  oldId: string
  newId: string
  impacted: string[]
  /** Présent quand la renumérotation a été appliquée (session recalculée). */
  session?: MergeSessionInfo
}

export type MergeFinalizeResult =
  | { ok: true; sha: string; session: MergeSessionInfo }
  | { ok: false; reason: 'stale' | 'dirty-worktree' | 'unresolved' | 'invalid'; paths?: string[] }
