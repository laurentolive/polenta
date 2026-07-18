import { AuthService } from '../main/services/auth.service'
import { GitService } from '../main/services/git.service'
import { SyncService } from '../main/services/sync.service'
import { PolentaRepoService } from '../main/services/polenta-repo.service'
import { WorkspaceTreeService } from '../main/services/workspace-tree.service'
import { SchemaService } from '../main/services/schema.service'
import { RequirementsIndexService } from '../main/services/requirements-index.service'
import { TestsIndexService } from '../main/services/tests-index.service'
import { RequirementsService } from '../main/services/requirements.service'
import { TestsService } from '../main/services/tests.service'
import { CampaignsService } from '../main/services/campaigns.service'

export interface McpContainer {
  /** Repo produit ciblé par cette instance de serveur MCP (un repo fixe par instance). */
  repoPath: string
  /** Racine du workspace multi-repo, si fournie (cf. specs/T122-design.md §2.3 — mode
   *  mono-repo si absente : les objectTypeRef pointant vers un vrai composant submodule
   *  retombent silencieusement sur `repoPath`). */
  workspaceDir?: string
  git: GitService
  schema: SchemaService
  requirements: RequirementsService
  tests: TestsService
  campaigns: CampaignsService
  workspaceTree: WorkspaceTreeService
}

/**
 * DI headless pour le serveur MCP (T122 sprint 1).
 *
 * Réutilise EXACTEMENT les mêmes classes que `main/container.ts::createContainer()`
 * pour la partie schéma/exigences/tests/campagnes (même graphe de dépendances) — mais
 * sans `RepoWatcherService` (chokidar, inutile pour un process qui répond à des appels
 * ponctuels puis se termine) ni les services hors périmètre de ce ticket
 * (`ReviewsService`, `TraceabilityService`, `QueryEngineService`, `DashboardsService`,
 * `ExportService`, `WorkspaceService`, `TreeService`, `BaselineService`,
 * `InterfaceComplianceService`, `SavedQueriesService`, `DashboardSeedService`).
 *
 * Synchrone (pas de `createContainer()` async comme le main Electron) — pas de fenêtre
 * à ouvrir, pas d'attente d'`app.whenReady()`.
 *
 * `AuthService`/`SyncService` sont construits (requis transitivement par
 * `WorkspaceTreeService`/`SchemaService`) mais aucune de leurs méthodes touchant
 * `app.getPath`/`keytar` n'est jamais appelée par les tools de ce sprint (lecture
 * seule, pas de clone/push/pull/commit) — cf. specs/T122-design.md §2.1 pour
 * l'analyse de sûreté et specs/T122-sprint1.md pour la dette technique documentée
 * (des `Noop*Service` typés seraient un durcissement à prévoir si un futur sprint
 * élargit le périmètre au point d'appeler ces méthodes).
 */
export function createMcpContainer(repoPath: string, workspaceDir?: string): McpContainer {
  const auth = new AuthService()
  const git = new GitService()
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const sync = new SyncService(auth)
  const polentaRepo = new PolentaRepoService()
  const workspaceTree = new WorkspaceTreeService(sync, polentaRepo)
  const schema = new SchemaService(auth, workspaceTree)
  const requirements = new RequirementsService(git, reqIndex, schema)
  const tests = new TestsService(git, testsIndex, schema)
  const campaigns = new CampaignsService(git, tests)

  return { repoPath, workspaceDir, git, schema, requirements, tests, campaigns, workspaceTree }
}
