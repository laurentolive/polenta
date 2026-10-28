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
import { TreeService, indexObjectLister } from './services/tree.service'
import { BaselineService } from './services/baseline.service'
import { PolentaRepoService } from './services/polenta-repo.service'
import { WorkspaceTreeService } from './services/workspace-tree.service'
import { InterfaceComplianceService } from './services/interface-compliance.service'
import { SavedQueriesService } from './services/saved-queries.service'
import { DashboardsService } from './services/dashboards.service'
import { DashboardSeedService } from './services/dashboard-seed.service'
import { ExportService } from './services/export.service'
import { ExportTemplateLibrary } from './services/export-template-library'
import { TemplateExportService } from './services/export/template/template-export.service'
import { AppSettingsService } from './services/app-settings.service'
import { MergeResolutionService } from './services/merge-resolution.service'
import { ForgeConfigService } from './services/forge-config.service'
import { ForgeService } from './services/forge/forge.service'
import { IntegrationBranchService } from './services/integration-branch.service'
import { HistoryService } from './services/history.service'
import { GraphService } from './services/graph.service'
import { DashboardLibraryService } from './services/dashboard-library.service'
import { ScriptEngineService } from './services/script-engine.service'
import { SuiviService } from './services/suivi.service'
import { SuiviUpdatesService } from './services/suivi-updates.service'
import { FieldRenameService } from './services/field-rename.service'
import { TypeRenameService } from './services/type-rename.service'
import { SchemaDeleteService } from './services/schema-delete.service'
import { resolveWorkspaceRepoPaths } from './services/workspace-repos.util'
import { HistoryBackfillService } from './services/history-backfill.service'
import { WorkspaceLinksService } from './services/workspace-links.service'
import type { Container } from './ipc/index'
import type { HostContext } from './host/host-context'
import type { PrintRenderer } from './host/print-renderer'

/** GH74 — dossiers dont un changement invalide le graphe de données. */
const GRAPH_PATHS = ['requirements/', 'tests/', 'test-runs/', 'links/', 'campaigns/', '.polenta/', 'polenta-repo.yaml']

/**
 * Instancie le noyau de services (GH44 : sans dépendance à Electron). L'hôte fournit ce qui
 * dépend du poste ou de l'utilisateur ; l'appelant enregistre les handlers (`registerHandlers`)
 * et, sur le desktop, les channels propres au poste local.
 */
export function createContainer(host: HostContext, print: PrintRenderer): Container {
  const auth = new AuthService(host)
  const git = new GitService()
  // Constructed early (only needs `git`) so `watcher` — and, via it, `workspace` below —
  // can be wired up before any repo is actually opened (T112: WorkspaceService.
  // openWorkspace() starts the watcher for every repo in the tree as soon as it's known).
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const watcher = new RepoWatcherService(reqIndex, testsIndex)
  const sync = new SyncService(auth)
  const polentaRepo = new PolentaRepoService()
  const workspaceTree = new WorkspaceTreeService(sync, polentaRepo, watcher)
  const workspace = new WorkspaceService(host, sync, workspaceTree, watcher)
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
  const tree = new TreeService(indexObjectLister(reqIndex, testsIndex))
  // GH77 — historique des champs suivis ; `by` = compte du projet (login forge, sinon `local`).
  const history = new HistoryService(git, async repoPath => ({ by: await auth.projectUsername(repoPath) }))
  // T172 — marquage needsRevalidation des éléments liés quand un élément quitte l'approbation.
  const revalidation = new RevalidationService(git, reqIndex, testsIndex, schema, workspaceTree, history)
  const requirements = new RequirementsService(git, reqIndex, schema, revalidation, history)
  const tests = new TestsService(git, testsIndex, schema, revalidation, history)
  const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
  const reviews = new ReviewsService(git)
  // T171 — base de paramètres ; marque les éléments approuvés impactés via T172, et résout les
  // paramètres des tests à l'ajout en campagne.
  // T179 — exigences liées aux tests pour les références `{req.<champ>}`.
  const reqRefs = new ReqRefsService(git, reqIndex, schema)
  const parameters = new ParametersService(git, reqIndex, testsIndex, schema, polentaRepo, revalidation, workspaceTree, reqRefs)
  const campaigns = new CampaignsService(git, tests, parameters, schema, history)
  // GH105 — liens inter-repos : agrégation sur le workspace, écriture côté source.
  const workspaceLinks = new WorkspaceLinksService(reqIndex, testsIndex, schema, git, workspaceTree, revalidation, campaigns)
  // GH36 — exécution hors outil : classeur Excel d'exécution (export / réimport).
  const campaignExecution = new CampaignExecutionService(campaigns, tests, auth)
  const elementMove = new ElementMoveService(schema, requirements, tests, tree)
  // GH77 — renommage de champ dans l'éditeur de schéma : migration des objets du type.
  const fieldRename = new FieldRenameService(requirements, tests, campaigns)
  // GH100 — renommage d'un type (nom / préfixe) : migration de ses objets dans tout le workspace.
  const typeRename = new TypeRenameService(
    requirements, tests, campaigns, tree, schema, [reqIndex, testsIndex],
    (repoPath, workspaceDir) => resolveWorkspaceRepoPaths(workspaceTree, repoPath, workspaceDir),
  )
  // GH104 — suppression en cascade d'un composant local ou d'un type (objets, liens, arbres, refs).
  const schemaDelete = new SchemaDeleteService(
    git, { requirements, tests, campaigns }, reqIndex, tree, schema, [reqIndex, testsIndex],
    (repoPath, workspaceDir) => resolveWorkspaceRepoPaths(workspaceTree, repoPath, workspaceDir),
    async workspaceDir => {
      const cache = workspaceDir ? await workspaceTree.readCache(workspaceDir) : null
      return cache ? revalidation.readonlyRepoPaths(cache.logicalTree.repoPath, workspaceDir) : new Set<string>()
    },
  )
  // GH77 — reprise de l'historique des champs suivis depuis git (action manuelle, par repo).
  const historyBackfill = new HistoryBackfillService(git, requirements, tests, campaigns)
  const baseline = new BaselineService()
  // GH74 — graphe de données (en cache) et moteur de scripts (worker QuickJS). Le graphe et la
  // bibliothèque projet sont oubliés dès qu'un fichier de leur périmètre change (y compris dans un
  // repo composant), avant que le renderer ne soit notifié (abonnés appelés dans l'ordre).
  const graph = new GraphService(reqIndex, testsIndex, schema, traceability, git, workspaceTree, campaigns)
  const dashboardLibrary = new DashboardLibraryService(git, workspaceTree)
  const scriptEngine = new ScriptEngineService(graph, dashboardLibrary)
  watcher.onFileChange((repoPath, relPath) => {
    if (relPath === '*' || GRAPH_PATHS.some((p) => relPath.startsWith(p))) graph.invalidate(repoPath)
    if (relPath === '*' || relPath === 'polenta-repo.yaml' || relPath.startsWith('dashboards/lib/')) dashboardLibrary.invalidate(repoPath)
  })
  const dashboards = new DashboardsService(git)
  // dashboards is injected here (not the other way around) — SavedQueriesService needs
  // to detect widgets depending on a query (delete/setScope guards), DashboardsService
  // never needs to look up a SavedQuery, so this ordering avoids a circular dependency.
  const savedQueries = new SavedQueriesService(git, dashboards)
  const suivi = new SuiviService(scriptEngine, graph, savedQueries, dashboards, schema, workspaceTree)
  const dashboardSeed = new DashboardSeedService(git, dashboards, savedQueries, undefined, dashboardLibrary)
  // GH74 §6.3 — bandeau des mises à jour (bibliothèque, widgets du seed, versions de modèle).
  const suiviUpdates = new SuiviUpdatesService(git, dashboardLibrary, dashboardSeed, savedQueries, dashboards)
  // GH26 — préférences app-level.
  // GH45 S2b — configuration par équipe lue sur la forge (spec §3bis).
  const forgeConfig = new ForgeConfigService(auth, host.userDataDir)
  // GH45 S4 — repos, organisations, membres, droits ; création de projet/composant sur le serveur.
  const forge = new ForgeService(auth, workspace, sync)
  // GH106 — désignation de la branche d'intégration (commit de project.yaml, push, branche par défaut).
  const integration = new IntegrationBranchService(git, sync, forge)
  const appSettings = new AppSettingsService(host.userDataDir, host.machineConfig, () => forgeConfig.updatesManaged())
  const mergeResolution = new MergeResolutionService(host.userDataDir, auth, sync, schema)
  // GH34 — bibliothèque de gabarits d'export (préférence application) et export par gabarit.
  const exportTemplateLibrary = new ExportTemplateLibrary(appSettings)
  const exportSvc = new ExportService(
    new TemplateExportService(exportTemplateLibrary, git, schema, auth, tests, print.snapshotDrawios),
    print,
  )

  return {
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
    graph,
    dashboardLibrary,
    scriptEngine,
    suivi,
    suiviUpdates,
    savedQueries,
    dashboards,
    dashboardSeed,
    export: exportSvc,
    exportTemplateLibrary,
    parameters,
    revalidation,
    workspaceLinks,
    history,
    fieldRename,
    typeRename,
    schemaDelete,
    historyBackfill,
    appSettings,
    machineConfig: host.machineConfig,
    forgeConfig,
    forge,
    integration,
  }
}
