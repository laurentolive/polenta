import type { ObjectHistory } from './history'

// GH244 — issue : modification du produit non tracée dans les exigences (bug, non-conformité…) ou
// constat à traiter. Fichier `issues/<ID>.yaml` du repo de son composant. Pas de verrou d'approbation.

/** Type de lien issue → exigence, ajouté au schéma avec le premier type issue. */
export const ISSUE_IMPACT_LINK = 'issue-impact'

export interface IssueOrigin {
  /** Exécutions (`test-runs/`) à l'origine de l'issue. */
  runs?: string[]
  /** Décisions de validation (#204). */
  decisions?: string[]
}

export interface Issue {
  id: string
  projectId: string
  branchId: string
  objectTypeRef: string
  title: string
  status: string
  version: number
  fields: Record<string, unknown>
  /** Absent : créée à la main. */
  origin?: IssueOrigin
  history?: ObjectHistory
  // Dérivés du git log du fichier, pas persistés.
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}
