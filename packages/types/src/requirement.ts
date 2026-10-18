import type { ObjectHistory } from './history'

export type JiraLinkType = 'IMPLEMENTS' | 'RELATED_TO' | 'ORIGINATED_FROM' | 'BLOCKS'

export interface JiraLink {
  key: string
  type: JiraLinkType
  summary: string
  status: string
  url: string
  linkedAt: string
  linkedBy: string
}

// Lien sémantique entre deux objets (requirement↔requirement, test→requirement, etc.).
// type référence LinkTypeDefinition.name du schéma.
// targetCommitHash : hash git du fichier cible au moment de la création du lien (non
//   utilisé pour la revalidation).
// needsRevalidation : @deprecated (T172) — l'impact d'une modification est porté par les
//   éléments liés (`Requirement.needsRevalidation` / `TestCase.needsRevalidation`), plus par
//   le lien. Optionnel car les links.yaml existants contiennent encore `false` ; ni lu ni écrit.
// coverageType renseigné uniquement pour les liens test → requirement.
export interface ObjectLink {
  id: string
  type: string
  sourceId: string
  targetId: string
  targetCommitHash?: string
  /** @deprecated T172 — voir commentaire ci-dessus. */
  needsRevalidation?: boolean
  coverageType?: 'full' | 'partial'
  createdAt: string
  createdBy: string
}

// GH105 — liens inter-repos : agrégation sur les repos du workspace (repo racine + composants).

/** Exigence ou test d'un repo du workspace, candidat ou pair d'un lien. */
export interface WorkspaceObject {
  id: string
  title: string
  status: string
  objectTypeRef: string
  category: 'requirement' | 'test'
  /** Repo qui stocke l'objet. */
  repoPath: string
  /** Libellé du repo (label du nœud workspace, sinon nom de montage). */
  repoLabel: string
  /** Repo en lecture seule (épinglé, monté sous un nœud `readonly`) : l'objet ne peut pas être la
   *  source d'un nouveau lien (le lien serait écrit dans ce repo). */
  readonly: boolean
}

/** Lien lu dans le `links.yaml` d'un repo du workspace. */
export interface WorkspaceLink extends ObjectLink {
  /** Repo dont `links/links.yaml` contient le lien (repo de l'objet source). */
  storedIn: string
  /** Vrai si `storedIn` est en lecture seule (repo épinglé, nœud `readonly`) : pas de suppression. */
  readonly: boolean
}

/** Codes d'erreur des écritures de liens (création / suppression), préfixe du message d'erreur. */
export type LinkWriteErrorCode =
  | 'LINK_TYPE_NOT_FOUND'
  | 'SELF_LINK'
  | 'OBJECT_NOT_FOUND'
  | 'LINK_TYPE_INCOMPATIBLE'
  | 'DUPLICATE_LINK'
  | 'LINK_NOT_FOUND'
  | 'READONLY_REPO'

// objectTypeRef format : "componentName::objectTypeName"
export interface Requirement {
  id: string
  projectId: string
  branchId: string
  objectTypeRef: string
  title: string
  status: string
  version: number
  fields: Record<string, unknown>
  jiraLinks: JiraLink[]
  // T172 — un élément lié à celui-ci a quitté un statut d'approbation : impact à vérifier.
  // Persisté dans le YAML uniquement quand vrai (absent = false) ; posé par
  // RevalidationService, levé par l'analyse d'impact (T173). Indépendant du statut.
  needsRevalidation?: boolean
  // GH77 — historique des champs suivis (statut par défaut), posé par l'application seule.
  history?: ObjectHistory
  // Dérivés du git log du fichier (premier/dernier commit le touchant), pas persistés
  // dans le YAML — `null` tant que le fichier n'a jamais été commité.
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}
