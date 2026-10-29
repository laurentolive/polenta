import type { ImpactAnalysisStatus } from './impact-analysis'
import type { ObjectHistory } from './history'
import type { SchemaStatus } from './schema'

// GH198 — objet change (specs/GH198.md, épique #193) : modification pilotée d'un composant, avec ses
// éléments à modifier et ses éléments impactés. Ce lot pose l'objet et ses listes manuelles ;
// l'analyse d'impact calculée (L3), le rattachement des commits (L4), les versions (L5) et les
// campagnes (L6) s'appuient sur ce format.

/** Statut d'impact d'un élément : les 8 valeurs de l'analyse entre baselines (SPEC-TRACEABILITY §4.6). */
export type ChangeImpactStatus = ImpactAnalysisStatus

export const CHANGE_IMPACT_STATUSES: readonly ChangeImpactStatus[] = [
  'impact_non_verifie', 'pas_d_impact_reel', 'impact_a_tester', 'impact_teste',
  'modification_a_faire', 'modification_faite', 'modification_a_tester', 'modification_verifiee',
]

/** Élément à modifier : prévu (saisi), ou réellement modifié et rattaché (L4). */
export interface ChangeToModify {
  id: string
  state: 'planned' | 'modified'
}

/** Élément impacté : déclaré par l'utilisateur, ou calculé par l'analyse (L3). */
export interface ChangeImpacted {
  id: string
  status: ChangeImpactStatus
  comment?: string
  source: 'declared' | 'computed'
}

export interface ChangeOrigin {
  runs: string[]
  decisions: { conformityId: string; objectId: string }[]
}

export interface Change {
  id: string
  projectId: string
  branchId: string
  objectTypeRef: string
  title: string
  status: string
  version: number
  fields: Record<string, unknown>
  /** Nœud du schéma que le change fait évoluer (repo de stockage). */
  component: string
  /** `request` : demande de changement ; `range` : sur l'existant (L3). */
  mode: 'request' | 'range'
  toModify: ChangeToModify[]
  impacted: ChangeImpacted[]
  origin: ChangeOrigin
  /** Version de composant qui livre le change (L5). */
  integratedIn: string | null
  /** Campagnes créées / alimentées par le change (L6). */
  campaigns: string[]
  history?: ObjectHistory
  /** Audit dérivé de git (non stocké). */
  createdAt?: string | null
  createdBy?: string | null
  updatedAt?: string | null
  updatedBy?: string | null
}

/** Ligne du panneau Changements (liste workspace). */
export interface ChangeSummary {
  id: string
  repoPath: string
  objectTypeRef: string
  title: string
  status: string
  component: string
  toModifyCount: number
  impactedCount: number
  /** Auteur du premier statut (historique GH77), pour le filtre « mes changes ». */
  createdBy: string | null
}

export interface CreateChangeDto {
  objectTypeRef: string
  title: string
  component?: string
  fields?: Record<string, unknown>
  toModify?: ChangeToModify[]
  impacted?: ChangeImpacted[]
}

export interface UpdateChangeDto {
  title?: string
  status?: string
  fields?: Record<string, unknown>
  component?: string
  toModify?: ChangeToModify[]
  impacted?: ChangeImpacted[]
}

/** Cycle de vie par défaut d'un type `change` (modifiable dans le modèle de données). */
export const DEFAULT_CHANGE_STATUSES: SchemaStatus[] = [
  { name: 'ouvert', label: 'Ouvert', color: '#475569' },
  { name: 'analyse', label: 'Analysé', color: '#0369a1' },
  { name: 'implemente', label: 'Implémenté', color: '#b45309' },
  { name: 'verifie', label: 'Vérifié', color: '#16a34a' },
  { name: 'clos', label: 'Clos', color: '#15803d', isTerminal: true },
  { name: 'rejete', label: 'Rejeté', color: '#dc2626', isTerminal: true },
]

/** Liste dédoublonnée par `id` (premier gardé). */
export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true)))
}
