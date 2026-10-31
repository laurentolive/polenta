import type {
  CreateOnServerResult, DesignateOutcome, IntegrationState, ForgeAccount, ForgeDetection, ForgeMember, ForgeOrg, ForgeRepo, ForgeRepoAccess, MachineConfig,
  FieldRename, FieldRenameResult, TypeRenameDto, TypeRenamePlan, TypeRenameResult, SchemaDeletePlan, SchemaDeleteResult, SchemaDeleteTarget, HistoryBackfillResult, ObjectHistory, ValueRename, ValueRenamePreview, PasswordLoginResult, TeamConfigStatus, TeamProjectEntry, GraphParamValue, QueryParameterDef, QueryColumnDef,
  ObjectTypeDefinition, ExecutionHistory, ExecutionHistoryTarget,
  ApprovalCheck, Change, ChangeAnalysis, ChangeSummary, ComponentBacklog, CreateChangeDto, UpdateChangeDto,
  ModificationCheck, ModificationKind, ChangeToModifyTrace, ChangeTestsToRun,
} from '@polenta/types'
import type {
  MergeFileDetail,
  MergeFileDraft,
  MergeFinalizeResult,
  MergeKeepBothResult,
  MergeOrigin,
  MergeSessionInfo, DiffSaveResult,
  MergeValidation,
  ClearRevalidationResult,
  FlaggedElement,
  Parameter,
  ParamResolutionPreview,
  ReqInstanceSelection,
  CarriedEntrySelection,
  ParameterDeleteResult,
  ParameterUsage,
  ParameterWriteResult,
  RepoParameters,
  ProjectRecent,
  ProjectInfo,
  Requirement,
  ObjectLink,
  WorkspaceObject,
  WorkspaceLink,
  WorkspaceLinkType,
  TestCase,
  TestRun,
  TraceabilityMatrix,
  LegacyImpactAck,
  TestPlanDraft,
  MatrixExportRow,
  RevalidationItem,
  Review,
  ReviewStatus,
  ProjectSchema,
  TestCampaign,
  TestRunResult,
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
  RowTarget,
  DescribedObject,
  QueryScope,
  SavedQuery,
  QueryHistoryEntry,
  Dashboard,
  WidgetSize,
  ScriptRunRequest,
  ScriptRunResult,
  SuiviUpdatesList,
  ScriptClientInfo,
  QueryTemplate,
  WidgetTemplate,
  WidgetCode,
  LocalImpactAnalysis,
  RequirementDiffEntry,
  ExportKind,
  ExportFormat,
  ExportTemplateListResult,
  TemplateExportFormat,
  ExportResult,
  ExecutionSheetLocale,
  ExecutionImportPreview,
  ExecutionImportResult,
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

/** GH74 — demande de modèle (id + paramètres du formulaire). */
export interface TemplateInput {
  id: string
  params: Record<string, unknown>
}

export interface CreateSavedQueryDto {
  title: string
  scope: QueryScope
  createdBy: string
  /** Script fourni, ou modèle (le script est alors généré). */
  script?: string
  template?: TemplateInput
  /** GH93 — paramètres choisis à l'affichage (avec `script` seulement : un modèle les génère). */
  parameters?: QueryParameterDef[]
  /** GH70 — colonne calculée de la Vue Système (requête partagée, avec `script` seulement). */
  column?: QueryColumnDef | null
}

export interface UpdateSavedQueryDto {
  title?: string
  /** Code modifié : la référence de modèle est conservée (objet détaché si le code diffère). */
  script?: string
  /** Modèle / paramètres : script régénéré ; `null` retire la référence. */
  template?: TemplateInput | null
  /** GH93 — nouvelle déclaration de paramètres (sans `template`). */
  parameters?: QueryParameterDef[]
  /** GH70 — nouvelle déclaration de colonne (sans `template`) ; `null` la retire. */
  column?: QueryColumnDef | null
}

export interface AddHistoryEntryDto {
  script: string
}

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
  size: WidgetSize
  transform?: string
  spec?: string
  template?: TemplateInput
}

export interface UpdateWidgetDto {
  title?: string
  queryId?: string
  size?: WidgetSize
  transform?: string | null
  spec?: string
  template?: TemplateInput | null
}

/** GH74 — type d'objet proposé par le formulaire « Liste filtrée ». */
export interface SuiviObjectTypeOption {
  objectTypeRef: string
  component: string
  label: string
  category: 'requirement' | 'test' | 'campaign'
  fields: string[]
}

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

/**
 * GH178 — contenu des deux côtés d'un diff de fichier. `oldRef` / `newRef` : SHA effectivement lus
 * (`null` = working tree), pour relire à la même version les fichiers référencés (diagrammes,
 * images, schéma). `*Missing` : fichier absent de ce côté (`*Content` vaut alors `''`).
 */
export interface FileDiffContents {
  oldContent: string
  newContent: string
  oldRef?: string | null
  newRef?: string | null
  oldMissing?: boolean
  newMissing?: boolean
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
  // GH37: `leftRef` (mes modifications) / `rightRef` (destination) of the conflicting merge, to
  // open the merge editor on it.
  | { success: false; conflicts: string[]; leftRef?: string; rightRef?: string }

// T154 — SyncService.ensureIntegrationUpToDate()'s outcome.
export type IntegrationSyncResult = 'up-to-date' | 'fast-forwarded' | 'diverged' | 'no-remote-branch'

// GH138 — mirrors SyncService's CheckoutBranchResult.
export interface CheckoutBranchResult {
  branch: string
  remote?: 'created' | 'up-to-date' | 'behind' | 'ahead' | 'diverged'
  remoteRef?: string
}

// GH39 — mirrors SyncService's IntegrationRemoteState / ResyncOutcome.
export type IntegrationRemoteStateKind = 'no-remote' | 'up-to-date' | 'behind' | 'ahead' | 'diverged'
export interface IntegrationRemoteState {
  state: IntegrationRemoteStateKind
  ahead: number
  behind: number
  offline?: true
  /** GH45 — accès au serveur révoqué : plus aucun appel réseau jusqu'à la reconnexion. */
  accessRevoked?: true
  /** GH45 — serveur concerné, scheme + hôte + port (avec `accessRevoked`). */
  revokedServer?: string
}
export type ResyncOutcome =
  | { outcome: 'up-to-date' | 'fast-forwarded' | 'pushed' | 'merged' }
  | { outcome: 'set-aside'; branch: string }
// GH173 — mirrors SyncService's AutoBranchOutcome.
export type AutoBranchOutcome =
  | { action: 'none' }
  | { action: 'switched' | 'returned'; branch: string }

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
  /** GH176 — colonnes du sélecteur de tests d'une campagne. Absent ⇒ celles de la vue Tableau. */
  picker?: string[]
  /** GH197 — colonnes de la grille d'historique des exécutions. Absent ⇒ défaut (verdict, date…). */
  executions?: string[]
  /** GH176 — titres de dossiers affichés dans le sélecteur de tests. Absent ⇒ ceux de la vue Tableau. */
  showFoldersPicker?: boolean
}

/** GH176 — écriture partielle de `FieldVisibilityPref` : une clé absente est conservée telle quelle,
 *  une clé à `null` est supprimée. */
export type FieldVisibilityPatch = { [K in keyof FieldVisibilityPref]?: FieldVisibilityPref[K] | null }

/** GH44 — un projet de « Mes projets » (espace serveur de l'utilisateur, version web). */
export interface WebWorkspaceEntry {
  name: string
  workspaceDir: string
}

export type WebDeleteWorkspaceResult =
  | { status: 'deleted' }
  | { status: 'unpublished'; repos: string[] }

export interface ApiClient {
  /**
   * GH44 — channels propres au serveur web (`window.polenta.platform === 'web'`) ; n'existent pas
   * sur le desktop.
   */
  web: {
    workspacesRoot(): Promise<string>
    listWorkspaces(): Promise<WebWorkspaceEntry[]>
    /** Dossier neuf et vide sous « Mes projets » : remplace le choix d'un dossier de destination. */
    newWorkspaceDir(nameHint: string): Promise<string>
    deleteWorkspace(workspaceDir: string, force?: boolean): Promise<WebDeleteWorkspaceResult>
  }
  app: {
    setTitle(title: string): Promise<void>
    getVersion(): Promise<string>
    /** GH26 — préférences de l'application (userData), pas du projet. */
    getSettings(): Promise<AppSettings>
    setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
    /** GH26 — ouvre une page de release GitHub dans le navigateur système. */
    openReleasePage(url: string): Promise<void>
    /** GH195 — ouvre la valeur d'un champ `link` (desktop seulement) : schéma revalidé, confirmation
     *  hors http(s). `false` si refusé, annulé ou en échec. */
    openLink(url: string): Promise<boolean>
    /** GH45 — configuration machine (DSI sur le desktop, exploitant sur le web). */
    getMachineConfig(): Promise<MachineConfig>
    /** GH45 S2b — configuration par équipe (cache, sans réseau). */
    getTeamConfig(): Promise<TeamConfigStatus>
    /** GH45 S2b — relit la configuration sur la forge du compte courant. */
    refreshTeamConfig(): Promise<TeamConfigStatus>
    /** GH45 S2b — projets proposés, accessibles à l'utilisateur. */
    teamProjects(): Promise<TeamProjectEntry[]>
    /** GH45 S2b — desktop : lien d'invitation reçu avant que l'interface ne soit prête. */
    takePendingInvite(): Promise<{ server: string; login?: string } | null>
  }
  /** GH26 — mise à jour automatique ; les changements d'état arrivent par l'événement
   *  'update:state-changed' (window.polenta.on). */
  update: {
    getState(): Promise<UpdateState>
    install(): Promise<void>
  }
  schema: {
    get(repoPath: string): Promise<ProjectSchema>
    /** GH178 — `.polenta/schema.yaml` du repo lu à une ref git (lecture seule), `null` s'il n'y existe pas. */
    getAt(repoPath: string, ref: string): Promise<ProjectSchema | null>
    save(repoPath: string, schema: ProjectSchema): Promise<void>
    moveElement(repoPath: string, dto: MoveElementDto): Promise<MoveElementResult>
    /** GH77 — migre valeur et historique des champs renommés sur les objets du type (après `save`). */
    renameFields(repoPath: string, objectTypeRef: string, renames: FieldRename[]): Promise<FieldRenameResult>
    /** GH82 — aperçu sans écriture : objets du type portant l'ancienne / la nouvelle valeur. */
    previewValueRenames(repoPath: string, objectTypeRef: string, renames: ValueRename[]): Promise<ValueRenamePreview[]>
    /** GH82 — migre statuts / valeurs d'enum renommés (objets, historique, copies de campagne). */
    renameValues(repoPath: string, objectTypeRef: string, renames: ValueRename[]): Promise<FieldRenameResult>
    /** GH100 — aperçu sans écriture du renommage d'un type (nom / préfixe). */
    previewTypeRename(repoPath: string, workspaceDir: string, dto: TypeRenameDto): Promise<TypeRenamePlan>
    /** GH100 — après l'enregistrement du schéma : migre les objets du type et leurs références. */
    renameType(repoPath: string, workspaceDir: string, dto: TypeRenameDto): Promise<TypeRenameResult>
    /** GH104 — aperçu sans écriture de la suppression en cascade d'un composant local ou d'un type. */
    previewDelete(repoPath: string, workspaceDir: string, target: SchemaDeleteTarget): Promise<SchemaDeletePlan>
    /** GH104 — supprime objets, liens, arbres et refs de liens, puis le nœud / type du schéma. */
    delete(repoPath: string, workspaceDir: string, target: SchemaDeleteTarget): Promise<SchemaDeleteResult>
    /** Drops the main-process in-memory cache for `repoPath` so the next `get()` re-reads schema.yaml from disk. */
    invalidate(repoPath: string): Promise<void>
  }
  tree: {
    get(repoPath: string, nodeId: string, typeId: string): Promise<TypeTree>
    save(repoPath: string, tree: TypeTree): Promise<void>
    generateId(): Promise<string>
  }
  /** GH45 S4 — forges Forgejo/Gitea du compte : repos, organisations, droits, membres. */
  forge: {
    /** Comptes Forgejo/Gitea connectés, compte par défaut en tête. */
    accounts(): Promise<ForgeAccount[]>
    listRepos(accountKey: string): Promise<ForgeRepo[]>
    /** Organisations où le compte peut créer un repo. */
    creatableOrgs(accountKey: string): Promise<ForgeOrg[]>
    /** Droits sur le repo `origin` ; null hors ligne, hors Forgejo ou sans compte. */
    repoAccess(repoPath: string): Promise<ForgeRepoAccess | null>
    /** Membres de l'organisation propriétaire du repo ; null dans les cas sans objet. */
    orgMembers(repoPath: string): Promise<ForgeMember[] | null>
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
    /** GH45 S2b — projet récent dont l'origin est `remoteUrl`, null sinon. */
    findByRemote(remoteUrl: string): Promise<ProjectRecent | null>
    /** GH45 S4 — nouveau projet sur le serveur (repo privé dans `org`), puis local, puis publication. */
    createOnServer(containerDir: string, name: string, accountKey: string, org: string): Promise<CreateOnServerResult>
    /** GH45 S4 — nouveau repo de composant sur le serveur, initialisé ; renvoie son URL de clone. */
    createComponentOnServer(accountKey: string, org: string, name: string): Promise<{ cloneUrl: string }>
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
    /** GH45 — type de forge d'un serveur (écran de connexion). */
    detectForge(serverUrl: string): Promise<ForgeDetection>
    /** GH45 — connexion identifiant + mot de passe (+ 2FA) : la forge crée un jeton, seul conservé. */
    loginWithPassword(serverUrl: string, login: string, password: string, otp?: string): Promise<PasswordLoginResult>
    /** GH45 — compte courant, sans réseau ; null si aucun compte connecté. */
    currentAccount(): Promise<ForgeAccount | null>
    /** GH45 — desktop : déconnexion du compte courant (jetons locaux supprimés). */
    logout(): Promise<void>
    /** GH45 — desktop : ouvre la page de changement de mot de passe annoncée par la forge à la dernière connexion. */
    openPasswordChange(): Promise<void>
  }
  dialog: {
    pickFolder(title?: string): Promise<string | null>
    pickImageFile(): Promise<{ mimeType: string; base64: string } | null>
  }
  /** GH198 — changesets ; `repoPath` de get / update / delete = repo de stockage (`ChangeSummary.repoPath`). */
  changesets: {
    list(repoPath: string, workspaceDir?: string): Promise<ChangeSummary[]>
    get(repoPath: string, id: string): Promise<Change>
    create(repoPath: string, dto: CreateChangeDto, workspaceDir?: string): Promise<Change & { repoPath: string }>
    update(repoPath: string, id: string, dto: UpdateChangeDto): Promise<Change>
    delete(repoPath: string, id: string): Promise<void>
    /** GH199 — analyse d'impact : instantané si figée, sinon calculée. */
    analysis(repoPath: string, id: string): Promise<ChangeAnalysis>
    /** GH199 §8bis — backlog calculé de chaque composant local du workspace. */
    backlog(repoPath: string, workspaceDir?: string): Promise<ComponentBacklog[]>
    assign(repoPath: string, id: string, elementIds: string[]): Promise<Change>
    move(repoPath: string, fromId: string, toId: string, elementIds: string[]): Promise<void>
    /** GH199 §8bis — l'approbation de l'élément exige-t-elle de l'assigner à un change ? */
    approvalCheck(repoPath: string, element: { id: string; objectTypeRef: string; category: 'requirement' | 'test' }, toStatus: string): Promise<ApprovalCheck>
    /** GH200 — création / réouverture d'un élément : changesets éligibles, assignation existante. */
    modificationCheck(repoPath: string, element: { id?: string; objectTypeRef: string; category?: 'requirement' | 'test'; toStatus?: string }, kind: ModificationKind, workspaceDir?: string): Promise<ModificationCheck>
    /** GH200 — trace départ / approbation des éléments à modifier. */
    trace(repoPath: string, id: string): Promise<ChangeToModifyTrace[]>
    /** GH207 — tests à exécuter, campagnes liées, tests à ajouter. */
    testsToRun(repoPath: string, id: string): Promise<ChangeTestsToRun>
  }
  /** GH197 — historique des exécutions d'un test ou d'une exigence. */
  executions: {
    history(repoPath: string, target: ExecutionHistoryTarget, workspaceDir?: string): Promise<ExecutionHistory>
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
    /** Pages décompressées (XML mxGraphModel prêt à parser), ou null si le fichier n'existe pas / n'est pas un .drawio valide.
     *  `ref` (GH178) : lu à ce commit / cette ref git ; absent ou `null` = working tree. */
    read(repoPath: string, relativePath: string, ref?: string | null): Promise<DrawioPage[] | null>
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
    read(repoPath: string, relativePath: string, ref?: string | null): Promise<{ mimeType: string; base64: string } | null>
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
    pull(repoPath: string): Promise<MergeResult>
    fetch(repoPath: string, urlFallback: string, remote?: string): Promise<void>
    fastForwardBranch(repoPath: string, branchName: string, remote?: string): Promise<IntegrationSyncResult>
    pullFastForwardOnly(repoPath: string): Promise<void>
    /** GH39: integration branch vs `origin/<branch>` as of the last fetch — local, no network. */
    integrationState(repoPath: string, branch: string): Promise<IntegrationRemoteState>
    /** GH39: simulates merging `origin/<branch>` into `<branch>` — nothing is written. */
    canMergeRemoteIntoIntegration(repoPath: string, branch: string): Promise<{ ok: true } | { ok: false; conflicts: string[] }>
    /** GH39: "Resynchroniser" — throws `integration-dirty` if the checked-out integration has pending changes. */
    resyncIntegration(repoPath: string, branch: string): Promise<ResyncOutcome>
    /** GH39: one auto-pull tick — fetch, fast-forward if clean, push retry if the integration is only ahead. */
    autoSync(repoPath: string, integrationBranch: string): Promise<IntegrationRemoteState>
    /** GH173: local only — moves pending changes on the integration onto `dev-auto`, or goes back
     *  to the integration from an idle `dev-auto` (and deletes it). */
    settleAutoBranch(repoPath: string, integrationBranch: string): Promise<AutoBranchOutcome>
    /** GH39: true when `branch` has no commit absent from `into`. */
    isMergedInto(repoPath: string, branch: string, into: string): Promise<boolean>
    log(repoPath: string, limit?: number): Promise<CommitEntry[]>
    checkoutCommit(repoPath: string, sha: string): Promise<void>
    stage(repoPath: string, filepath: string): Promise<void>
    stageAll(repoPath: string): Promise<void>
    unstage(repoPath: string, filepath: string): Promise<void>
    unstageAll(repoPath: string): Promise<void>
    discard(repoPath: string, filepath: string): Promise<void>
    discardAll(repoPath: string): Promise<void>
    graph(repoPath: string, limit?: number): Promise<GraphCommit[]>
    diff(repoPath: string, filepath: string): Promise<FileDiffContents>
    commitFiles(repoPath: string, sha: string): Promise<SyncFileStatus[]>
    commitDiff(repoPath: string, sha: string, filepath: string): Promise<FileDiffContents>
    branches(repoPath: string): Promise<BranchInfo[]>
    createBranch(repoPath: string, name: string): Promise<void>
    /** GH138 — `origin/<branch>` checks out the local `<branch>` (created if absent), never a detached HEAD. */
    checkoutBranch(repoPath: string, name: string): Promise<CheckoutBranchResult>
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
    diffFileBetween(repoPath: string, sha1: string, sha2: string, filepath: string): Promise<FileDiffContents>
    /** GH200 — élément entre sa version de départ (`null` : création) et un commit (`null` : disque). */
    diffElement(repoPath: string, filepath: string, baseSha: string | null, newSha: string | null): Promise<FileDiffContents>
    resolveRefs(repoPath: string): Promise<GitRef[]>
  }
  /** Opérations git bas niveau ne relevant pas du domaine `sync` (T43). */
  /** GH222 — enregistrement depuis la vue de diff d'un fichier du working tree (spec §12). */
  diffEdit: {
    saveWorkingFile(repoPath: string, filepath: string, text: string, baseline: string, workspaceDir?: string): Promise<DiffSaveResult>
  }
  /** GH37 — résolution des conflits de merge dans l'outil (brouillon hors repo, cf. MergeSessionInfo). */
  mergeResolution: {
    open(repoPath: string, leftRef: string, rightRef: string, origin: MergeOrigin): Promise<MergeSessionInfo>
    list(repoPaths?: string[]): Promise<MergeSessionInfo[]>
    get(id: string): Promise<MergeSessionInfo | null>
    getFile(id: string, path: string): Promise<MergeFileDetail>
    saveFile(id: string, path: string, draft: MergeFileDraft): Promise<MergeSessionInfo>
    validate(id: string, path: string, text: string): Promise<MergeValidation>
    keepBoth(id: string, path: string, apply: boolean): Promise<MergeKeepBothResult>
    finalize(id: string): Promise<MergeFinalizeResult>
    abandon(id: string): Promise<void>
  }
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
    /** @deprecated GH106 — uncommitted write; use `integration.designate`. */
    setIntegrationBranch(repoPath: string, branch: string): Promise<void>
    /** Deletes the tag on the main repo and on every listed component repo. */
    delete(repoPath: string, tag: string, components?: BaselineComponentRef[]): Promise<void>
  }
  /** GH106 — branche d'intégration explicite (specs/GH106-design.md §2). */
  integration: {
    state(repoPath: string): Promise<IntegrationState>
    /** Checkout si besoin, commit du seul `config/project.yaml`, push, branche par défaut de la forge. */
    designate(repoPath: string, branch: string): Promise<DesignateOutcome>
    /** Crée `int-<suffix>` (position courante, ou `from.tag`) puis la désigne. */
    create(repoPath: string, suffix: string, from?: { tag: string }): Promise<DesignateOutcome>
  }
  requirements: {
    list(repoPath: string, filters?: RequirementFilters): Promise<Requirement[]>
    get(repoPath: string, id: string): Promise<Requirement>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    create(repoPath: string, dto: CreateRequirementDto, workspaceDir?: string): Promise<Requirement>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    update(repoPath: string, id: string, dto: UpdateRequirementDto, workspaceDir?: string): Promise<Requirement>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    /** GH163 — `comment` : commentaire de modification (historique du statut). */
    openDraft(repoPath: string, id: string, targetStatus: string, workspaceDir?: string, comment?: string, changesetId?: string): Promise<Requirement>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    transition(repoPath: string, id: string, dto: TransitionRequirementDto, workspaceDir?: string): Promise<Requirement>
    // TODO: remove versioning API
    links(repoPath: string, id: string): Promise<ObjectLink[]>
    linksAll(repoPath: string): Promise<ObjectLink[]>
    /** GH105 — avec workspaceDir : lien écrit dans le repo de sa source (validé ; erreur préfixée
     *  par un `LinkWriteErrorCode`, ex. `READONLY_REPO: …`). Sans : repo donné, comme avant. */
    linkCreate(repoPath: string, data: { type: string; sourceId: string; targetId: string }, workspaceDir?: string): Promise<ObjectLink>
    /** GH105 — avec workspaceDir : supprimé dans le repo qui stocke le lien. */
    linkDelete(repoPath: string, linkId: string, workspaceDir?: string): Promise<void>
  }
  /** GH105 — liens inter-repos : agrégation sur les repos du workspace (racine d'abord). */
  links: {
    /** Exigences et tests de tous les repos du workspace. */
    objects(repoPath: string, workspaceDir?: string): Promise<WorkspaceObject[]>
    /** Liens de tous les `links.yaml` du workspace, avec leur repo de stockage. */
    list(repoPath: string, workspaceDir?: string): Promise<WorkspaceLink[]>
    /** Union par nom des types de lien du workspace, et repos déclarant chaque `<nœud>::<type>`. */
    types(repoPath: string, workspaceDir?: string): Promise<{ linkTypes: WorkspaceLinkType[]; declaredBy: Record<string, string[]> }>
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
    /** GH196 — type d'un test (champs d'exécution / d'étape), schéma du composant compris ; null si introuvable. */
    typeDef(repoPath: string, objectTypeRef: string, workspaceDir?: string): Promise<ObjectTypeDefinition | null>
    /** workspaceDir: optional flat-workspace directory for cross-repo component resolution (T69 Sprint 3) */
    openDraft(repoPath: string, id: string, targetStatus: string, workspaceDir?: string, comment?: string, changesetId?: string): Promise<TestCase>
  }
  traceability: {
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    matrix(repoPath: string, filters?: MatrixFiltersDto, workspaceDir?: string): Promise<TraceabilityMatrix>
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    missingLinks(repoPath: string, workspaceDir?: string): Promise<MissingLinksResult>
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    /** GH199 — acquittements de l'ancien flux élément unique (`impact-acks/<id>/`), lecture seule. */
    legacyAcks(repoPath: string, elementId: string): Promise<LegacyImpactAck[]>
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    testPlan(repoPath: string, dto: GenerateTestPlanDto, workspaceDir?: string): Promise<TestPlanDraft>
    /** workspaceDir: optional flat-workspace directory for multi-repo traversal (T69 Sprint 3) */
    exportCsv(repoPath: string, filters?: MatrixFiltersDto, workspaceDir?: string): Promise<MatrixExportRow[]>
    /** Diff exigence-par-exigence entre deux shas (T46) — indépendant de l'index vivant. */
    diffRequirements(repoPath: string, fromSha: string, toSha: string): Promise<RequirementDiffEntry[]>
  }
  history: {
    /** GH77 — historique des champs suivis, avec les entrées implicites (`implicit: true`) à la lecture. */
    get(repoPath: string, kind: 'requirement' | 'test' | 'campaign' | 'changeset', id: string): Promise<ObjectHistory>
    /** GH77 — reprise de l'historique depuis `git log` pour un repo (fichiers réécrits, pas de commit). */
    backfill(repoPath: string): Promise<HistoryBackfillResult>
  }
  revalidation: {
    /** T173 — éléments marqués `needsRevalidation` du workspace, avec leurs éléments liés. */
    list(repoPath: string, workspaceDir?: string): Promise<FlaggedElement[]>
    /** T173 — lève le flag (retire la clé du YAML) ; best-effort par élément, pas de commit. */
    clear(repoPath: string, ids: string[], workspaceDir?: string): Promise<ClearRevalidationResult>
  }
  impactAnalysis: {
    /** T175 — analyse live des modifications locales vs HEAD (racine + composants), jamais persistée. */
    local(repoPath: string, workspaceDir?: string): Promise<LocalImpactAnalysis>
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
    /** GH81 — `displayed` : version du test affichée, figée si l'instance est resynchronisable (GH68). */
    updateRun(repoPath: string, campaignId: string, entryId: string, status: TestRunResult, runId: string, displayed?: TestCase): Promise<TestCampaign>
    close(repoPath: string, id: string, status: 'completed' | 'abandoned'): Promise<TestCampaign>
    /** T179 — `reqInstances` : exigences retenues (et saisies par instance) des tests itérants. */
    addTests(repoPath: string, campaignId: string, testCaseIds: string[], paramValuesByTest?: Record<string, Record<string, string>>, workspaceDir?: string, reqInstances?: ReqInstanceSelection, carried?: CarriedEntrySelection[]): Promise<TestCampaign>
    removeEntries(repoPath: string, campaignId: string, entryIds: string[]): Promise<TestCampaign>
    /** T179 — `requirementId` : duplicata d'une instance générée pour cette exigence. */
    duplicateTest(repoPath: string, campaignId: string, testCaseId: string, paramValues: Record<string, string>, workspaceDir?: string, requirementId?: string): Promise<TestCampaign>
    /** T171 — résolution prévisionnelle des paramètres de tests à ajouter (sans écriture). */
    previewParams(repoPath: string, source: { campaignId?: string; baselineRef?: string }, testCaseIds: string[], workspaceDir?: string): Promise<ParamResolutionPreview[]>
    updateRunParams(repoPath: string, campaignId: string, entryId: string, paramValues: Record<string, string>): Promise<TestCampaign>
    delete(repoPath: string, id: string): Promise<void>
    /** GH36 — exécution hors outil via un classeur Excel. */
    executionSheet: {
      /** Ouvre le dialogue d'enregistrement puis écrit le classeur (`locale` : libellés du classeur). */
      export(repoPath: string, campaignId: string, locale: ExecutionSheetLocale): Promise<ExportResult>
      /** Ouvre le sélecteur de fichier puis renvoie l'aperçu de l'import (aucune écriture). */
      preview(repoPath: string, campaignId: string): Promise<ExecutionImportPreview | { canceled: true }>
      /** Relit et revalide `filePath`, puis écrit les résultats des instances remplies. */
      apply(repoPath: string, campaignId: string, filePath: string, workspaceDir?: string): Promise<ExecutionImportResult>
    }
  }
  pref: {
    getFieldVisibility(repoPath: string, username: string, typeKey: string): Promise<FieldVisibilityPref | null>
    /** GH176 — fusionne `views` dans l'entrée existante (`null` = clé supprimée) ; ne remplace pas l'entrée. */
    setFieldVisibility(repoPath: string, username: string, typeKey: string, views: FieldVisibilityPatch): Promise<void>
    /** GH133 — choix « Fusionner dans <intégration> » mémorisé pour `branch` (`null` : aucun). */
    getPublishMerge(repoPath: string, username: string, branch: string): Promise<boolean | null>
    setPublishMerge(repoPath: string, username: string, branch: string, merge: boolean): Promise<void>
  }
  /** GH74 — vue Suivi : exécution des scripts (bac à sable du main), drill-down, modèles. */
  suivi: {
    /** Widget enregistré, requête enregistrée ou script fourni ; erreurs dans le résultat. */
    run(repoPath: string, workspaceDir: string | undefined, username: string, req: ScriptRunRequest, client: ScriptClientInfo): Promise<ScriptRunResult>
    describeIds(repoPath: string, workspaceDir: string | undefined, ids: string[], locale?: string): Promise<DescribedObject[]>
    resolveTarget(repoPath: string, workspaceDir: string | undefined, id: string): Promise<RowTarget | null>
    templates(): Promise<{ queries: Omit<QueryTemplate, 'generate' | 'parameters' | 'column'>[]; widgets: Omit<WidgetTemplate, 'generate'>[] }>
    renderTemplate(kind: 'query', input: TemplateInput): Promise<{ script: string; parameters: QueryParameterDef[]; column: QueryColumnDef | null }>
    renderTemplate(kind: 'widget', input: TemplateInput): Promise<WidgetCode>
    objectTypes(repoPath: string, workspaceDir?: string): Promise<SuiviObjectTypeOption[]>
    /** GH74 §6.3 — bandeau des mises à jour (bibliothèque, widgets du seed, versions de modèle). */
    updatesList(repoPath: string, username: string, locale?: string): Promise<SuiviUpdatesList>
    /** Applique les propositions choisies (écriture normale, à publier pour les fichiers partagés). */
    updatesApply(repoPath: string, username: string, ids: string[], locale?: string): Promise<void>
    /** Masque une version proposée pour l'utilisateur. */
    updatesIgnore(repoPath: string, username: string, id: string, toVersion: number): Promise<void>
  }
  /** Requêtes enregistrées (scripts de données) / historique (T77, GH74). */
  queries: {
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
    /** GH65 — `locale` : langue des libellés du seed « Campagnes » (absent : français). */
    list(repoPath: string, username: string, locale?: string): Promise<Dashboard[]>
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
    /** GH93 — valeurs choisies dans la barre de paramètres du dashboard (clé `name:kind`), privées. */
    getParamValues(repoPath: string, username: string, dashboardId: string): Promise<Record<string, GraphParamValue>>
    /** `null` : Réinitialiser (retour aux défauts des déclarations). */
    setParamValues(repoPath: string, username: string, dashboardId: string, values: Record<string, GraphParamValue> | null): Promise<void>
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
