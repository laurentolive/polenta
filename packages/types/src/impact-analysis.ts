export type ImpactAnalysisStatus =
  | 'impact_non_verifie'      // défaut à la création
  | 'pas_d_impact_reel'
  | 'impact_a_tester'
  | 'impact_teste'
  | 'modification_a_faire'
  | 'modification_faite'
  | 'modification_a_tester'
  | 'modification_verifiee'

export type RequirementChangeType = 'added' | 'removed' | 'modified'

export interface ChangedField {
  field: string           // 'status' | 'title' | `fields.${key}`
  from: unknown
  to: unknown
}

export interface RequirementDiffEntry {
  reqId: string
  changeType: RequirementChangeType
  changedFields: ChangedField[]  // vide si added/removed
  titleFrom: string | null
  titleTo: string | null
}

/**
 * Nœud d'un des deux arbres (montant ou descendant) d'une exigence changée. Les `test_case` sont
 * toujours des feuilles (children: []) ; seules les `requirement` peuvent avoir des enfants.
 */
export interface ImpactNode {
  elementId: string
  elementType: 'requirement' | 'test_case'
  title: string
  linkType: string              // type du ObjectLink qui relie ce nœud à son parent dans l'arbre
  status: ImpactAnalysisStatus
  comment: string | null
  updatedAt: string | null
  updatedBy: string | null
  children: ImpactNode[]
}

export interface ChangedRequirement {
  reqId: string
  title: string                  // titre côté B ; côté A si removed
  changeType: RequirementChangeType
  changedFields: ChangedField[]  // vide si added/removed
  descendantTree: ImpactNode[]   // enfants directs de reqId dans l'arbre descendant
  ascendantTree: ImpactNode[]    // idem, ascendant
}

export interface BaselineRefPointer {
  tag: string    // nom du tag de la baseline (BaselineRecord.tag)
  sha: string    // résolu à la création de l'analyse
}

export interface ImpactAnalysis {
  id: string
  label: string                  // ex. "v1.0 → v1.1", généré depuis les deux tags, éditable
  repoPath: string
  fromBaseline: BaselineRefPointer
  toBaseline: BaselineRefPointer
  createdAt: string
  createdBy: string
  changedRequirements: ChangedRequirement[]
}

/** Métadonnées seules, sans `changedRequirements` — utilisé par `listImpactAnalyses`. */
export type ImpactAnalysisSummary = Omit<ImpactAnalysis, 'changedRequirements'>

export interface CreateImpactAnalysisDto {
  fromBaselineTag: string
  toBaselineTag: string
  label?: string
}

export interface UpdateImpactItemStatusDto {
  reqId: string           // exigence changée sous laquelle se trouve le nœud
  direction: 'ascendant' | 'descendant'
  elementId: string
  status: ImpactAnalysisStatus
  comment?: string | null
}
