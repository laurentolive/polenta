import { AuthService } from './services/auth.service'
import { GitService } from './services/git.service'
import { SyncService } from './services/sync.service'
import { WorkspaceService } from './services/workspace.service'
import { RequirementsIndexService } from './services/requirements-index.service'
import { TestsIndexService } from './services/tests-index.service'
import { RequirementsService } from './services/requirements.service'
import { TestsService } from './services/tests.service'
import { RevalidationService } from './services/revalidation.service'
import { ParametersService } from './services/parameters.service'
import { ReqRefsService } from './services/req-refs.service'
import { TraceabilityService } from './services/traceability.service'
import { ReviewsService } from './services/reviews.service'
import { RepoWatcherService } from './services/repo-watcher.service'
import { SchemaService } from './services/schema.service'
import { ElementMoveService } from './services/element-move.service'
import { CampaignsService } from './services/campaigns.service'
import { CampaignExecutionService } from './services/campaign-execution.service'
import { TreeService } from './services/tree.service'
import { BaselineService } from './services/baseline.service'
import { PolentaRepoService } from './services/polenta-repo.service'
import { WorkspaceTreeService } from './services/workspace-tree.service'
import { InterfaceComplianceService } from './services/interface-compliance.service'
import { QueryEngineService } from './services/query-engine.service'
import { SavedQueriesService } from './services/saved-queries.service'
import { DashboardsService } from './services/dashboards.service'
import { DashboardSeedService } from './services/dashboard-seed.service'
import { ExportService } from './services/export.service'
import { ExportTemplateLibrary } from './services/export-template-library'
import { TemplateExportService } from './services/export/template/template-export.service'
import { AppSettingsService } from './services/app-settings.service'
import { MergeResolutionService } from './services/merge-resolution.service'
import { UpdateService } from './services/update.service'
import { registerIpcHandlers } from './ipc/index'

export async function createContainer(): Promise<{ update: UpdateService }> {
  const auth = new AuthService()
  const git = new GitService()
  // Constructed early (only needs `git`) so `watcher` — and, via it, `workspace` below —
  // can be wired up before any repo is actually opened (T112: WorkspaceService.
  // openWorkspace() starts the watcher for every repo in the tree as soon as it's known).
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const watcher = new RepoWatcherService(reqIndex, testsIndex)
  const sync = new SyncService(auth)
  const polentaRepo = new PolentaRepoService()
  const workspaceTree = new WorkspaceTreeService(sync, polentaRepo)
  const workspace = new WorkspaceService(sync, workspaceTree, watcher)
  const schema = new SchemaService(auth, workspaceTree)
  // Live sync (T-schema-refresh follow-up) — an out-of-band change to schema.yaml (manual
  // edit, git checkout/pull, a bulk-import script writing directly to disk…) must not be
  // served stale forever from SchemaService's in-memory cache for the rest of the session,
  // the way it was before the "Actualiser" button fix. `'*'` (ref change) is treated the
  // same as a direct schema.yaml edit — a checkout can change it too, and there is no
  // cheaper way to know without diffing content.
  watcher.onFileChange((repoPath, relPath) => {
    if (relPath === '.polenta/schema.yaml' || relPath === '*') schema.invalidate(repoPath)
  })
  const interfaceCompliance = new InterfaceComplianceService(workspaceTree, reqIndex)
  const tree = new TreeService()
  // T172 — marquage needsRevalidation des éléments liés quand un élément quitte l'approbation.
  const revalidation = new RevalidationService(git, reqIndex, testsIndex, schema, workspaceTree)
  const requirements = new RequirementsService(git, reqIndex, schema, tree, revalidation)
  const tests = new TestsService(git, testsIndex, schema, tree, revalidation)
  const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
  const reviews = new ReviewsService(git)
  // T171 — base de paramètres ; marque les éléments approuvés impactés via T172, et résout les
  // paramètres des tests à l'ajout en campagne.
  // T179 — exigences liées aux tests pour les références `{req.<champ>}`.
  const reqRefs = new ReqRefsService(git, reqIndex, schema)
  const parameters = new ParametersService(git, reqIndex, testsIndex, schema, polentaRepo, revalidation, workspaceTree, reqRefs)
  const campaigns = new CampaignsService(git, tests, parameters)
  // GH36 — exécution hors outil : classeur Excel d'exécution (export / réimport).
  const campaignExecution = new CampaignExecutionService(campaigns, tests, auth)
  const elementMove = new ElementMoveService(schema, requirements, tests, tree)
  const baseline = new BaselineService()
  const queryEngine = new QueryEngineService(reqIndex, testsIndex, schema, traceability, workspaceTree)
  const dashboards = new DashboardsService(git)
  // dashboards is injected here (not the other way around) — SavedQueriesService needs
  // to detect widgets depending on a query (delete/setScope guards), DashboardsService
  // never needs to look up a SavedQuery, so this ordering avoids a circular dependency.
  const savedQueries = new SavedQueriesService(git, schema, dashboards)
  const dashboardSeed = new DashboardSeedService(git, dashboards, savedQueries)
  // GH26 — préférences app-level + mise à jour automatique.
  const appSettings = new AppSettingsService()
  const mergeResolution = new MergeResolutionService(auth, sync, schema)
  // GH34 — bibliothèque de gabarits d'export (préférence application) et export par gabarit.
  const exportTemplateLibrary = new ExportTemplateLibrary(appSettings)
  const exportSvc = new ExportService(new TemplateExportService(
    exportTemplateLibrary, git, schema, auth, tests,
    // Chargé au premier diagramme à rendre (T141 : rien de plus au démarrage).
    async (repoPath, refs) => (await import('./services/export/template/drawio-snapshot')).snapshotDrawios(repoPath, refs),
  ))
  const update = new UpdateService(appSettings)

  registerIpcHandlers({
    auth,
    git,
    sync,
    mergeResolution,
    workspace,
    reqIndex,
    testsIndex,
    requirements,
    tests,
    traceability,
    reviews,
    watcher,
    schema,
    elementMove,
    campaigns,
    campaignExecution,
    tree,
    baseline,
    polentaRepo,
    workspaceTree,
    interfaceCompliance,
    queryEngine,
    savedQueries,
    dashboards,
    dashboardSeed,
    export: exportSvc,
    exportTemplateLibrary,
    parameters,
    revalidation,
    appSettings,
    update,
  })

  return { update }
}
