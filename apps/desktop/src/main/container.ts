import { AuthService } from './services/auth.service'
import { GitService } from './services/git.service'
import { SyncService } from './services/sync.service'
import { WorkspaceService } from './services/workspace.service'
import { RequirementsIndexService } from './services/requirements-index.service'
import { TestsIndexService } from './services/tests-index.service'
import { RequirementsService } from './services/requirements.service'
import { TestsService } from './services/tests.service'
import { TraceabilityService } from './services/traceability.service'
import { ReviewsService } from './services/reviews.service'
import { RepoWatcherService } from './services/repo-watcher.service'
import { SchemaService } from './services/schema.service'
import { CampaignsService } from './services/campaigns.service'
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
import { registerIpcHandlers } from './ipc/index'

export async function createContainer(): Promise<void> {
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
  const interfaceCompliance = new InterfaceComplianceService(workspaceTree, reqIndex)
  const requirements = new RequirementsService(git, reqIndex, schema)
  const tests = new TestsService(git, testsIndex, schema)
  const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
  const reviews = new ReviewsService(git)
  const campaigns = new CampaignsService(git, tests)
  const tree = new TreeService()
  const baseline = new BaselineService()
  const queryEngine = new QueryEngineService(reqIndex, testsIndex, schema, traceability, workspaceTree)
  const dashboards = new DashboardsService(git)
  // dashboards is injected here (not the other way around) — SavedQueriesService needs
  // to detect widgets depending on a query (delete/setScope guards), DashboardsService
  // never needs to look up a SavedQuery, so this ordering avoids a circular dependency.
  const savedQueries = new SavedQueriesService(git, schema, dashboards)
  const dashboardSeed = new DashboardSeedService(git, dashboards, savedQueries)
  const exportSvc = new ExportService()

  registerIpcHandlers({
    auth,
    git,
    sync,
    workspace,
    reqIndex,
    testsIndex,
    requirements,
    tests,
    traceability,
    reviews,
    watcher,
    schema,
    campaigns,
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
  })
}
