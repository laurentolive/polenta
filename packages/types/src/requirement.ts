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
  // Dérivés du git log du fichier (premier/dernier commit le touchant), pas persistés
  // dans le YAML — `null` tant que le fichier n'a jamais été commité.
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}
