import type { HostContext } from '../main/host/host-context'
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
import { DashboardsService } from '../main/services/dashboards.service'
import { SavedQueriesService } from '../main/services/saved-queries.service'
import { HistoryService } from '../main/services/history.service'
import { GraphService } from '../main/services/graph.service'
import { DashboardLibraryService } from '../main/services/dashboard-library.service'
import { ScriptEngineService } from '../main/services/script-engine.service'
import { SuiviService } from '../main/services/suivi.service'
import { WorkspaceLinksService } from '../main/services/workspace-links.service'
import { ParametersService } from '../main/services/parameters.service'

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
  /** GH74 — graphe de données (sans cache : pas de surveillance des fichiers), bibliothèque, moteur. */
  graph: GraphService
  dashboardLibrary: DashboardLibraryService
  scriptEngine: ScriptEngineService
  suivi: SuiviService
  savedQueries: SavedQueriesService
  dashboards: DashboardsService
  /** GH77 — lecture effective de l'historique (tools de lecture). */
  history: HistoryService
  /** GH105 — liens agrégés sur le workspace, écrits dans le repo de leur source. */
  workspaceLinks: WorkspaceLinksService
  /** GH150 — base de paramètres (`list_parameters` / `set_parameters` / `delete_parameter`). */
  parameters: ParametersService
}

/**
 * GH44 — hôte headless : aucun tool n'accède aux jetons ni à `userData` (cf. `createMcpContainer`) ; un accès
 * futur échoue explicitement plutôt que d'écrire dans le dossier courant.
 */
function unavailable(what: string): never {
  throw new Error(`[mcp-server] ${what} n'est pas disponible en mode serveur MCP autonome (cf. src/mcp-server/container.ts).`)
}
const mcpHostContext: HostContext = {
  get userDataDir(): string { return unavailable('userData') },
  machineConfig: { hideGithub: false },
  tokenStore: {
    get: async () => unavailable('le stockage des jetons'),
    set: async () => unavailable('le stockage des jetons'),
    delete: async () => unavailable('le stockage des jetons'),
  },
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
 * Synchrone — pas de fenêtre à ouvrir, pas d'attente d'`app.whenReady()`.
 *
 * `AuthService`/`SyncService` sont construits (requis transitivement par
 * `WorkspaceTreeService`/`SchemaService`) mais aucune de leurs méthodes touchant
 * `userData`/les jetons (`mcpHostContext`, GH44) n'est jamais appelée par les tools de ce sprint (lecture
 * seule, pas de clone/push/pull/commit) — cf. specs/T122-design.md §2.1 pour
 * l'analyse de sûreté et specs/T122-sprint1.md pour la dette technique documentée
 * (des `Noop*Service` typés seraient un durcissement à prévoir si un futur sprint
 * élargit le périmètre au point d'appeler ces méthodes).
 */
export function createMcpContainer(repoPath: string, workspaceDir?: string, user?: string): McpContainer {
  const auth = new AuthService(mcpHostContext)
  const git = new GitService()
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const sync = new SyncService(auth)
  const polentaRepo = new PolentaRepoService()
  const workspaceTree = new WorkspaceTreeService(sync, polentaRepo)
  const schema = new SchemaService(auth, workspaceTree)
  const tree = new TreeService()
  // GH77 — écritures MCP : `by` = `--user` / `POLENTA_USER` (sinon `local`), `source: mcp`.
  const history = new HistoryService(git, async () => ({ by: user ?? 'local', source: 'mcp' }))
  // T172 — mêmes déclencheurs que l'app : un changement de statut via MCP marque aussi les pairs.
  const revalidation = new RevalidationService(git, reqIndex, testsIndex, schema, workspaceTree, history)
  const requirements = new RequirementsService(git, reqIndex, schema, tree, revalidation, history)
  const tests = new TestsService(git, testsIndex, schema, tree, revalidation, history)
  const campaigns = new CampaignsService(git, tests, undefined, schema, history)
  // GH18 — vue Suivi : même graphe que main/container.ts (sans DashboardSeedService, le
  // seed des dashboards pré-configurés reste propre à l'app). TraceabilityService n'est
  // appelé que pour computeCoverage (pur, ni réseau ni keytar).
  const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
  const dashboards = new DashboardsService(git)
  const savedQueries = new SavedQueriesService(git, dashboards)
  const graph = new GraphService(reqIndex, testsIndex, schema, traceability, git, workspaceTree, campaigns, { cache: false })
  const dashboardLibrary = new DashboardLibraryService(git, workspaceTree)
  const scriptEngine = new ScriptEngineService(graph, dashboardLibrary)
  const suivi = new SuiviService(scriptEngine, graph, savedQueries, dashboards, schema, workspaceTree)
  const workspaceLinks = new WorkspaceLinksService(reqIndex, testsIndex, schema, git, workspaceTree, revalidation, campaigns)
  // GH150 — sans ReqRefsService : les références `{req.<champ>}` restent littérales (lecture seule,
  // sans effet sur les écritures de paramètres).
  const parameters = new ParametersService(git, reqIndex, testsIndex, schema, polentaRepo, revalidation, workspaceTree)

  return {
    repoPath, workspaceDir, git, schema, requirements, tests, campaigns, workspaceTree, reqIndex, testsIndex,
    user, savedQueries, dashboards, history, graph, dashboardLibrary, scriptEngine, suivi, workspaceLinks, parameters,
  }
}
