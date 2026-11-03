import type { ObjectHistory } from './history'
import type { ImpactAnalysisStatus, ImpactNode } from './impact-analysis'
import type { ObjectTypeDefinition } from './schema'

// GH201 — objet version d'un composant (un repo) ou du produit (repo racine), specs/GH201.md.
// Fichier `versions/<ID>.yaml` du repo ; type de catégorie `version` déclaré sur le nœud `root`.

/** État d'un élément dans une version released : commit figé et `version` de l'élément. */
export interface VersionElementRef {
  sha: string
  version: number
}

/** Élément inclus dans une version ; `base` absente : jamais inclus dans une version released. */
export interface VersionChange {
  id: string
  base?: VersionElementRef
}

/** Posé au passage released : tag annoté et commit dont l'état des éléments est figé. */
export interface VersionFreeze {
  tag: string
  sha: string
  /** Instant du passage released : ordre des livraisons (plusieurs versions peuvent être en cours). */
  at: string
}

export interface ProductVersion {
  id: string
  projectId?: string
  branchId?: string
  objectTypeRef: string
  /** Label (ex. `1.2.4`). */
  title: string
  status: string
  version?: number
  /** Version précédente du même repo. */
  basedOn?: string
  /** Versions des dépendances (`polenta-repo.yaml`), par nom de montage. */
  components?: Record<string, string>
  changes?: VersionChange[]
  freeze?: VersionFreeze
  /** GH245 — statuts d'impact saisis (version en cours). */
  impacted?: VersionImpacted[]
  /** GH245 — analyse d'impact figée au passage released. */
  analysis?: VersionAnalysis
  fields: Record<string, unknown>
  history?: ObjectHistory
}

// ── GH245 — analyse d'impact et tests à exécuter d'une version ────────────────

export interface VersionImpacted {
  id: string
  status: ImpactAnalysisStatus
  comment?: string
}

export interface VersionImpactStep {
  id: string
  linkType: string
  parentIsTarget?: boolean
}

/** Chemin racine → élément ; la racine n'est pas répétée dans `path`. */
export interface VersionImpactSource {
  rootId: string
  path: VersionImpactStep[]
}

export interface VersionImpactRow {
  id: string
  elementType: 'requirement' | 'test_case' | null
  title: string | null
  status: ImpactAnalysisStatus
  comment?: string
  /** false : statut enregistré, élément plus atteint par l'analyse. */
  reached: boolean
  sources: VersionImpactSource[]
}

export interface VersionImpactRoot {
  elementId: string
  elementType: 'requirement' | 'test_case'
  title: string
  /** Composant (nom de montage) qui porte le changement. */
  component: string
  /** GH244 — issues incluses qui impactent cette exigence (racine par ses liens `issue-impact`). */
  viaIssues?: string[]
  descendantTree: ImpactNode[]
  ascendantTree: ImpactNode[]
}

export interface VersionAnalysis {
  computedAt: string
  frozen: boolean
  roots: VersionImpactRoot[]
  rows: VersionImpactRow[]
}

export interface VersionTestToRun {
  testId: string
  title: string
  /** Instances (exigences) retenues ; vide : le test lui-même. */
  requirementIds: string[]
  /** Éléments qui amènent le test. */
  sources: string[]
  /** Campagnes ouvertes du repo dont une entrée active vise déjà le test (information, aucun lien). */
  alreadyIn: Array<{ id: string; title: string }>
}

export interface VersionTestsToRun {
  tests: VersionTestToRun[]
  uncovered: string[]
}

/** Lu des marques du type : `isApproval` → released, `isTerminal` → abandoned, sinon en cours. */
export type VersionState = 'in_progress' | 'released' | 'abandoned'

export interface VersionSummary {
  id: string
  title: string
  status: string
  state: VersionState
  basedOn?: string
  freeze?: VersionFreeze
  /** Versions des dépendances retenues (nom de montage → ID). */
  components?: Record<string, string>
}

/** Nœud du sous-panneau « Produit » : un repo du workspace. */
export interface VersionComponentNode {
  name: string
  label: string
  repoPath: string
  readonly: boolean
  /** Type version du repo ; null : le repo n'a pas de versions. */
  versionType: { ref: string; label: string } | null
  /** Du plus récent au plus ancien. */
  versions: VersionSummary[]
  backlogCount: number
  children: VersionComponentNode[]
}

export interface VersionBacklogItem {
  id: string
  title: string
  category: 'requirement' | 'test' | 'issue'
  status: string
  objectTypeRef: string
  kind: 'new' | 'modified'
  base?: VersionElementRef
  /** GH200 §5 — approuvé modifié sans réouverture. */
  outside?: { approvedSha: string | null; dirty: boolean }
  filePath: string
}

export interface VersionChangeRow {
  component: string
  componentLabel: string
  repoPath: string
  versionId: string
  versionTitle: string
  /** null : élément introuvable (supprimé depuis). */
  category: 'requirement' | 'test' | 'issue' | null
  id: string
  title: string
  base?: VersionElementRef
  /** `freeze.sha` de la version qui porte la ligne ; null : état courant (disque). */
  toSha: string | null
  filePath: string | null
  /** Ligne de la version affichée (retirable tant qu'elle est en cours). */
  own: boolean
}

export interface VersionPageComponent {
  name: string
  label: string
  repoPath: string
  versionType: boolean
  selected: VersionSummary | null
  /** Versions non abandonnées de la dépendance. */
  options: VersionSummary[]
}

export interface VersionPage {
  version: ProductVersion
  state: VersionState
  component: { name: string; label: string; repoPath: string; readonly: boolean }
  typeDef: ObjectTypeDefinition
  basedOn: VersionSummary | null
  /** Versions du repo sélectionnables comme `basedOn` (released). */
  basedOnOptions: VersionSummary[]
  components: VersionPageComponent[]
  rows: VersionChangeRow[]
}

export interface CreateVersionDto {
  title: string
  basedOn?: string | null
  components?: Record<string, string>
  fields?: Record<string, unknown>
}

export interface UpdateVersionDto {
  title?: string
  basedOn?: string | null
  components?: Record<string, string>
  fields?: Record<string, unknown>
  status?: string
}

export type VersionErrorCode =
  | 'NO_VERSION_TYPE' | 'LABEL_TAKEN' | 'LABEL_EMPTY' | 'VERSION_LOCKED'
  | 'NOT_IN_PROGRESS' | 'RELEASE_REQUIRED' | 'TAG_INVALID' | 'TAG_EXISTS' | 'COMPONENT_NOT_RELEASED'
  | 'DIRTY_CHANGES' | 'READONLY_REPO' | 'VERSION_NOT_FOUND' | 'STATUS_UNKNOWN' | 'VERSION_ABANDONED'
  | 'NOT_OWN_ELEMENT'

export interface VersionProblem {
  code: VersionErrorCode
  detail: string
}

export interface VersionReleasePreview {
  suggestedTag: string
  problems: VersionProblem[]
}

export const VERSION_ERROR_CODES: readonly VersionErrorCode[] = [
  'NO_VERSION_TYPE', 'LABEL_TAKEN', 'LABEL_EMPTY', 'VERSION_LOCKED',
  'NOT_IN_PROGRESS', 'RELEASE_REQUIRED', 'TAG_INVALID', 'TAG_EXISTS', 'COMPONENT_NOT_RELEASED',
  'DIRTY_CHANGES', 'READONLY_REPO', 'VERSION_NOT_FOUND', 'STATUS_UNKNOWN', 'VERSION_ABANDONED', 'NOT_OWN_ELEMENT',
]

/** État d'une version selon les marques de son type. */
export function versionState(typeDef: Pick<ObjectTypeDefinition, 'statuses'> | null | undefined, status: string): VersionState {
  const def = typeDef?.statuses?.find(s => s.name === status)
  if (def?.isApproval) return 'released'
  if (def?.isTerminal) return 'abandoned'
  return 'in_progress'
}

/** Nom de tag git valide (règles de `git check-ref-format`, sous-ensemble utile). */
export function isValidTagName(tag: string): boolean {
  if (!tag || tag.startsWith('-') || tag.startsWith('/') || tag.endsWith('/') || tag.endsWith('.') || tag.endsWith('.lock')) return false
  if (tag.includes('..') || tag.includes('//') || tag.includes('@{') || tag === '@') return false
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x20\x7f~^:?*[\\]/.test(tag) && !tag.split('/').some(p => p.startsWith('.'))
}

/** Tag proposé au passage released : `<projet>-<label>`, caractères interdits remplacés par `-`. */
export function suggestVersionTag(repoName: string, label: string): string {
  return `${repoName}-${label}`.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-/.]+|[-/.]+$/g, '')
}
