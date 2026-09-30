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
import { RevalidationService } from '../main/services/revalidation.service'
import { CampaignsService } from '../main/services/campaigns.service'
import { TreeService } from '../main/services/tree.service'
import { TraceabilityService } from '../main/services/traceability.service'
import { QueryEngineService } from '../main/services/query-engine.service'
import { DashboardsService } from '../main/services/dashboards.service'
import { SavedQueriesService } from '../main/services/saved-queries.service'

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
  /** GH16 — exposés pour invalider le cache quand un ID est introuvable (objet créé par
   *  l'app après construction de l'index : ce process n'a pas de RepoWatcherService). */
  reqIndex: RequirementsIndexService
  testsIndex: TestsIndexService
  /** GH18 — utilisateur Polenta (`--user` / `POLENTA_USER`) dont le `.{user}.pref` porte
   *  les requêtes/dashboards privés ; absent = scope partagé uniquement. */
  user?: string
  queryEngine: QueryEngineService
  savedQueries: SavedQueriesService
  dashboards: DashboardsService
}

/**
 * DI headless pour le serveur MCP (T122 sprint 1).
 *
 * Réutilise EXACTEMENT les mêmes classes que `main/container.ts::createContainer()`
 * pour la partie schéma/exigences/tests/campagnes (même graphe de dépendances) — mais
 * sans `RepoWatcherService` (chokidar, inutile pour un process qui répond à des appels
 * ponctuels puis se termine) ni les services hors périmètre (`ReviewsService`,
 * `ExportService`, `WorkspaceService`, `BaselineService`, `InterfaceComplianceService`,
 * `DashboardSeedService`). `TraceabilityService`, `QueryEngineService`,
 * `DashboardsService` et `SavedQueriesService` sont construits depuis GH18 (vue Suivi).
 * `TreeService` est en revanche bien construit (T138) : sans lui, les objets créés par
 * ce serveur MCP sont écrits sur disque mais n'apparaissent jamais dans SystemView/
 * ExcelView, qui énumèrent les objets via `.polenta/trees/<node>/<type>.yaml` et non en
 * scannant `requirements/`/`tests/`.
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
export function createMcpContainer(repoPath: string, workspaceDir?: string, user?: string): McpContainer {
  const auth = new AuthService()
  const git = new GitService()
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const sync = new SyncService(auth)
  const polentaRepo = new PolentaRepoService()
  const workspaceTree = new WorkspaceTreeService(sync, polentaRepo)
  const schema = new SchemaService(auth, workspaceTree)
  const tree = new TreeService()
  // T172 — mêmes déclencheurs que l'app : un changement de statut via MCP marque aussi les pairs.
  const revalidation = new RevalidationService(git, reqIndex, testsIndex, schema, workspaceTree)
  const requirements = new RequirementsService(git, reqIndex, schema, tree, revalidation)
  const tests = new TestsService(git, testsIndex, schema, tree, revalidation)
  const campaigns = new CampaignsService(git, tests)
  // GH18 — vue Suivi : même graphe que main/container.ts (sans DashboardSeedService, le
  // seed des dashboards pré-configurés reste propre à l'app). TraceabilityService n'est
  // appelé que pour computeCoverage (pur, ni réseau ni keytar).
  const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
  const queryEngine = new QueryEngineService(reqIndex, testsIndex, schema, traceability, workspaceTree)
  const dashboards = new DashboardsService(git)
  const savedQueries = new SavedQueriesService(git, schema, dashboards)

  return {
    repoPath, workspaceDir, git, schema, requirements, tests, campaigns, workspaceTree, reqIndex, testsIndex,
    user, queryEngine, savedQueries, dashboards,
  }
}
