import type { ImpactAnalysisStatus, ImpactNode } from './impact-analysis'
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

/** GH200 — version d'un élément : commit (null : jamais commité) et `version` de l'élément. */
export interface ChangeElementRef {
  sha: string | null
  version: number
}

/** Élément à modifier : prévu (saisi), ou réellement modifié (GH200). */
export interface ChangeToModify {
  id: string
  state: 'planned' | 'modified'
  /** GH200 — état approuvé avant réouverture ; absent : création (ou planifié sans réouverture). */
  base?: ChangeElementRef
  /** GH200 — commit d'approbation, écrit au gel du changeset (statut terminal) seulement. */
  approved?: ChangeElementRef
}

/** GH200 — trace calculée d'une ligne de `toModify` (page, graphe, MCP). */
export interface ChangeToModifyTrace {
  id: string
  state: 'planned' | 'modified'
  base: ChangeElementRef | null
  /** Élément créé dans ce changeset (aucune version approuvée avant lui). */
  created: boolean
  approved: ChangeElementRef | null
  /** Pas (encore) approuvé, ou approbation pas encore publiée. */
  approvalPending: boolean
  /** Chemin du fichier de l'élément dans le repo (diff) ; null : introuvable. */
  filePath: string | null
}

/** GH200 — élément approuvé dont le contenu a changé sans réouverture (git direct, autre outil). */
export interface OutsideModification {
  id: string
  category: 'requirement' | 'test'
  /** Commit où l'élément est entré dans son statut approuvé (null : jamais commité). */
  approvedSha: string | null
  /** Différence pas encore commitée. */
  dirty: boolean
  filePath: string
}

/** GH207 — test à exécuter pour un changeset, et ce qui l'y amène. */
export interface ChangeTestToRun {
  testId: string
  /** Exigences sources (instances T179) ; vide : le test vient lui-même (toutes ses instances). */
  requirementIds: string[]
  /** Éléments du changeset (à modifier, impactés « à tester ») qui amènent ce test. */
  sources: string[]
}

/** GH207 — campagne liée à un changeset (section Campagnes). */
export interface LinkedCampaign {
  id: string
  title: string
  status: string
  /** Entrées PASS / total (avancement affiché). */
  passed: number
  total: number
  /** Entrées de la campagne portant un test à exécuter du changeset. */
  changesetTests: number
  /** Tests présents dans les entrées actives de la campagne. */
  testIds: string[]
  /** ID listé dans `campaigns` mais campagne introuvable. */
  missing: boolean
}

/** GH207 — tests à exécuter d'un changeset et campagnes liées. */
export interface ChangeTestsToRun {
  tests: ChangeTestToRun[]
  /** Exigences sources sans test qui les couvre. */
  uncovered: string[]
  linked: LinkedCampaign[]
  /** Tests à exécuter absents de toute campagne liée ouverte (`planned` / `in_progress`). */
  toAdd: string[]
}

/** GH200 — moment où un élément devient modifiable. */
export type ModificationKind = 'create' | 'reopen' | 'terminal'

/** GH200 — réponse au contrôle d'une création / réouverture. */
export interface ModificationCheck {
  /** Règle « tout passe par un changeset » active pour le repo de l'élément. */
  tracking: boolean
  /** Déjà dans `toModify` d'un changeset non clos (P4) : rien à demander. */
  assignedTo: string | null
  /** Changesets ouverts du repo de l'élément. */
  eligible: ChangeSummary[]
  /** Composant de l'élément (création d'un changeset depuis le dialogue). */
  component: string | null
  /** Repo de stockage de l'élément (et de ses changesets). */
  repoPath: string
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

/** GH199 — bornes d'un change « sur l'existant » (`ref` : tag de baseline ou SHA court). */
export interface ChangeRange {
  from: { ref: string; sha: string }
  to: { ref: string; sha: string }
}

/** GH199 — racine de l'analyse : élément de départ et ses deux arbres (SPEC-TRACEABILITY §4.6). */
export interface ChangeAnalysisRoot {
  elementId: string
  elementType: 'requirement' | 'test_case'
  title: string
  descendantTree: ImpactNode[]
  ascendantTree: ImpactNode[]
}

/** GH199 — ligne des éléments impactés (déclarée ou calculée), un statut par élément. */
export interface ChangeImpactRow {
  id: string
  /** null : élément introuvable dans le snapshot (supprimé). */
  elementType: 'requirement' | 'test_case' | null
  title: string | null
  status: ChangeImpactStatus
  comment?: string
  source: 'declared' | 'computed'
  /** Ligne calculée atteinte par l'analyse courante (false : « n'est plus atteint »). */
  reached: boolean
}

/** GH199 — analyse d'impact d'un change : calculée (live) ou instantané figé au statut terminal. */
export interface ChangeAnalysis {
  computedAt: string
  frozen: boolean
  snapshot: { kind: 'workdir' } | { kind: 'ref'; sha: string }
  roots: ChangeAnalysisRoot[]
  rows: ChangeImpactRow[]
  /** Campagnes non closes contenant un test racine ou atteint. */
  campaigns: { id: string; title: string; status: string; testIds: string[] }[]
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
  /** `request` : demande de changement ; `range` : sur l'existant (GH199). */
  mode: 'request' | 'range'
  /** GH199 — bornes d'un change `range`. */
  range?: ChangeRange
  toModify: ChangeToModify[]
  impacted: ChangeImpacted[]
  origin: ChangeOrigin
  /** Version de composant qui livre le change (L5). */
  integratedIn: string | null
  /** Campagnes créées / alimentées par le change (L6). */
  campaigns: string[]
  /** GH199 — analyse figée au passage dans un statut terminal (absente sinon). */
  analysis?: ChangeAnalysis
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
  /** GH199 — éléments listés (à modifier et impactés), pour « Analyser l'impact » d'un élément. */
  elementIds: string[]
  /** GH199 §8bis — statut non terminal : le change peut recevoir des éléments. */
  open: boolean
  /** GH199 §8bis — éléments assignés (`toModify`). */
  toModifyIds: string[]
}

/** GH199 §8bis — élément à traiter non assigné à un change ouvert. */
export interface BacklogItem {
  id: string
  title: string
  category: 'requirement' | 'test'
  status: string
  objectTypeRef: string
  needsRevalidation: boolean
  /** GH200 — approuvé mais modifié hors interface (voir `OutsideModification`). */
  outside?: { approvedSha: string | null; dirty: boolean; filePath: string }
}

/** GH199 §8bis — backlog d'un composant local (calculé, non stocké). */
export interface ComponentBacklog {
  repoPath: string
  component: string
  label: string
  items: BacklogItem[]
}

/** GH199 §8bis — réponse au contrôle d'approbation d'un élément. */
export interface ApprovalCheck {
  /** Passage vers un statut `isApproval` d'un élément assigné à aucun change ouvert. */
  needsAssignment: boolean
  /** Composant de l'élément (création d'un change depuis le dialogue). */
  component: string | null
  /** Changes ouverts du repo de l'élément. */
  openChanges: ChangeSummary[]
}

/** GH199 §8bis — élément « à traiter » : statut ni `isApproval` ni `isTerminal` (inconnu : à traiter). */
export function isToProcess(statuses: SchemaStatus[] | undefined, status: string): boolean {
  const s = statuses?.find(x => x.name === status)
  return !s?.isApproval && !s?.isTerminal
}

export interface CreateChangeDto {
  /** GH199 — `range` : sur l'existant, avec `range` (tag de baseline ou SHA de chaque borne). */
  mode?: 'request' | 'range'
  range?: { from: string; to: string }
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

/** GH199 — statuts d'impact « clos » pour la complétude (SPEC-TRACEABILITY §4.6). */
export const CLOSED_IMPACT_STATUSES: readonly ChangeImpactStatus[] = ['pas_d_impact_reel', 'impact_teste', 'modification_verifiee']

/**
 * GH199 — lignes à écrire dans le change (Q2) : déclarées, et calculées portant une saisie
 * (statut autre que `impact_non_verifie` ou commentaire). Les autres sont recalculées.
 */
export function pruneImpacted(items: ChangeImpacted[]): ChangeImpacted[] {
  return items.filter(i => i.source === 'declared' || i.status !== 'impact_non_verifie' || !!i.comment?.trim())
}
