import type {
  ClearRevalidationResult,
  FlaggedElement,
  Parameter,
  ParamResolutionPreview,
  ReqInstanceSelection,
  ParameterDeleteResult,
  ParameterUsage,
  ParameterWriteResult,
  RepoParameters,
  ProjectRecent,
  ProjectInfo,
  Requirement,
  ObjectLink,
  TestCase,
  TestRun,
  TraceabilityMatrix,
  ImpactReport,
  ImpactAcknowledgement,
  TestPlanDraft,
  MatrixExportRow,
  RevalidationItem,
  Review,
  ReviewStatus,
  ProjectSchema,
  TestCampaign,
  TestRunStatus,
  CreateCampaignDto,
  UpdateCampaignDto,
  TypeTree,
  PolentaRepoManifest,
  WorkspaceOpenResult,
  WorkspaceTree,
  MountOverride,
  ComplianceMatrix,
  CoverageResult,
  // ComplianceCellStatus is exported from @polenta/types but not needed directly in ApiClient
  QueryDefinition,
  QueryResult,
  BuilderConfig,
  QueryMode,
  QueryScope,
  SavedQuery,
  QueryHistoryEntry,
  Dashboard,
  WidgetType,
  WidgetSize,
  WidgetFieldMapping,
  ImpactAnalysis,
  ImpactAnalysisSummary,
  LocalImpactAnalysis,
  RequirementDiffEntry,
  CreateImpactAnalysisDto,
  UpdateImpactItemStatusDto,
  ExportKind,
  ExportFormat,
  ExportTemplateListResult,
  TemplateExportFormat,
  ExportResult,
  AppSettings,
  UpdateState,
} from '@polenta/types'
import type {
  CreateRequirementDto,
  UpdateRequirementDto,
  TransitionRequirementDto,
  CreateTestCaseDto,
  UpdateTestCaseDto,
  ExecuteTestCaseDto,
  MatrixFiltersDto,
  AcknowledgeImpactDto,
  GenerateTestPlanDto,
} from '@polenta/zod-schemas'

/** T135 sprint 3 — drag & drop d'un élément vers un autre nœud du même repo. */
export interface MoveElementDto {
  fromNodeName: string
  toNodeName: string
  typeName: string
}

export interface MoveElementResult {
  schema: ProjectSchema
  /** Requirements/tests whose `objectTypeRef` cascade rewrite failed (best-effort, cf.
   *  `ElementMoveService`) — empty when every matching requirement/test was updated. */
  failed: { kind: 'requirement' | 'test'; id: string; error: string }[]
}

export interface CreateReviewDto {
  actionId?: string
  title: string
  description?: string
  reviewers: string[]
  dueDate?: string
  quorum?: number | null
  objects: Array<{
    objectId: string
    objectType: 'requirement' | 'test_case'
    objectVersion: number
  }>
}

export interface RequirementFilters {
  type?: string
  status?: string
  parentId?: string
  tags?: string[]
  search?: string
}

export interface CreateSavedQueryDto {
  title: string
  mode: QueryMode
  builderConfig?: BuilderConfig
  sqlText?: string
  scope: QueryScope
  createdBy: string
}

export interface UpdateSavedQueryDto {
  title?: string
  builderConfig?: BuilderConfig
  sqlText?: string
}

export type AddHistoryEntryDto = Omit<QueryHistoryEntry, 'id' | 'executedAt'>

export interface CreateDashboardDto {
  title: string
  scope: QueryScope
  createdBy: string
}

export interface UpdateDashboardDto {
  title?: string
  widgetOrder?: string[]
}

export interface AddWidgetDto {
  title: string
  queryId: string
  type: WidgetType
  fieldMapping: WidgetFieldMapping
  size: WidgetSize
}

export type UpdateWidgetDto = Partial<AddWidgetDto>

export interface MissingLinksResult {
  uncoveredRequirements: Requirement[]
  orphanTests: TestCase[]
  revalidationItems: RevalidationItem[]
}

export interface SyncFileStatus {
  path: string
  marker: 'M' | 'A' | 'D'
}

export interface SyncStatus {
  branch: string
  staged: SyncFileStatus[]
  unstaged: SyncFileStatus[]
  ahead: number
  behind: number
}

export interface BranchInfo {
  name: string
  isCurrent: boolean
  type: 'int' | 'dev' | 'other'
}

export interface BaselineComponentRecord {
  name: string
  tag: string
}

export interface BaselineRecord {
  tag: string
  createdAt: string
  message: string
  components: BaselineComponentRecord[]
}

export interface BaselineComponentRef {
  name: string
  repoPath: string
}

export interface CreateBaselineComponentDto {
  name: string
  tag: string
  createTag: boolean
}

export interface CreateBaselineDto {
  tag: string
  message?: string
  components: CreateBaselineComponentDto[]
}

export interface GitRef {
  name: string
  sha: string
  type: 'branch' | 'remote-branch' | 'tag' | 'commit'
  short?: string
  message?: string
}

export interface GraphCommit {
  sha: string
  short: string
  message: string
  author: string
  date: string
  refs: string[]
  isCurrent: boolean
  parents: string[]
}

export interface CommitEntry {
  sha: string
  message: string
  author: string
  date: string
}

export interface DrawioPage {
  id: string
  name: string
  /** mxGraphModel XML décompressé, prêt à parser côté renderer (DOMParser). */
  xml: string
}

// MergeResult mirrors the wire shape serialized by SyncService.merge() over IPC.
// Success branch: { success: true, sha: string }
// Conflict branch: { success: false, conflicts: YamlConflict[] } — but only filePath
// is surfaced here; the renderer has no use for the full YAML diff objects.
export type MergeResult =
  | { success: true; sha: string }
  | { success: false; conflicts: string[] }

// T154 — SyncService.ensureIntegrationUpToDate()'s outcome.
export type IntegrationSyncResult = 'up-to-date' | 'fast-forwarded' | 'diverged' | 'no-remote-branch'

export interface DeviceFlowSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type DeviceFlowPollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'success'; identity: { login: string; name: string; email: string } }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }

/** Préférences de visibilité de la Vue Système, par (type d'élément, utilisateur), dans `.{user}.pref`. */
export interface FieldVisibilityPref {
  excel: string[]
  word: string[]
  edit: string[]
  /** T162 — titres de dossiers affichés dans la vue Tableau. Absent ⇒ true (affichés). */
  showFoldersExcel?: boolean
  /** T162 — titres de dossiers affichés dans la vue Document. Absent ⇒ true (affichés). */
  showFoldersWord?: boolean
  /** GH24 — ids des dossiers repliés dans la vue Tableau. Absent ⇒ aucun. */
  collapsedFoldersExcel?: string[]
  /** GH24 — ids des dossiers repliés dans la vue Document. Absent ⇒ aucun. */
  collapsedFoldersWord?: string[]
  /** GH24 — nombre de colonnes figées (depuis la gauche) de la vue Tableau. Absent ⇒ 0. */
  freezeColCountExcel?: number
}

export interface ApiClient {
  app: {
    setTitle(title: string): Promise<void>
    getVersion(): Promise<string>
    /** GH26 — préférences de l'application (userData), pas du projet. */
    getSettings(): Promise<AppSettings>
    setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
    /** GH26 — ouvre une page de release GitHub dans le navigateur système. */
    openReleasePage(url: string): Promise<void>
  }
  /** GH26 — mise à jour automatique ; les changements d'état arrivent par l'événement
   *  'update:state-changed' (window.polenta.on). */
  update: {
    getState(): Promise<UpdateState>
    install(): Promise<void>
  }
  schema: {
    get(repoPath: string): Promise<ProjectSchema>
    save(repoPath: string, schema: ProjectSchema): Promise<void>
    moveElement(repoPath: string, dto: MoveElementDto): Promise<MoveElementResult>
    /** Drops the main-process in-memory cache for `repoPath` so the next `get()` re-reads schema.yaml from disk. */
    invalidate(repoPath: string): Promise<void>
  }
  tree: {
    get(repoPath: string, nodeId: string, typeId: string): Promise<TypeTree>
    save(repoPath: string, tree: TypeTree): Promise<void>
    generateId(): Promise<string>
  }
  workspace: {
    listRecents(): Promise<ProjectRecent[]>
    markRecent(workspaceDir: string): Promise<void>
    getLastOpened(): Promise<ProjectRecent | null>
    clearLastOpened(): Promise<void>
    resolve(workspaceDir: string): Promise<ProjectInfo>
    openProject(dir: string): Promise<WorkspaceOpenResult>
    createNew(containerDir: string, name: string): Promise<WorkspaceOpenResult>
    createFromClone(containerDir: string, remoteUrl: string): Promise<WorkspaceOpenResult>
    // GH27 — true if the folder is missing or has no entries
    isEmptyDir(dir: string): Promise<boolean>
    // T69: flat workspace
    detect(dir: string): Promise<'workspace' | 'repo' | 'unknown'>
    init(workspaceDir: string, rootRepoPath: string): Promise<void>
    open(workspaceDir: string): Promise<WorkspaceOpenResult>
    // T69 Sprint 2
    getTree(workspaceDir: string): Promise<WorkspaceTree | null>
    rebuildTree(workspaceDir: string): Promise<WorkspaceOpenResult>
    setMountOverride(workspaceDir: string, override: MountOverride): Promise<void>
    // T74
    removeRepoDir(repoPath: string): Promise<void>
    // T74 sprint 2
    renameRepoDir(workspaceDir: string, oldMountName: string, newMountName: string): Promise<void>
  }
  polentaRepo: {
    get(repoPath: string): Promise<PolentaRepoManifest | null>
    save(repoPath: string, manifest: PolentaRepoManifest): Promise<void>
  }
  auth: {
    saveToken(remote: string, token: string): Promise<void>
    getToken(remote: string): Promise<string | null>
    deleteToken(remote: string): Promise<void>
    resolveIdentity(remote: string): Promise<{ login: string; name: string; email: string }>
    /** GH29 — login owning `.{username}.pref` for this repo (`local` if no account connected). */
    projectUsername(repoPath: string): Promise<string>
    hasAnyAccount(): Promise<boolean>
    setup(remote: string, pat: string): Promise<{ login: string; name: string; email: string }>
    startDeviceFlow(remote: string): Promise<DeviceFlowSession>
    pollDeviceFlow(remote: string, deviceCode: string): Promise<DeviceFlowPollResult>
  }
  dialog: {
    pickFolder(title?: string): Promise<string | null>
    pickImageFile(): Promise<{ mimeType: string; base64: string } | null>
  }
  drawio: {
    /**
     * Sélection d'un fichier .drawio via dialogue natif. `status: 'ok'` donne un
     * chemin RELATIF à repoPath. Si le fichier choisi est hors du repo, il est
     * copié dans `diagrams/` (nom dédupliqué si collision) — `copied: true`.
     */
    pickFile(repoPath: string): Promise<
      | { status: 'ok'; path: string; copied: boolean }
      | { status: 'canceled' }
      | { status: 'error'; message: string }
    >
    /** Pages décompressées (XML mxGraphModel prêt à parser), ou null si le fichier n'existe pas / n'est pas un .drawio valide. */
    read(repoPath: string, relativePath: string): Promise<DrawioPage[] | null>
    /** Ouvre le fichier dans l'application associée du poste (best effort, aucune erreur si absente). */
    openExternal(repoPath: string, relativePath: string): Promise<void>
  }
  image: {
    /**
     * Sélection d'un fichier image via dialogue natif. `status: 'ok'` donne un
     * chemin RELATIF à repoPath. Si le fichier choisi est hors du repo, il est
     * copié dans `images/` (nom dédupliqué si collision) — `copied: true`.
     * Mirroir de `drawio.pickFile` (T76).
     */
    pickFile(repoPath: string): Promise<
      | { status: 'ok'; path: string; copied: boolean }
      | { status: 'canceled' }
      | { status: 'error'; message: string }
    >
    /** Octets du fichier référencé (base64), ou null si introuvable. Jamais stocké — sert uniquement à construire un data URI de rendu en mémoire. */
    read(repoPath: string, relativePath: string): Promise<{ mimeType: string; base64: string } | null>
    /** Écrit les octets d'une image collée (presse-papiers, pas de fichier source) dans `images/` sous un nom généré, dédupliqué si collision. */
    writePaste(repoPath: string, mimeType: string, base64: string): Promise<
      | { status: 'ok'; path: string }
      | { status: 'error'; message: string }
    >
  }
  sync: {
    status(repoPath: string): Promise<SyncStatus>
    commit(repoPath: string, message: string): Promise<{ sha: string }>
    push(repoPath: string): Promise<void>
    pull(repoPath: string): Promise<void>
    fetch(repoPath: string, urlFallback: string, remote?: string): Promise<void>
    fastForwardBranch(repoPath: string, branchName: string, remote?: string): Promise<IntegrationSyncResult>
    pullFastForwardOnly(repoPath: string): Promise<void>
    log(repoPath: string, limit?: number): Promise<CommitEntry[]>
    checkoutCommit(repoPath: string, sha: string): Promise<void>
    stage(repoPath: string, filepath: string): Promise<void>
    stageAll(repoPath: string): Promise<void>
    unstage(repoPath: string, filepath: string): Promise<void>
    unstageAll(repoPath: string): Promise<void>
    discard(repoPath: string, filepath: string): Promise<void>
    discardAll(repoPath: string): Promise<void>
    graph(repoPath: string, limit?: number): Promise<GraphCommit[]>
    diff(repoPath: string, filepath: string): Promise<{ oldContent: string; newContent: string }>
    commitFiles(repoPath: string, sha: string): Promise<SyncFileStatus[]>
    commitDiff(repoPath: string, sha: string, filepath: string): Promise<{ oldContent: string; newContent: string }>
    branches(repoPath: string): Promise<BranchInfo[]>
    createBranch(repoPath: string, name: string): Promise<void>
    checkoutBranch(repoPath: string, name: string): Promise<void>
    deleteBranch(repoPath: string, name: string): Promise<void>
    tags(repoPath: string): Promise<string[]>
    createTag(repoPath: string, tagName: string, commitSha?: string): Promise<void>
    merge(repoPath: string, fromBranch: string): Promise<MergeResult>
    mergeInto(repoPath: string, fromBranch: string, intoBranch: string): Promise<MergeResult>
    createBranchAt(repoPath: string, name: string, sha: string): Promise<void>
    deleteRemoteBranch(repoPath: string, name: string, remote?: string): Promise<void>
    deleteTag(repoPath: string, tagName: string): Promise<void>
    pushBranch(repoPath: string, branchName: string, remote?: string): Promise<void>
    rebase(repoPath: string, onto: string): Promise<void>
    diffBetween(repoPath: string, sha1: string, sha2: string): Promise<SyncFileStatus[]>
    diffFileBetween(repoPath: string, sha1: string, sha2: string, filepath: string): Promise<{ oldContent: string; newContent: string }>
    resolveRefs(repoPath: string): Promise<GitRef[]>
  }
  /** Opérations git bas niveau ne relevant pas du domaine `sync` (T43). */
  git: {
    /** SHA complet du commit HEAD courant — utilisé pour le nom de fichier par défaut des exports. */
    headSha(repoPath: string): Promise<string>
  }
  baseline: {
    /** components: repos whose tags must also match for a main-repo tag to count as a baseline (cross-repo check, T92) */
    list(repoPath: string, components?: BaselineComponentRef[]): Promise<BaselineRecord[]>
    get(repoPath: string, tag: string, components?: BaselineComponentRef[]): Promise<BaselineRecord | null>
    /** workspaceDir: optional flat-workspace directory — tags all component repos in the workspace tree (T69 Sprint 3) */
    create(repoPath: string, dto: CreateBaselineDto, workspaceDir?: string): Promise<BaselineRecord>
    /** Configured integration branch for this repo (`config/project.yaml`), `'main'` if absent/unreadable. */
    getIntegrationBranch(repoPath: string): Promise<string>
    /** Persists the configured integration branch — merges into existing `config/project.yaml`. */
    setIntegrationBranch(repoPath: string, branch: string): Promise<void>
    /** Deletes the tag on the main repo and on every listed component repo. */
    delete(repoPath: string, tag: string, components?: BaselineComponentRef[]): Promise<void>
  }
  requirements: {
    list(repoPath: string, filters?: RequirementFilters): Promise<Requirement[]>
    get(repoPath: string, id: string): Promise<Requirement>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    create(repoPath: string, dto: CreateRequirementDto, workspaceDir?: string): Promise<Requirement>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    update(repoPath: string, id: string, dto: UpdateRequirementDto, workspaceDir?: string): Promise<Requirement>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    openDraft(repoPath: string, id: string, comment: string, workspaceDir?: string): Promise<Requirement>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    transition(repoPath: string, id: string, dto: TransitionRequirementDto, workspaceDir?: string): Promise<Requirement>
    // TODO: remove versioning API
    links(repoPath: string, id: string): Promise<ObjectLink[]>
    linksAll(repoPath: string): Promise<ObjectLink[]>
    linkCreate(repoPath: string, data: { type: string; sourceId: string; targetId: string }): Promise<ObjectLink>
    linkDelete(repoPath: string, linkId: string): Promise<void>
  }
  tests: {
    list(repoPath: string): Promise<TestCase[]>
    get(repoPath: string, id: string): Promise<TestCase>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    create(repoPath: string, dto: CreateTestCaseDto, workspaceDir?: string): Promise<TestCase>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    update(repoPath: string, id: string, dto: UpdateTestCaseDto, workspaceDir?: string): Promise<TestCase>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    execute(repoPath: string, tcId: string, dto: ExecuteTestCaseDto, workspaceDir?: string): Promise<TestRun>
    runs(repoPath: string, tcId: string): Promise<TestRun[]>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    openDraft(repoPath: string, id: string, targetStatus: string, workspaceDir?: string): Promise<TestCase>
  }
  traceability: {
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    matrix(repoPath: string, filters?: MatrixFiltersDto, workspaceDir?: string): Promise<TraceabilityMatrix>
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    missingLinks(repoPath: string, workspaceDir?: string): Promise<MissingLinksResult>
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    impact(repoPath: string, reqId: string, depth?: number, workspaceDir?: string): Promise<ImpactReport>
    acknowledge(repoPath: string, reqId: string, dto: AcknowledgeImpactDto): Promise<ImpactAcknowledgement>
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    testPlan(repoPath: string, dto: GenerateTestPlanDto, workspaceDir?: string): Promise<TestPlanDraft>
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    exportCsv(repoPath: string, filters?: MatrixFiltersDto, workspaceDir?: string): Promise<MatrixExportRow[]>
    /** Diff exigence-par-exigence entre deux shas (T46) — indépendant de l'index vivant. */
    diffRequirements(repoPath: string, fromSha: string, toSha: string): Promise<RequirementDiffEntry[]>
  }
  revalidation: {
    /** T173 — éléments marqués `needsRevalidation` du workspace, avec leurs éléments liés. */
    list(repoPath: string, workspaceDir?: string): Promise<FlaggedElement[]>
    /** T173 — lève le flag (retire la clé du YAML) ; best-effort par élément, pas de commit. */
    clear(repoPath: string, ids: string[], workspaceDir?: string): Promise<ClearRevalidationResult>
  }
  impactAnalysis: {
    /** Crée et persiste une analyse d'impact entre deux baselines (T46) — figée à la création. */
    create(repoPath: string, dto: CreateImpactAnalysisDto): Promise<ImpactAnalysis>
    list(repoPath: string): Promise<ImpactAnalysisSummary[]>
    /** T175 — analyse live des modifications locales vs HEAD (racine + composants), jamais persistée. */
    local(repoPath: string, workspaceDir?: string): Promise<LocalImpactAnalysis>
    get(repoPath: string, id: string): Promise<ImpactAnalysis>
    updateStatus(repoPath: string, id: string, dto: UpdateImpactItemStatusDto): Promise<ImpactAnalysis>
    delete(repoPath: string, id: string): Promise<void>
  }
  reviews: {
    list(repoPath: string, status?: ReviewStatus): Promise<Review[]>
    get(repoPath: string, id: string): Promise<Review | null>
    create(repoPath: string, dto: CreateReviewDto): Promise<Review>
    approveObject(repoPath: string, reviewId: string, objectId: string, reviewerId: string): Promise<Review>
    revokeApproval(repoPath: string, reviewId: string, objectId: string, reviewerId: string): Promise<Review>
    close(repoPath: string, reviewId: string, status: 'approved' | 'closed'): Promise<Review>
  }
  campaigns: {
    list(repoPath: string, component?: string, level?: string): Promise<TestCampaign[]>
    get(repoPath: string, id: string): Promise<TestCampaign>
    create(repoPath: string, dto: CreateCampaignDto, workspaceDir?: string): Promise<TestCampaign>
    update(repoPath: string, id: string, dto: UpdateCampaignDto): Promise<TestCampaign>
    updateRun(repoPath: string, campaignId: string, entryId: string, status: TestRunStatus, runId?: string): Promise<TestCampaign>
    close(repoPath: string, id: string, status: 'completed' | 'abandoned'): Promise<TestCampaign>
    /** T179 — `reqInstances` : exigences retenues (et saisies par instance) des tests itérants. */
    addTests(repoPath: string, campaignId: string, testCaseIds: string[], paramValuesByTest?: Record<string, Record<string, string>>, workspaceDir?: string, reqInstances?: ReqInstanceSelection): Promise<TestCampaign>
    removeEntries(repoPath: string, campaignId: string, entryIds: string[]): Promise<TestCampaign>
    /** T179 — `requirementId` : duplicata d'une instance générée pour cette exigence. */
    duplicateTest(repoPath: string, campaignId: string, testCaseId: string, paramValues: Record<string, string>, workspaceDir?: string, requirementId?: string): Promise<TestCampaign>
    /** T171 — résolution prévisionnelle des paramètres de tests à ajouter (sans écriture). */
    previewParams(repoPath: string, source: { campaignId?: string; baselineRef?: string }, testCaseIds: string[], workspaceDir?: string): Promise<ParamResolutionPreview[]>
    updateRunParams(repoPath: string, campaignId: string, entryId: string, paramValues: Record<string, string>): Promise<TestCampaign>
    delete(repoPath: string, id: string): Promise<void>
  }
  pref: {
    getFieldVisibility(repoPath: string, username: string, typeKey: string): Promise<FieldVisibilityPref | null>
    setFieldVisibility(repoPath: string, username: string, typeKey: string, views: FieldVisibilityPref): Promise<void>
  }
  /** Moteur de requêtes AlaSQL + requêtes sauvegardées / historique (T77 sprint 1) */
  queries: {
    /** workspaceDir: composants submodules agrégés dans le dataset interrogé (T77) */
    execute(repoPath: string, queryDef: QueryDefinition, workspaceDir?: string): Promise<QueryResult>
    /** Traduit un BuilderConfig en SQL équivalent (pré-remplissage de l'éditeur SQL avancé). */
    builderToSql(repoPath: string, config: BuilderConfig, workspaceDir?: string): Promise<string>
    list(repoPath: string, username: string): Promise<SavedQuery[]>
    create(repoPath: string, username: string, dto: CreateSavedQueryDto): Promise<SavedQuery>
    update(repoPath: string, username: string, id: string, dto: UpdateSavedQueryDto): Promise<SavedQuery>
    delete(repoPath: string, username: string, id: string): Promise<void>
    /** Toujours privé. Purge automatiquement les entrées devenues invalides au chargement. */
    historyList(repoPath: string, username: string): Promise<QueryHistoryEntry[]>
    historyAdd(repoPath: string, username: string, entry: AddHistoryEntryDto): Promise<QueryHistoryEntry>
    historyDelete(repoPath: string, username: string, id: string): Promise<void>
    /** Ordre d'affichage de la section "Requêtes" du panneau latéral (préférence perso). */
    getOrder(repoPath: string, username: string): Promise<string[]>
    setOrder(repoPath: string, username: string, order: string[]): Promise<void>
    /**
     * Change la portée d'une requête (privé ↔ partagé). La rétrogradation est refusée
     * (message listant les dépendants) si un widget référence encore cette requête.
     * Change l'`id` de la requête (schéma d'ID différent privé/partagé) — le retour
     * porte le nouvel id, à utiliser pour toute navigation/rafraîchissement ultérieur.
     */
    setScope(repoPath: string, username: string, id: string, scope: QueryScope): Promise<SavedQuery>
  }
  /** Dashboards personnalisables + widgets embarqués (T77 sprint 2) */
  dashboards: {
    list(repoPath: string, username: string): Promise<Dashboard[]>
    get(repoPath: string, username: string, id: string): Promise<Dashboard | null>
    create(repoPath: string, username: string, dto: CreateDashboardDto): Promise<Dashboard>
    update(repoPath: string, username: string, id: string, dto: UpdateDashboardDto): Promise<Dashboard>
    delete(repoPath: string, username: string, id: string): Promise<void>
    /**
     * Change la portée d'un dashboard (privé ↔ partagé). Le passage en partagé est
     * refusé (message listant les widgets fautifs) si un seul widget référence une
     * requête privée. Change l'`id` du dashboard — le retour porte le nouvel id.
     */
    setScope(repoPath: string, username: string, id: string, scope: QueryScope): Promise<Dashboard>
    addWidget(repoPath: string, username: string, dashboardId: string, dto: AddWidgetDto): Promise<Dashboard>
    updateWidget(repoPath: string, username: string, dashboardId: string, widgetId: string, dto: UpdateWidgetDto): Promise<Dashboard>
    deleteWidget(repoPath: string, username: string, dashboardId: string, widgetId: string): Promise<Dashboard>
    setWidgetOrder(repoPath: string, username: string, dashboardId: string, order: string[]): Promise<Dashboard>
    /** Ordre d'affichage de la section "Dashboards" du panneau latéral (préférence perso). */
    getOrder(repoPath: string, username: string): Promise<string[]>
    setOrder(repoPath: string, username: string, order: string[]): Promise<void>
  }
  /** Base de paramètres (T171) — `repoPath` = repo qui porte la base. */
  parameters: {
    list(repoPath: string, workspaceDir?: string): Promise<RepoParameters[]>
    usages(repoPath: string, name: string, workspaceDir?: string): Promise<ParameterUsage[]>
    create(repoPath: string, param: Parameter, workspaceDir?: string): Promise<ParameterWriteResult>
    update(repoPath: string, name: string, patch: Omit<Parameter, 'name'>, workspaceDir?: string): Promise<ParameterWriteResult>
    delete(repoPath: string, name: string, workspaceDir?: string): Promise<ParameterDeleteResult>
  }
  /** Interface compliance (T69 Sprint 4) */
  interface: {
    /** Compute the compliance matrix for all interface repos in the workspace. */
    complianceMatrix(workspaceDir: string): Promise<ComplianceMatrix[]>
    /** Check component coverage for a specific component × interface pair. */
    coverage(componentRepoPath: string, interfaceRepoPath: string, roles: string[]): Promise<CoverageResult>
  }
  /** Export cahiers/rapports/dashboard en Word/Excel/PDF (T43) — un seul canal générique plutôt
   *  qu'un handler ad hoc par type de contenu, cf. specs/T43-design.md. */
  export: {
    /**
     * Ouvre un dialogue natif "Enregistrer sous" puis écrit le fichier exporté.
     * `payload` (xlsx/docx) : données déjà chargées/filtrées côté vue, ignoré si `format === 'pdf'`.
     * `printParams` (pdf uniquement) : paramètres transmis à la route imprimable `/print/<kind>`,
     * qui recharge elle-même ses données — ignoré pour xlsx/docx.
     */
    save(
      repoPath: string,
      kind: ExportKind,
      format: ExportFormat,
      payload: unknown,
      printParams: Record<string, string> | undefined,
      suggestedName: string,
      /** GH34 — gabarit client (chemin relatif à la bibliothèque) ; absent = rendu Standard. */
      templateRelPath?: string,
    ): Promise<ExportResult>
    /** GH34 — gabarits de la bibliothèque (préférence application) pour un format. */
    listTemplates(format: TemplateExportFormat): Promise<ExportTemplateListResult>
    /** GH34 — copie les gabarits d'exemple livrés avec l'application dans la bibliothèque
     *  (sous-dossier dédié, fichiers existants jamais écrasés) ; renvoie le nombre de fichiers copiés. */
    installExampleTemplates(): Promise<{ folder: string; copied: number }>
    /** GH34 — depuis la route `/print/drawio-snapshot` : diagramme `index` rendu (rectangle en px
     *  CSS, `null` si échec), ou fin du rendu (`index = -1`). N'a d'effet que dans la fenêtre
     *  cachée de capture d'un export Word par gabarit. */
    drawioSnapshotReady(index: number, rect: { x: number; y: number; width: number; height: number } | null): Promise<void>
    /** Signale depuis une route `/print/<kind>` que ses données sont chargées et prêtes à imprimer
     *  — n'a d'effet que dans la fenêtre cachée créée par un export pdf en cours. */
    notifyPrintReady(): Promise<void>
    /** Ouvre l'explorateur de fichiers avec le fichier exporté sélectionné. */
    showInFolder(filePath: string): Promise<void>
    /** Ouvre le fichier exporté avec l'application par défaut du système. */
    openFile(filePath: string): Promise<void>
  }
}
