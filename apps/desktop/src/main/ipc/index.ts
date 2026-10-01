import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { registerPrefHandlers } from './pref.handlers'
import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import git from 'isomorphic-git'
import type { AuthService } from '../services/auth.service'
import type { GitService } from '../services/git.service'
import type { SyncService } from '../services/sync.service'
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
import type { PolentaRepoService } from '../services/polenta-repo.service'
import type { WorkspaceTreeService } from '../services/workspace-tree.service'
import type { InterfaceComplianceService } from '../services/interface-compliance.service'
import type { QueryEngineService } from '../services/query-engine.service'
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
  QueryDefinition,
  BuilderConfig,
  QueryScope,
  CreateImpactAnalysisDto,
  UpdateImpactItemStatusDto,
  ExportKind,
  TemplateExportFormat,
  ExportFormat,
  Parameter,
  AppSettings,
} from '@polenta/types'
import type { RequirementFilters } from '../services/requirements-index.service'
import type { CreateReviewDto } from '../services/reviews.service'
import type { TreeService } from '../services/tree.service'
import type { BaselineService } from '../services/baseline.service'
import type { AppSettingsService } from '../services/app-settings.service'
import type { ExportTemplateLibrary } from '../services/export-template-library'
import type { UpdateService } from '../services/update.service'
import { parseDrawioPages } from '../drawio-xml'

export interface Container {
  auth: AuthService
  git: GitService
  sync: SyncService
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
  tree: TreeService
  baseline: BaselineService
  polentaRepo: PolentaRepoService
  workspaceTree: WorkspaceTreeService
  interfaceCompliance: InterfaceComplianceService
  queryEngine: QueryEngineService
  savedQueries: SavedQueriesService
  dashboards: DashboardsService
  dashboardSeed: DashboardSeedService
  export: ExportService
  parameters: ParametersService
  revalidation: RevalidationService
  appSettings: AppSettingsService
  exportTemplateLibrary: ExportTemplateLibrary
  update: UpdateService
}

// Deux tables distinctes (pas une dérivée de l'autre) : la relation n'est pas
// bijective — `jpg` et `jpeg` pointent tous deux vers `image/jpeg`, mais
// l'extension de sortie choisie pour ce MIME (fichier collé, T76) doit rester
// `jpg` de façon stable, pas dépendre de l'ordre d'itération d'une inversion.
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
}
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'image/webp': 'webp',
}

const EXPORT_DIALOG_FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  xlsx: { name: 'Excel', extensions: ['xlsx'] },
  docx: { name: 'Word', extensions: ['docx'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
}

// Renvoie `baseName` s'il est libre dans `dir`, sinon `stem-1.ext`, `stem-2.ext`, etc.
async function findAvailableFileName(dir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName)
  const stem = path.basename(baseName, ext)
  let candidate = baseName
  for (let i = 1; ; i++) {
    try {
      await fsP.access(path.join(dir, candidate))
      candidate = `${stem}-${i}${ext}`
    } catch {
      return candidate
    }
  }
}

export function registerIpcHandlers(c: Container): void {
  // ── Live sync ────────────────────────────────────────────────────────────────
  // Pushes every out-of-band file change (external edit, git checkout/pull, a bulk-import
  // script writing directly to disk…) to every open window, so the renderer can invalidate
  // the affected react-query caches on its own — see useLiveFileSync.ts for the mapping
  // from `relPath` to query keys. `BrowserWindow.getAllWindows()` rather than threading a
  // window reference through the DI container: this module has no `win` at construction
  // time (registerIpcHandlers runs from createContainer(), before createAppWindow()).
  c.watcher.onFileChange((repoPath, relPath) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('repo:file-changed', repoPath, relPath)
    }
  })

  // ── Workspace (projects) ───────────────────────────────────────────────────────
  ipcMain.handle('workspace:list-recents', () => c.workspace.listRecents())
  ipcMain.handle('workspace:mark-recent', (_e, workspaceDir: string) =>
    c.workspace.markRecent(workspaceDir))
  ipcMain.handle('workspace:get-last-opened', () => c.workspace.getLastOpened())
  ipcMain.handle('workspace:clear-last-opened', () => c.workspace.clearLastOpened())
  ipcMain.handle('workspace:resolve', (_e, workspaceDir: string) =>
    c.workspace.resolve(workspaceDir))
  ipcMain.handle('workspace:open-project', (_e, dir: string) =>
    c.workspace.openProject(dir))
  ipcMain.handle('workspace:create-new', (_e, containerDir: string, name: string) =>
    c.workspace.createNewProject(containerDir, name))
  ipcMain.handle('workspace:create-from-clone', (_e, containerDir: string, remoteUrl: string) =>
    c.workspace.createFromClone(containerDir, remoteUrl))
  ipcMain.handle('workspace:is-empty-dir', (_e, dir: string) =>
    c.workspace.isEmptyDir(dir))

  // ── Auth ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:has-any-account', () => c.auth.hasAnyAccount())
  ipcMain.handle('auth:setup', (_e, remote: string, pat: string) => c.auth.setup(remote, pat))
  ipcMain.handle('auth:save-token', (_e, remote: string, token: string) =>
    c.auth.saveToken(remote, token))
  ipcMain.handle('auth:get-token', (_e, remote: string) => c.auth.getToken(remote))
  ipcMain.handle('auth:delete-token', (_e, remote: string) => c.auth.deleteToken(remote))
  ipcMain.handle('auth:resolve-identity', (_e, remote: string) =>
    c.auth.resolveIdentity(remote))
  ipcMain.handle('auth:project-username', (_e, repoPath: string) =>
    c.auth.projectUsername(repoPath))
  ipcMain.handle('auth:device-flow-start', (_e, remote: string) => c.auth.startDeviceFlow(remote))
  ipcMain.handle('auth:device-flow-poll', (_e, remote: string, deviceCode: string) =>
    c.auth.pollDeviceFlow(remote, deviceCode))

  // ── Sync ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('sync:status', (_e, repoPath: string) => c.sync.status(repoPath))
  ipcMain.handle('sync:commit', (_e, repoPath: string, message: string) =>
    c.sync.commit(repoPath, message))
  ipcMain.handle('sync:push', (_e, repoPath: string) => c.sync.push(repoPath))
  ipcMain.handle('sync:pull', (_e, repoPath: string) => c.sync.pull(repoPath))
  ipcMain.handle('sync:fetch', (_e, repoPath: string, urlFallback: string, remote?: string) =>
    c.sync.fetch(repoPath, urlFallback, remote))
  ipcMain.handle('sync:fast-forward-branch',
    (_e, repoPath: string, branchName: string, remote?: string) =>
      c.sync.fastForwardBranch(repoPath, branchName, remote))
  ipcMain.handle('sync:pull-fast-forward-only', (_e, repoPath: string) => c.sync.pullFastForwardOnly(repoPath))
  ipcMain.handle('sync:log', async (_e, repoPath: string, limit = 20) => {
    const commits = await git.log({ fs, dir: repoPath, depth: limit })
    return commits.map((c: { oid: string; commit: { message: string; author: { name: string; timestamp: number } } }) => ({
      sha: c.oid,
      message: c.commit.message.split('\n')[0],
      author: c.commit.author.name,
      date: new Date(c.commit.author.timestamp * 1000).toISOString(),
    }))
  })
  ipcMain.handle('sync:checkout-commit', async (_e, repoPath: string, sha: string) => {
    await git.checkout({ fs, dir: repoPath, ref: sha })
  })
  ipcMain.handle('sync:stage', (_e, repoPath: string, filepath: string) =>
    c.sync.stage(repoPath, filepath))
  ipcMain.handle('sync:stage-all', (_e, repoPath: string) =>
    c.sync.stageAll(repoPath))
  ipcMain.handle('sync:unstage', (_e, repoPath: string, filepath: string) =>
    c.sync.unstage(repoPath, filepath))
  ipcMain.handle('sync:unstage-all', (_e, repoPath: string) =>
    c.sync.unstageAll(repoPath))
  ipcMain.handle('sync:discard', (_e, repoPath: string, filepath: string) =>
    c.sync.discard(repoPath, filepath))
  ipcMain.handle('sync:discard-all', (_e, repoPath: string) =>
    c.sync.discardAll(repoPath))
  ipcMain.handle('sync:graph', (_e, repoPath: string, limit?: number) =>
    c.sync.graph(repoPath, limit))
  ipcMain.handle('sync:tags', (_e, repoPath: string) =>
    c.sync.tags(repoPath))
  ipcMain.handle('sync:diff', (_e, repoPath: string, filepath: string) =>
    c.sync.diff(repoPath, filepath))
  ipcMain.handle('sync:branches', (_e, repoPath: string) =>
    c.sync.listBranches(repoPath))
  ipcMain.handle('sync:create-branch', (_e, repoPath: string, name: string) =>
    c.sync.createBranch(repoPath, name))
  ipcMain.handle('sync:checkout-branch', (_e, repoPath: string, name: string) =>
    c.sync.checkoutBranch(repoPath, name))
  ipcMain.handle('sync:delete-branch', (_e, repoPath: string, name: string) =>
    c.sync.deleteBranch(repoPath, name))
  ipcMain.handle('sync:commit-files', (_e: unknown, repoPath: string, sha: string) =>
    c.sync.commitFiles(repoPath, sha))
  ipcMain.handle('sync:commit-diff', (_e: unknown, repoPath: string, sha: string, filepath: string) =>
    c.sync.commitDiff(repoPath, sha, filepath))
  ipcMain.handle('sync:create-tag', (_e, repoPath: string, tagName: string) =>
    c.sync.createTag(repoPath, tagName))
  ipcMain.handle('sync:merge', (_e, repoPath: string, fromBranch: string) =>
    c.sync.merge(repoPath, fromBranch))
  ipcMain.handle('sync:merge-into', (_e, repoPath: string, fromBranch: string, intoBranch: string) =>
    c.sync.mergeInto(repoPath, fromBranch, intoBranch))
  ipcMain.handle('sync:create-branch-at', (_e, repoPath: string, name: string, sha: string) =>
    c.sync.createBranchAt(repoPath, name, sha))
  ipcMain.handle('sync:delete-remote-branch', (_e, repoPath: string, name: string, remote?: string) =>
    c.sync.deleteRemoteBranch(repoPath, name, remote))
  ipcMain.handle('sync:delete-tag', (_e, repoPath: string, tagName: string) =>
    c.sync.deleteTag(repoPath, tagName))
  ipcMain.handle('sync:push-branch', (_e, repoPath: string, branchName: string, remote?: string) =>
    c.sync.pushBranch(repoPath, branchName, remote))
  ipcMain.handle('sync:rebase', (_e, repoPath: string, onto: string) =>
    c.sync.rebase(repoPath, onto))
  ipcMain.handle('sync:diff-between', (_e, repoPath: string, sha1: string, sha2: string) =>
    c.sync.diffBetween(repoPath, sha1, sha2))
  ipcMain.handle('sync:diff-file-between', (_e, repoPath: string, sha1: string, sha2: string, filepath: string) =>
    c.sync.diffFileBetween(repoPath, sha1, sha2, filepath))
  ipcMain.handle('sync:resolve-refs', (_e, repoPath: string) =>
    c.sync.resolveRefs(repoPath))
  // sync:submodule-tags supprimé en T69 Sprint 3 — les submodules git ne sont plus utilisés.

  // ── App ───────────────────────────────────────────────────────────────────────
  ipcMain.handle('app:set-title', (_event, title: string) => {
    BrowserWindow.getFocusedWindow()?.setTitle(title)
  })
  // app.getVersion() lit le champ "version" de package.json (packagé dans app.asar par
  // electron-builder) — c'est aussi ce champ qui alimente le macro ${version} de
  // electron-builder.yml pour le nom de l'exe généré : une seule string à modifier à
  // chaque release.
  ipcMain.handle('app:get-version', () => app.getVersion())
  // GH26 — préférences de l'application (userData/app-settings.json, pas schema.yaml).
  ipcMain.handle('app:get-settings', () => c.appSettings.get())
  ipcMain.handle('app:set-settings', (_e, patch: Partial<AppSettings>) => c.appSettings.set(patch))
  // GH26 — restreint aux pages de release du repo : seul usage (lien « Voir les nouveautés »),
  // pas un ouvreur d'URL générique exposé au renderer.
  ipcMain.handle('app:open-release-page', (_e, url: string) => {
    if (url.startsWith('https://github.com/laurentolive/polenta/releases/')) return shell.openExternal(url)
  })

  // ── Update (GH26) ─────────────────────────────────────────────────────────────
  // État poussé aux fenêtres par 'update:state-changed' ; get-state couvre une fenêtre
  // montée après l'événement.
  ipcMain.handle('update:get-state', () => c.update.getState())
  ipcMain.handle('update:install', () => c.update.install())

  // ── Requirements ─────────────────────────────────────────────────────────────
  ipcMain.handle('requirements:list', (_e, repoPath: string, filters?: unknown) =>
    c.requirements.findAll(repoPath, (filters as RequirementFilters | undefined) ?? {}))

  ipcMain.handle('requirements:get', (_e, repoPath: string, id: string) =>
    c.requirements.findOne(repoPath, id))

  ipcMain.handle('requirements:create', (_e, repoPath: string, dto: unknown, workspaceDir?: string) =>
    c.requirements.create(repoPath, dto as CreateRequirementDto, workspaceDir))

  ipcMain.handle('requirements:update', (_e, repoPath: string, id: string, dto: unknown, workspaceDir?: string) =>
    c.requirements.update(repoPath, id, dto as UpdateRequirementDto, workspaceDir))

  ipcMain.handle('requirements:open-draft', (_e, repoPath: string, id: string, comment: string, workspaceDir?: string) =>
    c.requirements.openDraft(repoPath, id, comment, workspaceDir))

  ipcMain.handle('requirements:transition', (_e, repoPath: string, id: string, dto: unknown, workspaceDir?: string) =>
    c.requirements.transition(repoPath, id, dto as TransitionRequirementDto, workspaceDir))

  ipcMain.handle('requirements:versions', (_e, repoPath: string, id: string) =>
    c.requirements.findVersions(repoPath, id))

  ipcMain.handle('requirements:links', (_e, repoPath: string, id: string) =>
    c.requirements.findLinks(repoPath, id))

  ipcMain.handle('requirements:links-all', (_e, repoPath: string) =>
    c.requirements.findAllLinks(repoPath))

  ipcMain.handle('requirements:link-create', (_e, repoPath: string, data: { type: string; sourceId: string; targetId: string }) =>
    c.requirements.createLink(repoPath, data))

  ipcMain.handle('requirements:link-delete', (_e, repoPath: string, linkId: string) =>
    c.requirements.deleteLink(repoPath, linkId))

  // ── Paramètres (T171) ───────────────────────────────────────────────────────
  ipcMain.handle('parameters:list', (_e, repoPath: string, workspaceDir?: string) =>
    c.parameters.list(repoPath, workspaceDir))
  ipcMain.handle('parameters:usages', (_e, repoPath: string, name: string, workspaceDir?: string) =>
    c.parameters.usages(repoPath, name, workspaceDir))
  ipcMain.handle('parameters:create', (_e, repoPath: string, param: Parameter, workspaceDir?: string) =>
    c.parameters.create(repoPath, param, workspaceDir))
  ipcMain.handle('parameters:update', (_e, repoPath: string, name: string, patch: Omit<Parameter, 'name'>, workspaceDir?: string) =>
    c.parameters.update(repoPath, name, patch, workspaceDir))
  ipcMain.handle('parameters:delete', (_e, repoPath: string, name: string, workspaceDir?: string) =>
    c.parameters.delete(repoPath, name, workspaceDir))

  // ── Tests ────────────────────────────────────────────────────────────────────
  ipcMain.handle('tests:list', (_e, repoPath: string) => c.tests.findAll(repoPath))
  ipcMain.handle('tests:get', (_e, repoPath: string, id: string) =>
    c.tests.findOne(repoPath, id))
  ipcMain.handle('tests:create', (_e, repoPath: string, dto: unknown, workspaceDir?: string) =>
    c.tests.create(repoPath, dto as CreateTestCaseDto, workspaceDir))
  ipcMain.handle('tests:update', (_e, repoPath: string, id: string, dto: unknown, workspaceDir?: string) =>
    c.tests.update(repoPath, id, dto as UpdateTestCaseDto, workspaceDir))
  ipcMain.handle('tests:execute', (_e, repoPath: string, tcId: string, dto: unknown, workspaceDir?: string) =>
    c.tests.execute(repoPath, tcId, dto as ExecuteTestCaseDto, workspaceDir))
  ipcMain.handle('tests:runs', (_e, repoPath: string, tcId: string) =>
    c.tests.findRuns(repoPath, tcId))
  ipcMain.handle('tests:open-draft', (_e, repoPath: string, id: string, targetStatus: string, workspaceDir?: string) =>
    c.tests.openDraft(repoPath, id, targetStatus, workspaceDir))

  // ── Traceability ─────────────────────────────────────────────────────────────
  ipcMain.handle('traceability:matrix', (_e, repoPath: string, filters?: unknown, workspaceDir?: string) =>
    c.traceability.getMatrix(repoPath, (filters as MatrixFiltersDto | undefined) ?? {}, workspaceDir))
  ipcMain.handle('traceability:missing-links', (_e, repoPath: string, workspaceDir?: string) =>
    c.traceability.getMissingLinks(repoPath, workspaceDir))
  ipcMain.handle('traceability:impact', (_e, repoPath: string, reqId: string, depth?: number, workspaceDir?: string) =>
    c.traceability.getImpactReport(repoPath, reqId, depth ?? 1, workspaceDir))
  ipcMain.handle('traceability:acknowledge', (_e, repoPath: string, reqId: string, dto: unknown) =>
    c.traceability.acknowledgeImpact(repoPath, reqId, dto as AcknowledgeImpactDto))
  ipcMain.handle('traceability:test-plan', (_e, repoPath: string, dto: unknown, workspaceDir?: string) =>
    c.traceability.generateTestPlan(repoPath, dto as GenerateTestPlanDto, workspaceDir))
  ipcMain.handle('traceability:export-csv', (_e, repoPath: string, filters?: unknown, workspaceDir?: string) =>
    c.traceability.exportCsv(repoPath, (filters as MatrixFiltersDto | undefined) ?? {}, workspaceDir))
  ipcMain.handle('traceability:diff-requirements', (_e, repoPath: string, fromSha: string, toSha: string) =>
    c.traceability.diffRequirementsBetweenRefs(repoPath, fromSha, toSha))

  // ── Analyse d'impact (T46) ──────────────────────────────────────────────────────
  ipcMain.handle('impact-analysis:create', (_e, repoPath: string, dto: unknown) =>
    c.traceability.createImpactAnalysis(repoPath, dto as CreateImpactAnalysisDto))
  ipcMain.handle('impact-analysis:local', (_e, repoPath: string, workspaceDir?: string) =>
    c.traceability.computeLocalImpactAnalysis(repoPath, workspaceDir))
  ipcMain.handle('impact-analysis:list', (_e, repoPath: string) =>
    c.traceability.listImpactAnalyses(repoPath))
  ipcMain.handle('impact-analysis:get', (_e, repoPath: string, id: string) =>
    c.traceability.getImpactAnalysis(repoPath, id))
  ipcMain.handle('impact-analysis:update-status', (_e, repoPath: string, id: string, dto: unknown) =>
    c.traceability.updateImpactItemStatus(repoPath, id, dto as UpdateImpactItemStatusDto))
  ipcMain.handle('impact-analysis:delete', (_e, repoPath: string, id: string) =>
    c.traceability.deleteImpactAnalysis(repoPath, id))

  // ── Revalidation (T173) — levée du flag needsRevalidation ──────────────────────
  ipcMain.handle('revalidation:list', (_e, repoPath: string, workspaceDir?: string) =>
    c.revalidation.listFlagged(repoPath, workspaceDir))
  ipcMain.handle('revalidation:clear', (_e, repoPath: string, ids: unknown, workspaceDir?: string) => {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      throw new Error('revalidation:clear — ids must be a string array')
    }
    return c.revalidation.clear(repoPath, ids, workspaceDir)
  })

  // ── Reviews ───────────────────────────────────────────────────────────────────
  ipcMain.handle('reviews:list', (_e, repoPath: string, status?: unknown) =>
    c.reviews.list(repoPath, status as ReviewStatus | undefined))
  ipcMain.handle('reviews:get', (_e, repoPath: string, id: string) =>
    c.reviews.findById(repoPath, id))
  ipcMain.handle('reviews:create', (_e, repoPath: string, dto: unknown) =>
    c.reviews.create(repoPath, dto as CreateReviewDto))
  ipcMain.handle('reviews:approve-object',
    (_e, repoPath: string, reviewId: string, objectId: string, reviewerId: string) =>
      c.reviews.approveObject(repoPath, reviewId, objectId, reviewerId))
  ipcMain.handle('reviews:revoke-approval',
    (_e, repoPath: string, reviewId: string, objectId: string, reviewerId: string) =>
      c.reviews.revokeApproval(repoPath, reviewId, objectId, reviewerId))
  ipcMain.handle('reviews:close',
    (_e, repoPath: string, reviewId: string, status: unknown) =>
      c.reviews.close(repoPath, reviewId, status as 'approved' | 'closed'))

  // ── Schema ───────────────────────────────────────────────────────────────────
  ipcMain.handle('schema:get', (_e, repoPath: string) => c.schema.get(repoPath))
  ipcMain.handle('schema:save', (_e, repoPath: string, schema: unknown) =>
    c.schema.save(repoPath, schema as import('@polenta/types').ProjectSchema))
  // Drops the in-memory cache entry so the next `schema:get` re-reads schema.yaml from disk —
  // needed because SchemaService.get() otherwise serves the cached copy forever within a
  // session, even after an out-of-band edit to the file (manual edit, git checkout/pull…).
  ipcMain.handle('schema:invalidate', (_e, repoPath: string) => c.schema.invalidate(repoPath))
  // T135 sprint 3 — drag & drop d'un élément (exigence/test/campagne) vers un autre nœud du
  // même repo : mutation du schéma côté main process, suivie d'une cascade best-effort sur les
  // requirements/tests existants et le fichier d'ordre d'affichage (cf. element-move.service.ts).
  // La mutation de schéma elle-même est la seule étape all-or-nothing — au-delà, un échec
  // partiel de la cascade est rapporté à l'appelant plutôt que de tout annuler.
  ipcMain.handle('schema:move-element',
    (_e, repoPath: string, dto: { fromNodeName: string; toNodeName: string; typeName: string }) =>
      c.elementMove.moveElementToNode(repoPath, dto))

  // ── Campaigns ────────────────────────────────────────────────────────────────
  ipcMain.handle('campaigns:list', (_e, repoPath: string, component?: string, level?: string) =>
    c.campaigns.list(repoPath, component, level))
  ipcMain.handle('campaigns:get', (_e, repoPath: string, id: string) =>
    c.campaigns.get(repoPath, id))
  ipcMain.handle('campaigns:create', (_e, repoPath: string, dto: unknown, workspaceDir?: string) =>
    c.campaigns.create(repoPath, dto as import('@polenta/types').CreateCampaignDto, workspaceDir))
  ipcMain.handle('campaigns:update', (_e, repoPath: string, id: string, dto: unknown) =>
    c.campaigns.update(repoPath, id, dto as import('@polenta/types').UpdateCampaignDto))
  ipcMain.handle('campaigns:update-run',
    (_e, repoPath: string, campaignId: string, entryId: string, status: unknown, runId?: string) =>
      c.campaigns.updateRun(repoPath, campaignId, entryId, status as import('@polenta/types').TestRunStatus, runId))
  ipcMain.handle('campaigns:close',
    (_e, repoPath: string, id: string, status: unknown) =>
      c.campaigns.close(repoPath, id, status as 'completed' | 'abandoned'))
  ipcMain.handle('campaigns:add-tests',
    (_e, repoPath: string, campaignId: string, testCaseIds: string[], paramValuesByTest?: Record<string, Record<string, string>>, workspaceDir?: string, reqInstances?: import('@polenta/types').ReqInstanceSelection) =>
      c.campaigns.addTests(repoPath, campaignId, testCaseIds, paramValuesByTest, workspaceDir, reqInstances))
  ipcMain.handle('campaigns:remove-entries',
    (_e, repoPath: string, campaignId: string, entryIds: string[]) =>
      c.campaigns.removeEntries(repoPath, campaignId, entryIds))
  ipcMain.handle('campaigns:duplicate-test',
    (_e, repoPath: string, campaignId: string, testCaseId: string, paramValues: Record<string, string>, workspaceDir?: string, requirementId?: string) =>
      c.campaigns.duplicateTest(repoPath, campaignId, testCaseId, paramValues, workspaceDir, requirementId))
  // T171 — résolution prévisionnelle des paramètres (panneau d'ajout, création), sans écriture.
  ipcMain.handle('campaigns:preview-params',
    (_e, repoPath: string, source: { campaignId?: string; baselineRef?: string }, testCaseIds: string[], workspaceDir?: string) =>
      c.campaigns.previewParams(repoPath, source, testCaseIds, workspaceDir))
  ipcMain.handle('campaigns:update-run-params',
    (_e, repoPath: string, campaignId: string, entryId: string, paramValues: Record<string, string>) =>
      c.campaigns.updateRunParams(repoPath, campaignId, entryId, paramValues))
  ipcMain.handle('campaigns:delete',
    (_e, repoPath: string, id: string) =>
      c.campaigns.delete(repoPath, id))

  // ── Baselines ────────────────────────────────────────────────────────────────
  ipcMain.handle('baseline:list', (_e, repoPath: string, components?: import('../services/baseline.service').BaselineComponentRef[]) =>
    c.baseline.list(repoPath, components))
  ipcMain.handle('baseline:get', (_e, repoPath: string, tag: string, components?: import('../services/baseline.service').BaselineComponentRef[]) =>
    c.baseline.get(repoPath, tag, components))
  ipcMain.handle('baseline:get-integration-branch', (_e, repoPath: string) => c.git.getIntegrationBranch(repoPath))
  ipcMain.handle('baseline:set-integration-branch', (_e, repoPath: string, branch: string) => c.git.setIntegrationBranch(repoPath, branch))
  ipcMain.handle('baseline:delete', (_e, repoPath: string, tag: string, components?: import('../services/baseline.service').BaselineComponentRef[]) =>
    c.baseline.delete(repoPath, tag, components))
  ipcMain.handle('baseline:create', async (_e, repoPath: string, dto: import('../services/baseline.service').CreateBaselineDto, workspaceDir?: string) => {
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

  // ── Dialog ───────────────────────────────────────────────────────────────────
  ipcMain.handle('dialog:pick-folder', async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Sélectionner un dossier',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:pick-image-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Insérer une image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const ext = path.extname(filePath).toLowerCase().replace('.', '')
    const mimeType = IMAGE_MIME_BY_EXT[ext] ?? 'image/png'
    const data = await fsP.readFile(filePath, { encoding: 'base64' })
    return { mimeType, base64: data }
  })

  ipcMain.handle('dialog:pick-drawio-file', async (_e, repoPath: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner un diagramme draw.io',
      properties: ['openFile'],
      filters: [{ name: 'draw.io', extensions: ['drawio'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { status: 'canceled' as const }
    const picked = result.filePaths[0]
    const rel = path.relative(repoPath, picked)
    // Fichier déjà dans le repo courant (pas de '..' ni de chemin absolu résiduel,
    // ce dernier cas couvrant un autre volume Windows) : référence directe.
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return { status: 'ok' as const, path: rel.split(path.sep).join('/'), copied: false }
    }
    // Fichier hors du repo : les diagrammes référencés doivent vivre dans le repo
    // (D4, CONTEXT.md) — on copie le fichier choisi dans diagrams/ plutôt que de
    // rejeter la sélection, avec un nom dédupliqué en cas de collision.
    try {
      const diagramsDir = path.join(repoPath, 'diagrams')
      await fsP.mkdir(diagramsDir, { recursive: true })
      const destName = await findAvailableFileName(diagramsDir, path.basename(picked))
      await fsP.copyFile(picked, path.join(diagramsDir, destName))
      return { status: 'ok' as const, path: `diagrams/${destName}`, copied: true }
    } catch {
      return { status: 'error' as const, message: 'Impossible de copier le fichier dans le repo.' }
    }
  })

  // ── Draw.io (T47) ────────────────────────────────────────────────────────────
  ipcMain.handle('drawio:read', async (_e, repoPath: string, relativePath: string) => {
    let raw: string
    try {
      raw = await fsP.readFile(path.join(repoPath, relativePath), 'utf-8')
    } catch {
      return null
    }
    return parseDrawioPages(raw)
  })
  ipcMain.handle('drawio:open-external', async (_e, repoPath: string, relativePath: string) => {
    await shell.openPath(path.join(repoPath, relativePath))
  })

  // ── Image (T76) ──────────────────────────────────────────────────────────────
  ipcMain.handle('image:pick-file', async (_e, repoPath: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Insérer une image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { status: 'canceled' as const }
    const picked = result.filePaths[0]
    const rel = path.relative(repoPath, picked)
    // Fichier déjà dans le repo courant : référence directe (même logique que
    // `dialog:pick-drawio-file`).
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return { status: 'ok' as const, path: rel.split(path.sep).join('/'), copied: false }
    }
    // Fichier hors du repo : les images référencées vivent dans le repo (T76,
    // par analogie avec D4/CONTEXT.md pour les diagrammes) — copie dans
    // `images/` plutôt que rejet, nom dédupliqué en cas de collision.
    try {
      const imagesDir = path.join(repoPath, 'images')
      await fsP.mkdir(imagesDir, { recursive: true })
      const destName = await findAvailableFileName(imagesDir, path.basename(picked))
      await fsP.copyFile(picked, path.join(imagesDir, destName))
      return { status: 'ok' as const, path: `images/${destName}`, copied: true }
    } catch {
      return { status: 'error' as const, message: 'Impossible de copier le fichier dans le repo.' }
    }
  })
  ipcMain.handle('image:read', async (_e, repoPath: string, relativePath: string) => {
    const ext = path.extname(relativePath).toLowerCase().replace('.', '')
    const mimeType = IMAGE_MIME_BY_EXT[ext] ?? 'image/png'
    try {
      const data = await fsP.readFile(path.join(repoPath, relativePath), { encoding: 'base64' })
      return { mimeType, base64: data }
    } catch {
      return null
    }
  })
  ipcMain.handle('image:write-paste', async (_e, repoPath: string, mimeType: string, base64: string) => {
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
  ipcMain.handle('tree:get', (_e, repoPath: string, nodeId: string, typeId: string) =>
    c.tree.get(repoPath, nodeId, typeId))
  ipcMain.handle('tree:save', (_e, repoPath: string, tree: unknown) =>
    c.tree.save(repoPath, tree as import('@polenta/types').TypeTree))
  ipcMain.handle('tree:generate-id', () =>
    c.tree.generateId())

  // ── Flat workspace (T69 Sprint 1) ─────────────────────────────────────────────
  ipcMain.handle('workspace:detect', (_e, dir: string) =>
    c.workspace.detectWorkspace(dir))
  ipcMain.handle('workspace:init', (_e, workspaceDir: string, rootRepoPath: string) =>
    c.workspace.initWorkspace(workspaceDir, rootRepoPath))
  ipcMain.handle('workspace:open', (_e, workspaceDir: string) =>
    c.workspace.openWorkspace(workspaceDir))

  // ── Flat workspace (T69 Sprint 2) ─────────────────────────────────────────────
  ipcMain.handle('workspace:get-tree', (_e, workspaceDir: string) =>
    c.workspace.getCacheTree(workspaceDir))
  ipcMain.handle('workspace:rebuild-tree', (_e, workspaceDir: string) =>
    c.workspace.rebuildTree(workspaceDir))
  ipcMain.handle('workspace:set-mount-override', (_e, workspaceDir: string, override: unknown) =>
    c.workspace.setMountOverride(workspaceDir, override as import('@polenta/types').MountOverride))
  // T74: physically delete a dependency's cloned directory (renderer always removes its
  // polenta-repo.yaml reference and rebuilds the tree first — see workspaceActions.ts).
  ipcMain.handle('workspace:remove-repo-dir', (_e, repoPath: string) =>
    c.workspaceTree.removeClonedRepo(repoPath))
  // T74 sprint 2: physically rename a dependency's mount directory (renderer does this before
  // any manifest write — see workspaceActions.ts).
  ipcMain.handle('workspace:rename-repo-dir', (_e, workspaceDir: string, oldMountName: string, newMountName: string) =>
    c.workspaceTree.renameClonedRepo(workspaceDir, oldMountName, newMountName))

  // ── PolentaRepo (T69 Sprint 1) ────────────────────────────────────────────────
  ipcMain.handle('polenta-repo:get', (_e, repoPath: string) =>
    c.polentaRepo.readManifest(repoPath))
  ipcMain.handle('polenta-repo:save', (_e, repoPath: string, manifest: unknown) =>
    c.polentaRepo.writeManifest(repoPath, manifest as import('@polenta/types').PolentaRepoManifest))

  // ── Interface compliance (T69 Sprint 4) ────────────────────────────────────────
  ipcMain.handle('interface:compliance-matrix', (_e, workspaceDir: string) =>
    c.interfaceCompliance.getComplianceMatrix(workspaceDir))
  ipcMain.handle('interface:coverage', (
    _e,
    componentRepoPath: string,
    interfaceRepoPath: string,
    roles: string[],
  ) =>
    c.interfaceCompliance.checkComponentCoverage(componentRepoPath, interfaceRepoPath, roles))

  // ── Queries (T77 sprint 1) ───────────────────────────────────────────────────
  ipcMain.handle('queries:execute', (_e, repoPath: string, queryDef: unknown, workspaceDir?: string) =>
    c.queryEngine.execute(repoPath, queryDef as QueryDefinition, workspaceDir))
  ipcMain.handle('queries:builder-to-sql', (_e, repoPath: string, config: unknown, workspaceDir?: string) =>
    c.queryEngine.builderToSql(repoPath, config as BuilderConfig, workspaceDir))
  ipcMain.handle('queries:list', (_e, repoPath: string, username: string) =>
    c.savedQueries.list(repoPath, username))
  ipcMain.handle('queries:create', (_e, repoPath: string, username: string, dto: unknown) =>
    c.savedQueries.create(repoPath, username, dto as CreateSavedQueryDto))
  ipcMain.handle('queries:update', (_e, repoPath: string, username: string, id: string, dto: unknown) =>
    c.savedQueries.update(repoPath, username, id, dto as UpdateSavedQueryDto))
  ipcMain.handle('queries:delete', (_e, repoPath: string, username: string, id: string) =>
    c.savedQueries.delete(repoPath, username, id))
  ipcMain.handle('queries:history-list', (_e, repoPath: string, username: string) =>
    c.savedQueries.listHistory(repoPath, username))
  ipcMain.handle('queries:history-add', (_e, repoPath: string, username: string, entry: unknown) =>
    c.savedQueries.addHistoryEntry(repoPath, username, entry as AddHistoryEntryDto))
  ipcMain.handle('queries:history-delete', (_e, repoPath: string, username: string, id: string) =>
    c.savedQueries.deleteHistoryEntry(repoPath, username, id))
  ipcMain.handle('queries:order-get', (_e, repoPath: string, username: string) =>
    c.savedQueries.getQueriesOrder(repoPath, username))
  ipcMain.handle('queries:order-set', (_e, repoPath: string, username: string, order: string[]) =>
    c.savedQueries.setQueriesOrder(repoPath, username, order))
  ipcMain.handle('queries:set-scope', (_e, repoPath: string, username: string, id: string, scope: unknown) =>
    c.savedQueries.setScope(repoPath, username, id, scope as QueryScope))

  // ── Dashboards & widgets (T77 sprint 2, seed sprint 3) ───────────────────────
  ipcMain.handle('dashboards:list', async (_e, repoPath: string, username: string) => {
    // Seed the 3 pre-configured shared dashboards on first access (empty `dashboards/`
    // folder, never seeded before) — server-side, ahead of every list() call, so it's
    // reliable regardless of which UI entry point triggers the panel's first load
    // (T77 sprint 3 — see dashboard-seed.service.ts for the "once only" guarantee).
    await c.dashboardSeed.ensureSeeded(repoPath, username)
    return c.dashboards.list(repoPath, username)
  })
  ipcMain.handle('dashboards:get', (_e, repoPath: string, username: string, id: string) =>
    c.dashboards.get(repoPath, username, id))
  ipcMain.handle('dashboards:create', (_e, repoPath: string, username: string, dto: unknown) =>
    c.dashboards.create(repoPath, username, dto as CreateDashboardDto))
  ipcMain.handle('dashboards:update', (_e, repoPath: string, username: string, id: string, dto: unknown) =>
    c.dashboards.update(repoPath, username, id, dto as UpdateDashboardDto))
  ipcMain.handle('dashboards:delete', (_e, repoPath: string, username: string, id: string) =>
    c.dashboards.delete(repoPath, username, id))
  ipcMain.handle('dashboards:set-scope', (_e, repoPath: string, username: string, id: string, scope: unknown) =>
    c.dashboards.setScope(repoPath, username, id, scope as QueryScope))
  ipcMain.handle('dashboards:add-widget', (_e, repoPath: string, username: string, dashboardId: string, dto: unknown) =>
    c.dashboards.addWidget(repoPath, username, dashboardId, dto as AddWidgetDto))
  ipcMain.handle(
    'dashboards:update-widget',
    (_e, repoPath: string, username: string, dashboardId: string, widgetId: string, dto: unknown) =>
      c.dashboards.updateWidget(repoPath, username, dashboardId, widgetId, dto as UpdateWidgetDto),
  )
  ipcMain.handle(
    'dashboards:delete-widget',
    (_e, repoPath: string, username: string, dashboardId: string, widgetId: string) =>
      c.dashboards.deleteWidget(repoPath, username, dashboardId, widgetId),
  )
  ipcMain.handle(
    'dashboards:set-widget-order',
    (_e, repoPath: string, username: string, dashboardId: string, order: string[]) =>
      c.dashboards.setWidgetOrder(repoPath, username, dashboardId, order),
  )
  ipcMain.handle('dashboards:order-get', (_e, repoPath: string, username: string) =>
    c.dashboards.getDashboardsOrder(repoPath, username))
  ipcMain.handle('dashboards:order-set', (_e, repoPath: string, username: string, order: string[]) =>
    c.dashboards.setDashboardsOrder(repoPath, username, order))

  // ── Git (T43) ────────────────────────────────────────────────────────────────
  ipcMain.handle('git:head-sha', (_e, repoPath: string) => c.git.headSha(repoPath))

  // ── Export (T43) ─────────────────────────────────────────────────────────────
  ipcMain.handle('export:save', async (
    _e,
    repoPath: string,
    kind: ExportKind,
    format: ExportFormat,
    payload: unknown,
    printParams: Record<string, string> | undefined,
    suggestedName: string,
    templateRelPath?: string,
  ) => {
    const filter = EXPORT_DIALOG_FILTERS[format]
    if (!filter) return { status: 'error' as const, message: `Format d'export inconnu : "${format}"` }

    const saveResult = await dialog.showSaveDialog({
      title: 'Exporter',
      defaultPath: suggestedName,
      filters: [filter],
    })
    if (saveResult.canceled || !saveResult.filePath) return { status: 'canceled' as const }
    try {
      await c.export.run(kind, format, payload, printParams, saveResult.filePath, { repoPath, templateRelPath })
      return { status: 'ok' as const, filePath: saveResult.filePath }
    } catch (err) {
      return { status: 'error' as const, message: err instanceof Error ? err.message : 'Erreur lors de l’export' }
    }
  })
  // GH34 — gabarits de la bibliothèque (préférence application) pour un format.
  ipcMain.handle('export-templates:list', (_e, format: TemplateExportFormat) => c.exportTemplateLibrary.list(format))
  // Gabarits d'exemple : `extraResources` en build packagé (electron-builder.yml), sources du repo
  // en développement.
  ipcMain.handle('export-templates:install-examples', () => c.exportTemplateLibrary.installExamples(
    app.isPackaged
      ? path.join(process.resourcesPath, 'export-templates')
      : path.join(app.getAppPath(), 'resources', 'export-templates'),
  ))
  ipcMain.handle('export:show-in-folder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('export:open-file', (_e, filePath: string) => shell.openPath(filePath))

  registerPrefHandlers()
}
