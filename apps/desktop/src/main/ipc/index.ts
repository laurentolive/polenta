import { registerPrefHandlers } from './pref.handlers'
import type { HandlerRegistry } from './registry'
import type { PlatformHost } from '../host/platform-host'
import { IMAGE_MIME_BY_EXT, IMAGE_EXT_BY_MIME, findAvailableFileName } from './file-ops'
import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import git from 'isomorphic-git'
import type { AuthService } from '../services/auth.service'
import type { GitService } from '../services/git.service'
import type { SyncService } from '../services/sync.service'
import type { MergeResolutionService } from '../services/merge-resolution.service'
import type { WorkspaceService } from '../services/workspace.service'
import type { RequirementsIndexService } from '../services/requirements-index.service'
import type { TestsIndexService } from '../services/tests-index.service'
import type { RequirementsService } from '../services/requirements.service'
import type { TestsService } from '../services/tests.service'
import type { TraceabilityService } from '../services/traceability.service'
import type { ReviewsService } from '../services/reviews.service'
import type { RepoWatcherService } from '../services/repo-watcher.service'
import type { SchemaService } from '../services/schema.service'
import type { ElementMoveService } from '../services/element-move.service'
import type { CampaignsService } from '../services/campaigns.service'
import type { ChangesService } from '../services/changes.service'
import type { ExecutionHistoryService } from '../services/execution-history.service'
import type { CampaignExecutionService } from '../services/campaign-execution.service'
import type { PolentaRepoService } from '../services/polenta-repo.service'
import type { WorkspaceTreeService } from '../services/workspace-tree.service'
import type { InterfaceComplianceService } from '../services/interface-compliance.service'
import type { SuiviService } from '../services/suivi.service'
import type { SuiviUpdatesService } from '../services/suivi-updates.service'
import type { TemplateInput } from '../services/suivi-store.util'
import type { GraphService } from '../services/graph.service'
import type { DashboardLibraryService } from '../services/dashboard-library.service'
import type { ScriptEngineService } from '../services/script-engine.service'
import type { SavedQueriesService, CreateSavedQueryDto, UpdateSavedQueryDto, AddHistoryEntryDto } from '../services/saved-queries.service'
import type {
  DashboardsService,
  CreateDashboardDto,
  UpdateDashboardDto,
  AddWidgetDto,
  UpdateWidgetDto,
} from '../services/dashboards.service'
import type { DashboardSeedService } from '../services/dashboard-seed.service'
import type { ExportService } from '../services/export.service'
import type { ParametersService } from '../services/parameters.service'
import type { RevalidationService } from '../services/revalidation.service'
import type { WorkspaceLinksService } from '../services/workspace-links.service'
import { readEffectiveHistory, type HistoryObjectKind, type HistoryService } from '../services/history.service'
import type { FieldRenameService } from '../services/field-rename.service'
import type { TypeRenameService } from '../services/type-rename.service'
import type { SchemaDeleteService } from '../services/schema-delete.service'
import type { CreateChangeDto, ExecutionHistoryTarget, UpdateChangeDto, ValueRename } from '@polenta/types'
import type { HistoryBackfillService } from '../services/history-backfill.service'
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
import type {
  ReviewStatus,
  QueryScope,
  ScriptClientInfo,
  ScriptRunRequest,
  CreateImpactAnalysisDto,
  UpdateImpactItemStatusDto,
  TemplateExportFormat,
  Parameter,
  AppSettings,
  MergeFileDraft,
  MergeOrigin,
  MachineConfig,
} from '@polenta/types'
import type { RequirementFilters } from '../services/requirements-index.service'
import type { CreateReviewDto } from '../services/reviews.service'
import type { TreeService } from '../services/tree.service'
import type { BaselineService } from '../services/baseline.service'
import type { AppSettingsService } from '../services/app-settings.service'
import type { ForgeConfigService } from '../services/forge-config.service'
import type { ForgeService } from '../services/forge/forge.service'
import type { IntegrationBranchService } from '../services/integration-branch.service'
import type { ExportTemplateLibrary } from '../services/export-template-library'
import { parseDrawioPages } from '../drawio-xml'
import { readFileAt } from '../services/read-file-at.util'

export interface Container {
  auth: AuthService
  git: GitService
  sync: SyncService
  mergeResolution: MergeResolutionService
  workspace: WorkspaceService
  reqIndex: RequirementsIndexService
  testsIndex: TestsIndexService
  requirements: RequirementsService
  tests: TestsService
  traceability: TraceabilityService
  reviews: ReviewsService
  watcher: RepoWatcherService
  schema: SchemaService
  elementMove: ElementMoveService
  campaigns: CampaignsService
  campaignExecution: CampaignExecutionService
  executionHistory: ExecutionHistoryService
  changes: ChangesService
  tree: TreeService
  baseline: BaselineService
  polentaRepo: PolentaRepoService
  workspaceTree: WorkspaceTreeService
  interfaceCompliance: InterfaceComplianceService
  /** GH74 — graphe de données, bibliothèque projet, moteur de scripts. */
  graph: GraphService
  dashboardLibrary: DashboardLibraryService
  scriptEngine: ScriptEngineService
  suivi: SuiviService
  suiviUpdates: SuiviUpdatesService
  savedQueries: SavedQueriesService
  dashboards: DashboardsService
  dashboardSeed: DashboardSeedService
  export: ExportService
  parameters: ParametersService
  revalidation: RevalidationService
  /** GH105 — objets, liens et types de lien agrégés sur le workspace ; écriture côté source. */
  workspaceLinks: WorkspaceLinksService
  history: HistoryService
  fieldRename: FieldRenameService
  typeRename: TypeRenameService
  schemaDelete: SchemaDeleteService
  historyBackfill: HistoryBackfillService
  appSettings: AppSettingsService
  exportTemplateLibrary: ExportTemplateLibrary
  /** GH45 — configuration machine de l'hôte (cf. HostContext.machineConfig). */
  machineConfig: MachineConfig
  /** GH45 S2b — configuration par équipe lue sur la forge. */
  forgeConfig: ForgeConfigService
  /** GH45 S4 — repos, organisations, droits, membres ; création sur le serveur. */
  forge: ForgeService
  /** GH106 — désignation de la branche d'intégration, gardes de suppression. */
  integration: IntegrationBranchService
}

/** GH82 — arguments des canaux de renommage de valeurs, validés avant tout accès disque. */
function checkTypeRename(channel: string, dto: unknown): import('@polenta/types').TypeRenameDto {
  const d = dto as Record<string, unknown> | null
  const str = (k: string) => typeof d?.[k] === 'string'
  if (!d || !['nodeName', 'oldName', 'newName', 'oldPrefix', 'newPrefix'].every(str) || !d.nodeName || !d.oldName || !d.newName
    || !['requirement', 'test', 'campaign'].includes(d.category as string)) {
    throw new Error(`${channel} — dto must be { nodeName, category, oldName, newName, oldPrefix, newPrefix }`)
  }
  return d as unknown as import('@polenta/types').TypeRenameDto
}

function checkDeleteTarget(channel: string, target: unknown): import('@polenta/types').SchemaDeleteTarget {
  const t = target as Record<string, unknown> | null
  const nonEmpty = (k: string) => typeof t?.[k] === 'string' && (t[k] as string).length > 0
  if (!t || !nonEmpty('nodeName') || !(t.kind === 'node' || (t.kind === 'type' && nonEmpty('typeName')))) {
    throw new Error(`${channel} — target must be { kind: 'node', nodeName } or { kind: 'type', nodeName, typeName }`)
  }
  return t as unknown as import('@polenta/types').SchemaDeleteTarget
}

function checkValueRenames(channel: string, objectTypeRef: unknown, renames: unknown): [string, ValueRename[]] {
  if (typeof objectTypeRef !== 'string' || !objectTypeRef.includes('::')) {
    throw new Error(`${channel} — objectTypeRef must be "<node>::<type>"`)
  }
  const valid = Array.isArray(renames) && renames.every(r =>
    typeof r?.from === 'string' && typeof r?.to === 'string' && (
      r.target?.kind === 'status'
      || (r.target?.kind === 'field' && typeof r.target.field === 'string' && typeof r.target.multi === 'boolean')))
  if (!valid) throw new Error(`${channel} — renames must be an array of { target, from, to }`)
  return [objectTypeRef, renames as ValueRename[]]
}

/**
 * GH74 — channels qui écrivent dans le périmètre du graphe de données, premier argument = repo.
 * Le watcher n'oublie le graphe qu'après stabilisation des fichiers (≥ 300 ms) : sans oubli
 * immédiat, un script lancé juste après l'écriture (`suivi:run`) verrait l'état précédent.
 */
const GRAPH_WRITE_CHANNELS = new Set([
  'requirements:create', 'requirements:update', 'requirements:open-draft', 'requirements:transition',
  'requirements:link-create', 'requirements:link-delete',
  'tests:create', 'tests:update', 'tests:execute', 'tests:open-draft',
  'campaigns:create', 'campaigns:update', 'campaigns:update-run', 'campaigns:close', 'campaigns:add-tests',
  'campaigns:remove-entries', 'campaigns:duplicate-test', 'campaigns:update-run-params', 'campaigns:delete',
  'campaigns:execution-sheet-apply',
  'schema:save', 'schema:rename-fields', 'schema:rename-values', 'schema:rename-type', 'schema:delete', 'schema:move-element',
  'revalidation:clear', 'history:backfill', 'polenta-repo:save', 'reviews:approve-object', 'reviews:revoke-approval',
  'sync:pull', 'sync:pull-fast-forward-only', 'sync:fast-forward-branch', 'sync:checkout-commit', 'sync:checkout-branch',
  'sync:discard', 'sync:discard-all', 'sync:merge', 'sync:merge-into', 'sync:rebase', 'sync:resync-integration', 'sync:auto-sync',
  'sync:settle-auto-branch',
  'integration:designate', 'integration:create',
])

export function withGraphInvalidation(r: HandlerRegistry, graph: Container['graph']): HandlerRegistry {
  return {
    handle: (channel, fn) => r.handle(channel, !GRAPH_WRITE_CHANNELS.has(channel) ? fn : async (event, ...args) => {
      try {
        return await fn(event, ...args)
      } finally {
        if (typeof args[0] === 'string') graph.invalidate(args[0])
      }
    }),
  }
}

/**
 * Channels partagés par le desktop et le serveur web (GH44). Les channels propres au poste local
 * (dialogues natifs, shell, mise à jour…) sont dans `desktop-only.handlers.ts`.
 */
export function registerHandlers(registry: HandlerRegistry, c: Container, platform: PlatformHost): void {
  const r = withGraphInvalidation(registry, c.graph)
  // ── Live sync ────────────────────────────────────────────────────────────────
  // Pushes every out-of-band file change (external edit, git checkout/pull, a bulk-import
  // script writing directly to disk…) to every open window, so the renderer can invalidate
  // the affected react-query caches on its own — see useLiveFileSync.ts for the mapping
  // from `relPath` to query keys.
  c.watcher.onFileChange((repoPath, relPath) => {
    platform.broadcast('repo:file-changed', repoPath, relPath)
  })

  // ── Workspace (projects) ───────────────────────────────────────────────────────
  r.handle('workspace:list-recents', () => c.workspace.listRecents())
  r.handle('workspace:mark-recent', (_e, workspaceDir: string) =>
    c.workspace.markRecent(workspaceDir))
  r.handle('workspace:get-last-opened', () => c.workspace.getLastOpened())
  r.handle('workspace:clear-last-opened', () => c.workspace.clearLastOpened())
  r.handle('workspace:resolve', (_e, workspaceDir: string) =>
    c.workspace.resolve(workspaceDir))
  r.handle('workspace:open-project', (_e, dir: string) =>
    c.workspace.openProject(dir))
  r.handle('workspace:create-new', (_e, containerDir: string, name: string) =>
    c.workspace.createNewProject(containerDir, name))
  r.handle('workspace:create-from-clone', (_e, containerDir: string, remoteUrl: string) =>
    c.workspace.createFromClone(containerDir, remoteUrl))
  r.handle('workspace:is-empty-dir', (_e, dir: string) =>
    c.workspace.isEmptyDir(dir))
  r.handle('workspace:find-by-remote', (_e, remoteUrl: string) =>
    c.workspace.findRecentByRemote(remoteUrl))

  // ── Forges (GH45 S4) : repos, organisations, droits, membres, création sur le serveur ─────────
  r.handle('forge:accounts', () => c.forge.accounts())
  r.handle('forge:list-repos', (_e, accountKey: string) => c.forge.listRepos(accountKey))
  r.handle('forge:creatable-orgs', (_e, accountKey: string) => c.forge.creatableOrgs(accountKey))
  r.handle('forge:repo-access', (_e, repoPath: string) => c.forge.repoAccess(repoPath))
  r.handle('forge:org-members', (_e, repoPath: string) => c.forge.orgMembers(repoPath))
  r.handle('workspace:create-on-server', (_e, containerDir: string, name: string, accountKey: string, org: string) =>
    c.forge.createProjectOnServer(containerDir, name, accountKey, org))
  r.handle('workspace:create-component-on-server', (_e, accountKey: string, org: string, name: string) =>
    c.forge.createComponentOnServer(accountKey, org, name))

  // ── Auth ─────────────────────────────────────────────────────────────────────
  r.handle('auth:has-any-account', () => c.auth.hasAnyAccount())
  // GH45 — forges : détection, connexion par mot de passe, compte courant, configuration machine.
  r.handle('auth:detect-forge', (_e, serverUrl: string) => c.auth.detectForge(serverUrl))
  r.handle('auth:login-password', (_e, serverUrl: string, login: string, password: string, otp?: string) =>
    c.auth.loginWithPassword(serverUrl, login, password, otp))
  r.handle('auth:current-account', () => c.auth.currentAccount())
  r.handle('app:get-machine-config', () => c.machineConfig)
  r.handle('app:get-team-config', () => c.forgeConfig.status())
  r.handle('app:refresh-team-config', () => c.forgeConfig.refresh())
  r.handle('app:team-projects', () => c.forgeConfig.teamProjects())
  c.forgeConfig.onChange(status => platform.broadcast('app:team-config-changed', status))
  r.handle('auth:setup', (_e, remote: string, pat: string) => c.auth.setup(remote, pat))
  r.handle('auth:save-token', (_e, remote: string, token: string) =>
    c.auth.saveToken(remote, token))
  r.handle('auth:get-token', (_e, remote: string) => c.auth.getToken(remote))
  r.handle('auth:delete-token', (_e, remote: string) => c.auth.deleteToken(remote))
  r.handle('auth:resolve-identity', (_e, remote: string) =>
    c.auth.resolveIdentity(remote))
  r.handle('auth:project-username', (_e, repoPath: string) =>
    c.auth.projectUsername(repoPath))

  // ── Sync ─────────────────────────────────────────────────────────────────────
  r.handle('sync:status', (_e, repoPath: string) => c.sync.status(repoPath))
  r.handle('sync:commit', (_e, repoPath: string, message: string) =>
    c.sync.commit(repoPath, message))
  r.handle('sync:push', (_e, repoPath: string) => c.sync.push(repoPath))
  r.handle('sync:pull', (_e, repoPath: string) => c.sync.pull(repoPath))
  r.handle('sync:fetch', (_e, repoPath: string, urlFallback: string, remote?: string) =>
    c.sync.fetch(repoPath, urlFallback, remote))
  r.handle('sync:fast-forward-branch',
    (_e, repoPath: string, branchName: string, remote?: string) =>
      c.sync.fastForwardBranch(repoPath, branchName, remote))
  r.handle('sync:pull-fast-forward-only', (_e, repoPath: string) => c.sync.pullFastForwardOnly(repoPath))
  r.handle('sync:integration-state', (_e, repoPath: string, branch: string) =>
    c.sync.integrationState(repoPath, branch))
  r.handle('sync:can-merge-remote', (_e, repoPath: string, branch: string) =>
    c.sync.canMergeRemoteIntoIntegration(repoPath, branch))
  r.handle('sync:resync-integration', (_e, repoPath: string, branch: string) =>
    c.sync.resyncIntegration(repoPath, branch))
  r.handle('sync:auto-sync', (_e, repoPath: string, branch: string) => c.sync.autoSync(repoPath, branch))
  r.handle('sync:settle-auto-branch', (_e, repoPath: string, branch: string) =>
    c.sync.settleAutoBranch(repoPath, branch))
  r.handle('sync:is-merged', (_e, repoPath: string, branch: string, into: string) =>
    c.sync.isMergedInto(repoPath, branch, into))
  r.handle('sync:log', async (_e, repoPath: string, limit = 20) => {
    const commits = await git.log({ fs, dir: repoPath, depth: limit })
    return commits.map((c: { oid: string; commit: { message: string; author: { name: string; timestamp: number } } }) => ({
      sha: c.oid,
      message: c.commit.message.split('\n')[0],
      author: c.commit.author.name,
      date: new Date(c.commit.author.timestamp * 1000).toISOString(),
    }))
  })
  r.handle('sync:checkout-commit', async (_e, repoPath: string, sha: string) => {
    await git.checkout({ fs, dir: repoPath, ref: sha })
  })
  r.handle('sync:stage', (_e, repoPath: string, filepath: string) =>
    c.sync.stage(repoPath, filepath))
  r.handle('sync:stage-all', (_e, repoPath: string) =>
    c.sync.stageAll(repoPath))
  r.handle('sync:unstage', (_e, repoPath: string, filepath: string) =>
    c.sync.unstage(repoPath, filepath))
  r.handle('sync:unstage-all', (_e, repoPath: string) =>
    c.sync.unstageAll(repoPath))
  r.handle('sync:discard', (_e, repoPath: string, filepath: string) =>
    c.sync.discard(repoPath, filepath))
  r.handle('sync:discard-all', (_e, repoPath: string) =>
    c.sync.discardAll(repoPath))
  r.handle('sync:graph', (_e, repoPath: string, limit?: number) =>
    c.sync.graph(repoPath, limit))
  r.handle('sync:tags', (_e, repoPath: string) =>
    c.sync.tags(repoPath))
  r.handle('sync:diff', (_e, repoPath: string, filepath: string) =>
    c.sync.diff(repoPath, filepath))
  r.handle('sync:branches', (_e, repoPath: string) =>
    c.sync.listBranches(repoPath))
  r.handle('sync:create-branch', (_e, repoPath: string, name: string) =>
    c.sync.createBranch(repoPath, name))
  r.handle('sync:checkout-branch', (_e, repoPath: string, name: string) =>
    c.sync.checkoutBranch(repoPath, name))
  // GH106 — garde ici plutôt que dans chaque UI : panneau Version, graphe et client web couverts.
  r.handle('sync:delete-branch', async (_e, repoPath: string, name: string) => {
    await c.integration.assertDeletable(repoPath, name, 'local')
    return c.sync.deleteBranch(repoPath, name)
  })
  r.handle('sync:commit-files', (_e: unknown, repoPath: string, sha: string) =>
    c.sync.commitFiles(repoPath, sha))
  r.handle('sync:commit-diff', (_e: unknown, repoPath: string, sha: string, filepath: string) =>
    c.sync.commitDiff(repoPath, sha, filepath))
  r.handle('sync:create-tag', (_e, repoPath: string, tagName: string) =>
    c.sync.createTag(repoPath, tagName))
  r.handle('sync:merge', (_e, repoPath: string, fromBranch: string) =>
    c.sync.merge(repoPath, fromBranch))
  r.handle('sync:merge-into', (_e, repoPath: string, fromBranch: string, intoBranch: string) =>
    c.sync.mergeInto(repoPath, fromBranch, intoBranch))
  // GH37 — résolution des conflits de merge dans l'outil.
  r.handle('merge-resolution:open', (_e, repoPath: string, leftRef: string, rightRef: string, origin: MergeOrigin) =>
    c.mergeResolution.open(repoPath, leftRef, rightRef, origin))
  r.handle('merge-resolution:list', (_e, repoPaths?: string[]) => c.mergeResolution.list(repoPaths))
  r.handle('merge-resolution:get', (_e, id: string) => c.mergeResolution.get(id))
  r.handle('merge-resolution:get-file', (_e, id: string, filepath: string) => c.mergeResolution.getFile(id, filepath))
  r.handle('merge-resolution:save-file', (_e, id: string, filepath: string, draft: MergeFileDraft) =>
    c.mergeResolution.saveFile(id, filepath, draft))
  r.handle('merge-resolution:validate', (_e, id: string, filepath: string, text: string) =>
    c.mergeResolution.validate(id, filepath, text))
  r.handle('merge-resolution:keep-both', (_e, id: string, filepath: string, apply: boolean) =>
    c.mergeResolution.keepBoth(id, filepath, apply))
  r.handle('merge-resolution:finalize', (_e, id: string) => c.mergeResolution.finalize(id))
  r.handle('merge-resolution:abandon', (_e, id: string) => c.mergeResolution.abandon(id))
  r.handle('sync:create-branch-at', (_e, repoPath: string, name: string, sha: string) =>
    c.sync.createBranchAt(repoPath, name, sha))
  r.handle('sync:delete-remote-branch', async (_e, repoPath: string, name: string, remote?: string) => {
    if (!remote || remote === 'origin') await c.integration.assertDeletable(repoPath, name, 'remote')
    return c.sync.deleteRemoteBranch(repoPath, name, remote)
  })
  r.handle('sync:delete-tag', (_e, repoPath: string, tagName: string) =>
    c.sync.deleteTag(repoPath, tagName))
  r.handle('sync:push-branch', (_e, repoPath: string, branchName: string, remote?: string) =>
    c.sync.pushBranch(repoPath, branchName, remote))
  r.handle('sync:rebase', (_e, repoPath: string, onto: string) =>
    c.sync.rebase(repoPath, onto))
  r.handle('sync:diff-between', (_e, repoPath: string, sha1: string, sha2: string) =>
    c.sync.diffBetween(repoPath, sha1, sha2))
  r.handle('sync:diff-file-between', (_e, repoPath: string, sha1: string, sha2: string, filepath: string) =>
    c.sync.diffFileBetween(repoPath, sha1, sha2, filepath))
  r.handle('sync:resolve-refs', (_e, repoPath: string) =>
    c.sync.resolveRefs(repoPath))
  // sync:submodule-tags supprimé en T69 Sprint 3 — les submodules git ne sont plus utilisés.

  // ── App ───────────────────────────────────────────────────────────────────────
  // GH26 — préférences de l'application (userData/app-settings.json, pas schema.yaml).
  r.handle('app:get-settings', () => c.appSettings.get())
  r.handle('app:set-settings', (_e, patch: Partial<AppSettings>) => c.appSettings.set(patch))


  // ── Requirements ─────────────────────────────────────────────────────────────
  r.handle('requirements:list', (_e, repoPath: string, filters?: unknown) =>
    c.requirements.findAll(repoPath, (filters as RequirementFilters | undefined) ?? {}))

  r.handle('requirements:get', (_e, repoPath: string, id: string) =>
    c.requirements.findOne(repoPath, id))

  r.handle('requirements:create', (_e, repoPath: string, dto: unknown, workspaceDir?: string) =>
    c.requirements.create(repoPath, dto as CreateRequirementDto, workspaceDir))

  r.handle('requirements:update', (_e, repoPath: string, id: string, dto: unknown, workspaceDir?: string) =>
    c.requirements.update(repoPath, id, dto as UpdateRequirementDto, workspaceDir))

  r.handle('requirements:open-draft', (_e, repoPath: string, id: string, targetStatus: string, workspaceDir?: string, comment?: string) =>
    c.requirements.openDraft(repoPath, id, targetStatus, workspaceDir, comment))

  r.handle('requirements:transition', (_e, repoPath: string, id: string, dto: unknown, workspaceDir?: string) =>
    c.requirements.transition(repoPath, id, dto as TransitionRequirementDto, workspaceDir))

  r.handle('requirements:versions', (_e, repoPath: string, id: string) =>
    c.requirements.findVersions(repoPath, id))

  r.handle('requirements:links', (_e, repoPath: string, id: string) =>
    c.requirements.findLinks(repoPath, id))

  r.handle('requirements:links-all', (_e, repoPath: string) =>
    c.requirements.findAllLinks(repoPath))

  // GH105 — avec workspaceDir : lien écrit dans le repo de l'objet côté sourceRefs (validé,
  // refus si ce repo est en lecture seule) ; suppression dans le repo qui stocke le lien.
  // Sans workspaceDir : comportement antérieur (repo donné, sans validation).
  r.handle('requirements:link-create', (_e, repoPath: string, data: { type: string; sourceId: string; targetId: string }, workspaceDir?: string) =>
    workspaceDir ? c.workspaceLinks.createLink(repoPath, data, workspaceDir) : c.requirements.createLink(repoPath, data))

  r.handle('requirements:link-delete', (_e, repoPath: string, linkId: string, workspaceDir?: string) =>
    workspaceDir ? c.workspaceLinks.deleteLink(repoPath, linkId, workspaceDir) : c.requirements.deleteLink(repoPath, linkId))

  // ── Liens inter-repos (GH105) ─────────────────────────────────────────────────
  r.handle('links:objects', (_e, repoPath: string, workspaceDir?: string) =>
    c.workspaceLinks.listObjects(repoPath, workspaceDir))

  r.handle('links:list', (_e, repoPath: string, workspaceDir?: string) =>
    c.workspaceLinks.listLinks(repoPath, workspaceDir))

  r.handle('links:types', (_e, repoPath: string, workspaceDir?: string) =>
    c.workspaceLinks.linkTypes(repoPath, workspaceDir))

  // ── Paramètres (T171) ───────────────────────────────────────────────────────
  r.handle('parameters:list', (_e, repoPath: string, workspaceDir?: string) =>
    c.parameters.list(repoPath, workspaceDir))
  r.handle('parameters:usages', (_e, repoPath: string, name: string, workspaceDir?: string) =>
    c.parameters.usages(repoPath, name, workspaceDir))
  r.handle('parameters:create', (_e, repoPath: string, param: Parameter, workspaceDir?: string) =>
    c.parameters.create(repoPath, param, workspaceDir))
  r.handle('parameters:update', (_e, repoPath: string, name: string, patch: Omit<Parameter, 'name'>, workspaceDir?: string) =>
    c.parameters.update(repoPath, name, patch, workspaceDir))
  r.handle('parameters:delete', (_e, repoPath: string, name: string, workspaceDir?: string) =>
    c.parameters.delete(repoPath, name, workspaceDir))

  // ── Tests ────────────────────────────────────────────────────────────────────
  r.handle('tests:list', (_e, repoPath: string) => c.tests.findAll(repoPath))
  r.handle('tests:get', (_e, repoPath: string, id: string) =>
    c.tests.findOne(repoPath, id))
  r.handle('tests:create', (_e, repoPath: string, dto: unknown, workspaceDir?: string) =>
    c.tests.create(repoPath, dto as CreateTestCaseDto, workspaceDir))
  r.handle('tests:update', (_e, repoPath: string, id: string, dto: unknown, workspaceDir?: string) =>
    c.tests.update(repoPath, id, dto as UpdateTestCaseDto, workspaceDir))
  r.handle('tests:execute', async (_e, repoPath: string, tcId: string, dto: unknown, workspaceDir?: string) => {
    const exec = dto as ExecuteTestCaseDto
    // GH196 — exécution saisie dans l'application : testeur = identité git de l'utilisateur (le classeur
    // importé fournit le sien, libre : un technicien n'a pas forcément de compte).
    const executedBy = exec.executedBy || (await c.auth.getAuthor(repoPath).catch(() => null))?.name || undefined
    return c.tests.execute(repoPath, tcId, { ...exec, ...(executedBy && { executedBy }) }, workspaceDir)
  })
  r.handle('tests:runs', (_e, repoPath: string, tcId: string) =>
    c.tests.findRuns(repoPath, tcId))
  // GH198 — changes (repoPath = repo de stockage pour get / update / delete / candidats).
  r.handle('changes:list', (_e, repoPath: string, workspaceDir?: string) => c.changes.list(repoPath, workspaceDir))
  r.handle('changes:get', (_e, repoPath: string, id: string) => c.changes.get(repoPath, id))
  r.handle('changes:create', (_e, repoPath: string, dto: CreateChangeDto, workspaceDir?: string) => c.changes.create(repoPath, dto, workspaceDir))
  r.handle('changes:update', (_e, repoPath: string, id: string, dto: UpdateChangeDto) => c.changes.update(repoPath, id, dto))
  r.handle('changes:delete', (_e, repoPath: string, id: string) => c.changes.delete(repoPath, id))
  r.handle('changes:reopened-candidates', (_e, repoPath: string, id: string) => c.changes.reopenedCandidates(repoPath, id))
  // GH197 — historique des exécutions d'un test ou d'une exigence (lecture seule).
  r.handle('executions:history', (_e, repoPath: string, target: ExecutionHistoryTarget, workspaceDir?: string) =>
    c.executionHistory.history(repoPath, target, workspaceDir))
  // GH196 — type d'un test (champs d'exécution / d'étape), schéma du composant compris.
  r.handle('tests:type-def', (_e, repoPath: string, objectTypeRef: string, workspaceDir?: string) =>
    c.tests.typeDefFor(repoPath, objectTypeRef, workspaceDir))
  r.handle('tests:open-draft', (_e, repoPath: string, id: string, targetStatus: string, workspaceDir?: string, comment?: string) =>
    c.tests.openDraft(repoPath, id, targetStatus, workspaceDir, comment))

  // ── Traceability ─────────────────────────────────────────────────────────────
  r.handle('traceability:matrix', (_e, repoPath: string, filters?: unknown, workspaceDir?: string) =>
    c.traceability.getMatrix(repoPath, (filters as MatrixFiltersDto | undefined) ?? {}, workspaceDir))
  r.handle('traceability:missing-links', (_e, repoPath: string, workspaceDir?: string) =>
    c.traceability.getMissingLinks(repoPath, workspaceDir))
  r.handle('traceability:impact', (_e, repoPath: string, reqId: string, depth?: number, workspaceDir?: string) =>
    c.traceability.getImpactReport(repoPath, reqId, depth ?? 1, workspaceDir))
  r.handle('traceability:acknowledge', (_e, repoPath: string, reqId: string, dto: unknown) =>
    c.traceability.acknowledgeImpact(repoPath, reqId, dto as AcknowledgeImpactDto))
  r.handle('traceability:test-plan', (_e, repoPath: string, dto: unknown, workspaceDir?: string) =>
    c.traceability.generateTestPlan(repoPath, dto as GenerateTestPlanDto, workspaceDir))
  r.handle('traceability:export-csv', (_e, repoPath: string, filters?: unknown, workspaceDir?: string) =>
    c.traceability.exportCsv(repoPath, (filters as MatrixFiltersDto | undefined) ?? {}, workspaceDir))
  r.handle('traceability:diff-requirements', (_e, repoPath: string, fromSha: string, toSha: string) =>
    c.traceability.diffRequirementsBetweenRefs(repoPath, fromSha, toSha))

  // ── Analyse d'impact (T46) ──────────────────────────────────────────────────────
  r.handle('impact-analysis:create', (_e, repoPath: string, dto: unknown) =>
    c.traceability.createImpactAnalysis(repoPath, dto as CreateImpactAnalysisDto))
  r.handle('impact-analysis:local', (_e, repoPath: string, workspaceDir?: string) =>
    c.traceability.computeLocalImpactAnalysis(repoPath, workspaceDir))
  r.handle('impact-analysis:list', (_e, repoPath: string) =>
    c.traceability.listImpactAnalyses(repoPath))
  r.handle('impact-analysis:get', (_e, repoPath: string, id: string) =>
    c.traceability.getImpactAnalysis(repoPath, id))
  r.handle('impact-analysis:update-status', (_e, repoPath: string, id: string, dto: unknown) =>
    c.traceability.updateImpactItemStatus(repoPath, id, dto as UpdateImpactItemStatusDto))
  r.handle('impact-analysis:delete', (_e, repoPath: string, id: string) =>
    c.traceability.deleteImpactAnalysis(repoPath, id))

  // ── Revalidation (T173) — levée du flag needsRevalidation ──────────────────────
  r.handle('revalidation:list', (_e, repoPath: string, workspaceDir?: string) =>
    c.revalidation.listFlagged(repoPath, workspaceDir))
  r.handle('revalidation:clear', (_e, repoPath: string, ids: unknown, workspaceDir?: string) => {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      throw new Error('revalidation:clear — ids must be a string array')
    }
    return c.revalidation.clear(repoPath, ids, workspaceDir)
  })

  // ── Historique des champs suivis (GH77) — lecture effective, entrées implicites marquées ──
  r.handle('history:get', (_e, repoPath: string, kind: HistoryObjectKind, id: string) =>
    readEffectiveHistory(c, repoPath, kind, id))
  r.handle('history:backfill', (_e, repoPath: string) => c.historyBackfill.run(repoPath))

  // ── Reviews ───────────────────────────────────────────────────────────────────
  r.handle('reviews:list', (_e, repoPath: string, status?: unknown) =>
    c.reviews.list(repoPath, status as ReviewStatus | undefined))
  r.handle('reviews:get', (_e, repoPath: string, id: string) =>
    c.reviews.findById(repoPath, id))
  r.handle('reviews:create', (_e, repoPath: string, dto: unknown) =>
    c.reviews.create(repoPath, dto as CreateReviewDto))
  r.handle('reviews:approve-object',
    (_e, repoPath: string, reviewId: string, objectId: string, reviewerId: string) =>
      c.reviews.approveObject(repoPath, reviewId, objectId, reviewerId))
  r.handle('reviews:revoke-approval',
    (_e, repoPath: string, reviewId: string, objectId: string, reviewerId: string) =>
      c.reviews.revokeApproval(repoPath, reviewId, objectId, reviewerId))
  r.handle('reviews:close',
    (_e, repoPath: string, reviewId: string, status: unknown) =>
      c.reviews.close(repoPath, reviewId, status as 'approved' | 'closed'))

  // ── Schema ───────────────────────────────────────────────────────────────────
  r.handle('schema:get', (_e, repoPath: string) => c.schema.get(repoPath))
  r.handle('schema:get-at', (_e, repoPath: string, ref: string) => c.schema.getAt(repoPath, ref))
  r.handle('schema:save', (_e, repoPath: string, schema: unknown) =>
    c.schema.save(repoPath, schema as import('@polenta/types').ProjectSchema))
  // GH77 — après l'enregistrement d'un type dont des champs ont été renommés : migre valeur et historique.
  r.handle('schema:rename-fields', (_e, repoPath: string, objectTypeRef: string, renames: unknown) => {
    if (typeof objectTypeRef !== 'string' || !objectTypeRef.includes('::')) {
      throw new Error('schema:rename-fields — objectTypeRef must be "<node>::<type>"')
    }
    if (!Array.isArray(renames) || !renames.every(r => typeof r?.from === 'string' && typeof r?.to === 'string')) {
      throw new Error('schema:rename-fields — renames must be an array of { from, to } strings')
    }
    return c.fieldRename.renameFields(repoPath, objectTypeRef, renames as import('@polenta/types').FieldRename[])
  })
  // GH82 — renommage de statuts / valeurs d'enum : aperçu (sans écriture) puis migration.
  r.handle('schema:preview-value-renames', (_e, repoPath: string, objectTypeRef: string, renames: unknown) =>
    c.fieldRename.previewValueRenames(repoPath, ...checkValueRenames('schema:preview-value-renames', objectTypeRef, renames)))
  r.handle('schema:rename-values', (_e, repoPath: string, objectTypeRef: string, renames: unknown) =>
    c.fieldRename.renameValues(repoPath, ...checkValueRenames('schema:rename-values', objectTypeRef, renames)))
  // GH100 — renommage d'un type (nom / préfixe) : aperçu (sans écriture) puis migration.
  r.handle('schema:preview-type-rename', (_e, repoPath: string, workspaceDir: string | undefined, dto: unknown) =>
    c.typeRename.plan(repoPath, workspaceDir || undefined, checkTypeRename('schema:preview-type-rename', dto)))
  r.handle('schema:rename-type', (_e, repoPath: string, workspaceDir: string | undefined, dto: unknown) =>
    c.typeRename.rename(repoPath, workspaceDir || undefined, checkTypeRename('schema:rename-type', dto)))
  // GH104 — suppression en cascade d'un composant local ou d'un type : aperçu, puis exécution.
  r.handle('schema:preview-delete', (_e, repoPath: string, workspaceDir: string | undefined, target: unknown) =>
    c.schemaDelete.plan(repoPath, workspaceDir || undefined, checkDeleteTarget('schema:preview-delete', target)))
  r.handle('schema:delete', (_e, repoPath: string, workspaceDir: string | undefined, target: unknown) =>
    c.schemaDelete.delete(repoPath, workspaceDir || undefined, checkDeleteTarget('schema:delete', target)))
  // Drops the in-memory cache entry so the next `schema:get` re-reads schema.yaml from disk —
  // needed because SchemaService.get() otherwise serves the cached copy forever within a
  // session, even after an out-of-band edit to the file (manual edit, git checkout/pull…).
  r.handle('schema:invalidate', (_e, repoPath: string) => c.schema.invalidate(repoPath))
  // T135 sprint 3 — drag & drop d'un élément (exigence/test/campagne) vers un autre nœud du
  // même repo : mutation du schéma côté main process, suivie d'une cascade best-effort sur les
  // requirements/tests existants et le fichier d'ordre d'affichage (cf. element-move.service.ts).
  // La mutation de schéma elle-même est la seule étape all-or-nothing — au-delà, un échec
  // partiel de la cascade est rapporté à l'appelant plutôt que de tout annuler.
  r.handle('schema:move-element',
    (_e, repoPath: string, dto: { fromNodeName: string; toNodeName: string; typeName: string }) =>
      c.elementMove.moveElementToNode(repoPath, dto))

  // ── Campaigns ────────────────────────────────────────────────────────────────
  r.handle('campaigns:list', (_e, repoPath: string, component?: string, level?: string) =>
    c.campaigns.list(repoPath, component, level))
  r.handle('campaigns:get', (_e, repoPath: string, id: string) =>
    c.campaigns.get(repoPath, id))
  r.handle('campaigns:create', (_e, repoPath: string, dto: unknown, workspaceDir?: string) =>
    c.campaigns.create(repoPath, dto as import('@polenta/types').CreateCampaignDto, workspaceDir))
  r.handle('campaigns:update', (_e, repoPath: string, id: string, dto: unknown) =>
    c.campaigns.update(repoPath, id, dto as import('@polenta/types').UpdateCampaignDto))
  // GH81 — `displayed` : version du test affichée par la page d'exécution, figée sur une instance
  // resynchronisable (GH68) dans la même écriture que le résultat.
  r.handle('campaigns:update-run',
    (_e, repoPath: string, campaignId: string, entryId: string, status: unknown, runId: string, displayed?: unknown) =>
      // GH73 — `runId` obligatoire et résultat valide : vérifiés par le service (canal non typé).
      c.campaigns.updateRun(repoPath, campaignId, entryId, status as import('@polenta/types').TestRunResult, runId,
        displayed ? { testSnapshot: displayed as import('@polenta/types').TestCase } : undefined))
  r.handle('campaigns:close',
    (_e, repoPath: string, id: string, status: unknown) =>
      c.campaigns.close(repoPath, id, status as 'completed' | 'abandoned'))
  r.handle('campaigns:add-tests',
    (_e, repoPath: string, campaignId: string, testCaseIds: string[], paramValuesByTest?: Record<string, Record<string, string>>, workspaceDir?: string, reqInstances?: import('@polenta/types').ReqInstanceSelection, carried?: import('@polenta/types').CarriedEntrySelection[]) =>
      c.campaigns.addTests(repoPath, campaignId, testCaseIds, paramValuesByTest, workspaceDir, reqInstances, carried))
  r.handle('campaigns:remove-entries',
    (_e, repoPath: string, campaignId: string, entryIds: string[]) =>
      c.campaigns.removeEntries(repoPath, campaignId, entryIds))
  r.handle('campaigns:duplicate-test',
    (_e, repoPath: string, campaignId: string, testCaseId: string, paramValues: Record<string, string>, workspaceDir?: string, requirementId?: string) =>
      c.campaigns.duplicateTest(repoPath, campaignId, testCaseId, paramValues, workspaceDir, requirementId))
  // T171 — résolution prévisionnelle des paramètres (panneau d'ajout, création), sans écriture.
  r.handle('campaigns:preview-params',
    (_e, repoPath: string, source: { campaignId?: string; baselineRef?: string }, testCaseIds: string[], workspaceDir?: string) =>
      c.campaigns.previewParams(repoPath, source, testCaseIds, workspaceDir))
  r.handle('campaigns:update-run-params',
    (_e, repoPath: string, campaignId: string, entryId: string, paramValues: Record<string, string>) =>
      c.campaigns.updateRunParams(repoPath, campaignId, entryId, paramValues))
  r.handle('campaigns:delete',
    (_e, repoPath: string, id: string) =>
      c.campaigns.delete(repoPath, id))
  r.handle('campaigns:execution-sheet-apply',
    (_e, repoPath: string, campaignId: string, filePath: string, workspaceDir?: string) =>
      c.campaignExecution.apply(repoPath, campaignId, filePath, workspaceDir))

  // ── Baselines ────────────────────────────────────────────────────────────────
  r.handle('baseline:list', (_e, repoPath: string, components?: import('../services/baseline.service').BaselineComponentRef[]) =>
    c.baseline.list(repoPath, components))
  r.handle('baseline:get', (_e, repoPath: string, tag: string, components?: import('../services/baseline.service').BaselineComponentRef[]) =>
    c.baseline.get(repoPath, tag, components))
  r.handle('baseline:get-integration-branch', (_e, repoPath: string) => c.git.getIntegrationBranch(repoPath))
  /** @deprecated GH106 — écriture non commitée, plus appelée par le renderer : `integration:designate`. */
  r.handle('baseline:set-integration-branch', (_e, repoPath: string, branch: string) => c.git.setIntegrationBranch(repoPath, branch))

  // ── Branche d'intégration (GH106) ────────────────────────────────────────────
  r.handle('integration:state', (_e, repoPath: string) => c.integration.state(repoPath))
  r.handle('integration:designate', (_e, repoPath: string, branch: string) => c.integration.designate(repoPath, branch))
  r.handle('integration:create', (_e, repoPath: string, suffix: string, from?: { tag: string }) =>
    c.integration.createAndDesignate(repoPath, suffix, from))
  r.handle('baseline:delete', (_e, repoPath: string, tag: string, components?: import('../services/baseline.service').BaselineComponentRef[]) =>
    c.baseline.delete(repoPath, tag, components))
  r.handle('baseline:create', async (_e, repoPath: string, dto: import('../services/baseline.service').CreateBaselineDto, workspaceDir?: string) => {
    // Create a tag on the main repo — annotated (carries the baseline message) when one was given
    const message = dto.message?.trim() ?? ''
    if (message) {
      await c.sync.createAnnotatedTag(repoPath, dto.tag, message)
    } else {
      await c.sync.createTag(repoPath, dto.tag)
    }

    // T69 Sprint 3 / T79: tag every component repo requested in dto.components (not every node
    // in the cached workspace tree — dto.components is what the caller actually validated as
    // ready). Only components that are actually tagged successfully end up in the returned
    // record, so the caller can detect and warn about partial failures.
    const taggedComponents: import('../services/baseline.service').BaselineComponentRecord[] = []
    if (workspaceDir && dto.components.length > 0) {
      const tree = await c.workspaceTree.readCache(workspaceDir)
      const nodeByName = new Map((tree?.nodes ?? []).map(node => [node.name, node]))
      for (const comp of dto.components) {
        const node = nodeByName.get(comp.name)
        if (!node) {
          console.warn(`[baseline:create] Component ${comp.name} not found in workspace tree`)
          continue
        }
        try {
          await c.sync.createTag(node.repoPath, comp.tag)
          console.log(`[baseline:create] Tagged component repo ${comp.name} @ ${comp.tag}`)
          taggedComponents.push({ name: comp.name, tag: comp.tag })
        } catch (err) {
          // Non-fatal: log and continue — the baseline record is still created
          console.warn(`[baseline:create] Could not tag ${comp.name}:`, err)
        }
      }
    }

    return {
      tag: dto.tag,
      createdAt: new Date().toISOString(),
      message,
      components: taggedComponents,
    } satisfies import('../services/baseline.service').BaselineRecord
  })


  // ── Draw.io (T47) ────────────────────────────────────────────────────────────
  // GH178 — `ref` : lu à cette version git (vues de diff) ; absent / null = working tree.
  r.handle('drawio:read', async (_e, repoPath: string, relativePath: string, ref?: string | null) => {
    const bytes = await readFileAt(repoPath, ref ?? null, relativePath)
    return bytes ? parseDrawioPages(new TextDecoder().decode(bytes)) : null
  })

  // ── Image (T76) ──────────────────────────────────────────────────────────────
  r.handle('image:read', async (_e, repoPath: string, relativePath: string, ref?: string | null) => {
    const ext = path.extname(relativePath).toLowerCase().replace('.', '')
    const mimeType = IMAGE_MIME_BY_EXT[ext] ?? 'image/png'
    const bytes = await readFileAt(repoPath, ref ?? null, relativePath)
    return bytes ? { mimeType, base64: Buffer.from(bytes).toString('base64') } : null
  })
  r.handle('image:write-paste', async (_e, repoPath: string, mimeType: string, base64: string) => {
    try {
      const ext = IMAGE_EXT_BY_MIME[mimeType] ?? 'png'
      const imagesDir = path.join(repoPath, 'images')
      await fsP.mkdir(imagesDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const destName = await findAvailableFileName(imagesDir, `image-${stamp}.${ext}`)
      await fsP.writeFile(path.join(imagesDir, destName), Buffer.from(base64, 'base64'))
      return { status: 'ok' as const, path: `images/${destName}` }
    } catch {
      return { status: 'error' as const, message: "Impossible d'écrire l'image collée dans le repo." }
    }
  })

  // ── Tree ─────────────────────────────────────────────────────────────────────
  r.handle('tree:get', (_e, repoPath: string, nodeId: string, typeId: string) =>
    c.tree.get(repoPath, nodeId, typeId))
  r.handle('tree:save', (_e, repoPath: string, tree: unknown) =>
    c.tree.save(repoPath, tree as import('@polenta/types').TypeTree))
  r.handle('tree:generate-id', () =>
    c.tree.generateId())

  // ── Flat workspace (T69 Sprint 1) ─────────────────────────────────────────────
  r.handle('workspace:detect', (_e, dir: string) =>
    c.workspace.detectWorkspace(dir))
  r.handle('workspace:init', (_e, workspaceDir: string, rootRepoPath: string) =>
    c.workspace.initWorkspace(workspaceDir, rootRepoPath))
  r.handle('workspace:open', (_e, workspaceDir: string) =>
    c.workspace.openWorkspace(workspaceDir))

  // ── Flat workspace (T69 Sprint 2) ─────────────────────────────────────────────
  r.handle('workspace:get-tree', (_e, workspaceDir: string) =>
    c.workspace.getCacheTree(workspaceDir))
  r.handle('workspace:rebuild-tree', (_e, workspaceDir: string) =>
    c.workspace.rebuildTree(workspaceDir))
  r.handle('workspace:set-mount-override', (_e, workspaceDir: string, override: unknown) =>
    c.workspace.setMountOverride(workspaceDir, override as import('@polenta/types').MountOverride))
  // T74: physically delete a dependency's cloned directory (renderer always removes its
  // polenta-repo.yaml reference and rebuilds the tree first — see workspaceActions.ts).
  r.handle('workspace:remove-repo-dir', (_e, repoPath: string) =>
    c.workspaceTree.removeClonedRepo(repoPath))
  // T74 sprint 2: physically rename a dependency's mount directory (renderer does this before
  // any manifest write — see workspaceActions.ts).
  r.handle('workspace:rename-repo-dir', (_e, workspaceDir: string, oldMountName: string, newMountName: string) =>
    c.workspaceTree.renameClonedRepo(workspaceDir, oldMountName, newMountName))

  // ── PolentaRepo (T69 Sprint 1) ────────────────────────────────────────────────
  r.handle('polenta-repo:get', (_e, repoPath: string) =>
    c.polentaRepo.readManifest(repoPath))
  r.handle('polenta-repo:save', (_e, repoPath: string, manifest: unknown) =>
    c.polentaRepo.writeManifest(repoPath, manifest as import('@polenta/types').PolentaRepoManifest))

  // ── Interface compliance (T69 Sprint 4) ────────────────────────────────────────
  r.handle('interface:compliance-matrix', (_e, workspaceDir: string) =>
    c.interfaceCompliance.getComplianceMatrix(workspaceDir))
  r.handle('interface:coverage', (
    _e,
    componentRepoPath: string,
    interfaceRepoPath: string,
    roles: string[],
  ) =>
    c.interfaceCompliance.checkComponentCoverage(componentRepoPath, interfaceRepoPath, roles))

  // ── Vue Suivi : exécution des scripts, drill-down, modèles (GH74) ───────────
  r.handle('suivi:run', (_e, repoPath: string, workspaceDir: string | undefined, username: string, req: unknown, client: unknown) =>
    c.suivi.run(repoPath, workspaceDir, username, (req ?? {}) as ScriptRunRequest, (client ?? { locale: 'fr', timezone: 'UTC' }) as ScriptClientInfo))
  r.handle('suivi:describe-ids', (_e, repoPath: string, workspaceDir: string | undefined, ids: unknown, locale?: string) =>
    c.suivi.describeIds(repoPath, workspaceDir, Array.isArray(ids) ? ids.map(String) : [], locale))
  r.handle('suivi:resolve-target', (_e, repoPath: string, workspaceDir: string | undefined, id: string) =>
    c.suivi.resolveTarget(repoPath, workspaceDir, String(id)))
  r.handle('suivi:templates', () => c.suivi.templates())
  r.handle('suivi:render-template', (_e, kind: unknown, input: unknown) =>
    c.suivi.renderTemplate(kind === 'query' ? 'query' : 'widget', input as TemplateInput))
  r.handle('suivi:object-types', (_e, repoPath: string, workspaceDir?: string) =>
    c.suivi.objectTypes(repoPath, workspaceDir))
  // GH74 §6.3 — bandeau des mises à jour.
  r.handle('suivi:updates-list', (_e, repoPath: string, username: string, locale?: string) =>
    c.suiviUpdates.list(repoPath, username, typeof locale === 'string' ? locale : undefined))
  r.handle('suivi:updates-apply', (_e, repoPath: string, username: string, ids: unknown, locale?: string) =>
    c.suiviUpdates.apply(repoPath, username, Array.isArray(ids) ? ids.map(String) : [], typeof locale === 'string' ? locale : undefined))
  r.handle('suivi:updates-ignore', (_e, repoPath: string, username: string, id: unknown, toVersion: unknown) =>
    c.suiviUpdates.ignore(repoPath, username, String(id), Number(toVersion)))

  // ── Requêtes (T77, GH74 : scripts de données) ───────────────────────────────
  r.handle('queries:list', (_e, repoPath: string, username: string) =>
    c.savedQueries.list(repoPath, username))
  r.handle('queries:create', (_e, repoPath: string, username: string, dto: unknown) =>
    c.savedQueries.create(repoPath, username, dto as CreateSavedQueryDto))
  r.handle('queries:update', (_e, repoPath: string, username: string, id: string, dto: unknown) =>
    c.savedQueries.update(repoPath, username, id, dto as UpdateSavedQueryDto))
  r.handle('queries:delete', (_e, repoPath: string, username: string, id: string) =>
    c.savedQueries.delete(repoPath, username, id))
  r.handle('queries:history-list', (_e, repoPath: string, username: string) =>
    c.savedQueries.listHistory(repoPath, username))
  r.handle('queries:history-add', (_e, repoPath: string, username: string, entry: unknown) =>
    c.savedQueries.addHistoryEntry(repoPath, username, entry as AddHistoryEntryDto))
  r.handle('queries:history-delete', (_e, repoPath: string, username: string, id: string) =>
    c.savedQueries.deleteHistoryEntry(repoPath, username, id))
  r.handle('queries:order-get', (_e, repoPath: string, username: string) =>
    c.savedQueries.getQueriesOrder(repoPath, username))
  r.handle('queries:order-set', (_e, repoPath: string, username: string, order: string[]) =>
    c.savedQueries.setQueriesOrder(repoPath, username, order))
  r.handle('queries:set-scope', (_e, repoPath: string, username: string, id: string, scope: unknown) =>
    c.savedQueries.setScope(repoPath, username, id, scope as QueryScope))

  // ── Dashboards & widgets (T77 sprint 2, seed sprint 3) ───────────────────────
  r.handle('dashboards:list', async (_e, repoPath: string, username: string, locale?: string) => {
    // Seed the 3 pre-configured shared dashboards on first access (empty `dashboards/`
    // folder, never seeded before) — server-side, ahead of every list() call, so it's
    // reliable regardless of which UI entry point triggers the panel's first load
    // (T77 sprint 3 — see dashboard-seed.service.ts for the "once only" guarantee).
    // GH65 — `locale` : langue des libellés du dashboard « Campagnes » (seed indépendant).
    await c.dashboardSeed.ensureSeeded(repoPath, username, typeof locale === 'string' ? locale : undefined)
    return c.dashboards.list(repoPath, username)
  })
  r.handle('dashboards:get', (_e, repoPath: string, username: string, id: string) =>
    c.dashboards.get(repoPath, username, id))
  r.handle('dashboards:create', (_e, repoPath: string, username: string, dto: unknown) =>
    c.dashboards.create(repoPath, username, dto as CreateDashboardDto))
  r.handle('dashboards:update', (_e, repoPath: string, username: string, id: string, dto: unknown) =>
    c.dashboards.update(repoPath, username, id, dto as UpdateDashboardDto))
  r.handle('dashboards:delete', (_e, repoPath: string, username: string, id: string) =>
    c.dashboards.delete(repoPath, username, id))
  r.handle('dashboards:set-scope', (_e, repoPath: string, username: string, id: string, scope: unknown) =>
    c.dashboards.setScope(repoPath, username, id, scope as QueryScope))
  r.handle('dashboards:add-widget', (_e, repoPath: string, username: string, dashboardId: string, dto: unknown) =>
    c.dashboards.addWidget(repoPath, username, dashboardId, dto as AddWidgetDto))
  r.handle(
    'dashboards:update-widget',
    (_e, repoPath: string, username: string, dashboardId: string, widgetId: string, dto: unknown) =>
      c.dashboards.updateWidget(repoPath, username, dashboardId, widgetId, dto as UpdateWidgetDto),
  )
  r.handle(
    'dashboards:delete-widget',
    (_e, repoPath: string, username: string, dashboardId: string, widgetId: string) =>
      c.dashboards.deleteWidget(repoPath, username, dashboardId, widgetId),
  )
  r.handle(
    'dashboards:set-widget-order',
    (_e, repoPath: string, username: string, dashboardId: string, order: string[]) =>
      c.dashboards.setWidgetOrder(repoPath, username, dashboardId, order),
  )
  r.handle('dashboards:order-get', (_e, repoPath: string, username: string) =>
    c.dashboards.getDashboardsOrder(repoPath, username))
  r.handle('dashboards:order-set', (_e, repoPath: string, username: string, order: string[]) =>
    c.dashboards.setDashboardsOrder(repoPath, username, order))
  // GH93 — valeurs choisies dans la barre de paramètres (`.pref` de l'utilisateur, jamais commité).
  r.handle('dashboards:param-values-get', (_e, repoPath: string, username: string, dashboardId: string) =>
    c.dashboards.getParamValues(repoPath, username, dashboardId))
  r.handle('dashboards:param-values-set', (_e, repoPath: string, username: string, dashboardId: string, values: Record<string, unknown> | null) =>
    c.dashboards.setParamValues(repoPath, username, dashboardId, values))

  // ── Git (T43) ────────────────────────────────────────────────────────────────
  r.handle('git:head-sha', (_e, repoPath: string) => c.git.headSha(repoPath))

  // ── Export (T43) ─────────────────────────────────────────────────────────────
  // GH34 — gabarits de la bibliothèque (préférence application) pour un format.
  r.handle('export-templates:list', (_e, format: TemplateExportFormat) => c.exportTemplateLibrary.list(format))
  r.handle('export-templates:install-examples', () =>
    c.exportTemplateLibrary.installExamples(platform.exportTemplateExamplesDir()))

  registerPrefHandlers(r)
}
