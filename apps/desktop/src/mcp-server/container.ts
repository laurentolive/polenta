import type { HostContext } from '../main/host/host-context'
import { AuthService } from '../main/services/auth.service'
import { GitService, type GitAuthor } from '../main/services/git.service'
import { BRAND } from '../shared/brand'
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
import { VersionTrackingService } from '../main/services/version-tracking.service'
import { VersionsService } from '../main/services/versions.service'
import { IssuesService } from '../main/services/issues.service'
import { ValidationsService } from '../main/services/validations.service'
import { ExecutionHistoryService } from '../main/services/execution-history.service'
import { TraceabilityService } from '../main/services/traceability.service'
import { TransitionGuardService } from '../main/services/transition-guard.service'
import { DashboardsService } from '../main/services/dashboards.service'
import { SavedQueriesService } from '../main/services/saved-queries.service'
import { HistoryService } from '../main/services/history.service'
import { GraphService } from '../main/services/graph.service'
import { DashboardLibraryService } from '../main/services/dashboard-library.service'
import { ScriptEngineService } from '../main/services/script-engine.service'
import { SuiviService } from '../main/services/suivi.service'
import { WorkspaceLinksService } from '../main/services/workspace-links.service'
import { ParametersService } from '../main/services/parameters.service'
import { TestedConfigService } from '../main/services/tested-config.service'
import { ResultsImportService } from '../main/services/results-import.service'
import { TreeService, indexObjectLister, serviceTitleAdopter } from '../main/services/tree.service'
import { FieldRenameService } from '../main/services/field-rename.service'

export interface McpContainer {
  /** Repo produit ciblé par cette instance de serveur MCP (un repo fixe par instance). */
  repoPath: string
  /** Racine du workspace multi-repo, si fournie (cf. specs/T122-design.md §2.3 — mode
   *  mono-repo si absente : les objectTypeRef pointant vers un composant en repo séparé
   *  retombent silencieusement sur `repoPath`). */
  workspaceDir?: string
  git: GitService
  schema: SchemaService
  requirements: RequirementsService
  tests: TestsService
  campaigns: CampaignsService
  /** GH201 — versions ; écriture et passage released par le MCP depuis GH362. */
  versions: VersionsService
  /** GH244 — issues : lecture et écriture. */
  issues: IssuesService
  /** GH206 — contraintes de transition : `dryRun` des écritures. */
  transitionGuard: TransitionGuardService
  /** GH204 — validations : lecture et écriture (GH362), jamais signées par le MCP. */
  validations: ValidationsService
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
  /** GH129 — import JUnit sans interface (outil `import_test_results`, CLI `import-results`). */
  resultsImport: ResultsImportService
  /** GH361 — rangement en dossiers (`.polenta/trees/`), outils `get_tree`, `create_folders`… */
  tree: TreeService
  /** GH371 — migration des objets au renommage / retrait d'un statut (`update_status`, `remove_status`). */
  fieldRename: FieldRenameService
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
 * GH362 — auteur des commits / tags écrits par le MCP (passage released). Les comptes de l'app
 * (`userData`) ne sont pas lisibles ici : config git du repo, sinon le `--user` du serveur, sinon
 * l'auteur par défaut de la marque.
 */
class McpAuthService extends AuthService {
  constructor(private readonly user?: string) { super(mcpHostContext) }

  protected override defaultAuthor(): GitAuthor {
    return this.user ? { name: this.user, email: `${this.user}@${BRAND.id}.local` } : super.defaultAuthor()
  }
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
 * `TreeService` : depuis GH180, un objet créé n'est plus inscrit dans `.polenta/trees/<node>/<type>.yaml`
 * (l'app l'affiche « non classé ») ; GH361 le reconstruit pour les outils de rangement en dossiers,
 * branché comme dans `main/container.ts`.
 *
 * Synchrone — pas de fenêtre à ouvrir, pas d'attente d'`app.whenReady()`.
 *
 * `AuthService`/`SyncService` sont construits (requis transitivement par
 * `WorkspaceTreeService`/`SchemaService`). Aucun clone/push/pull ; seuls commits locaux : passage
 * released d'une version (GH362, `commitSingleFile` + tag annoté) et signature, que le MCP n'expose pas.
 * `getAuthor` y lit `auth.json` (`userData` indisponible : erreur absorbée), puis la config git, puis
 * `--user` (`McpAuthService`). Cf. specs/T122-design.md §2.1 pour l'analyse de sûreté initiale.
 */
/** GH384 — auteur des écritures MCP (`createdBy` / `updatedBy`, historique, liens) : `--user`, sinon `mcp`. */
export function mcpActor(user: string | undefined): string {
  return user?.trim() || 'mcp'
}

export function createMcpContainer(repoPath: string, workspaceDir?: string, user?: string): McpContainer {
  const auth = new McpAuthService(user)
  const git = new GitService()
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const sync = new SyncService(auth)
  const polentaRepo = new PolentaRepoService()
  const workspaceTree = new WorkspaceTreeService(sync, polentaRepo)
  const schema = new SchemaService(auth, workspaceTree)
  // GH77 — écritures MCP : `by` = `--user` / `POLENTA_USER`, `source: mcp`. GH384 — sans utilisateur : `mcp`
  // (et non `local`), comme le `createdBy` des liens (`mcpActor`) : un import MCP se distingue d'une saisie.
  const history = new HistoryService(git, async () => ({ by: mcpActor(user), source: 'mcp' }))
  // T172 — mêmes déclencheurs que l'app : un changement de statut via MCP marque aussi les pairs.
  const revalidation = new RevalidationService(git, reqIndex, testsIndex, schema, workspaceTree, history)
  const requirements = new RequirementsService(git, reqIndex, schema, revalidation, history)
  const tests = new TestsService(git, testsIndex, schema, revalidation, history)
  const campaigns = new CampaignsService(git, tests, undefined, schema, history)
  // GH18 — vue Suivi : même graphe que main/container.ts (sans DashboardSeedService, le
  // seed des dashboards pré-configurés reste propre à l'app). TraceabilityService n'est
  // appelé que pour computeCoverage (pur, ni réseau ni keytar).
  const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
  const dashboards = new DashboardsService(git)
  const savedQueries = new SavedQueriesService(git, dashboards)
  // GH201 — versions : lecture ; écriture et passage released depuis GH362.
  const versions = new VersionsService(
    git, sync, schema, new VersionTrackingService(git, schema), history, workspaceTree,
    (rootRepoPath, wsDir) => revalidation.readonlyRepoPaths(rootRepoPath, wsDir),
  )
  const graph = new GraphService(reqIndex, testsIndex, schema, traceability, git, workspaceTree, campaigns, { cache: false })
  graph.setVersions(versions)
  // GH129 — version testée des runs rattachés à une campagne (GH202), comme dans l'app.
  const testedConfig = new TestedConfigService(versions, sync, tests, campaigns)
  tests.setTestedConfig(testedConfig)
  const issues = new IssuesService(git, schema, history, (r, wsDir) => versions.isReadonly(r, wsDir))
  graph.setIssues(issues)
  // GH206 — contraintes de transition, contrôlées dans le `persist` des trois services.
  const transitionGuard = new TransitionGuardService(traceability)
  for (const service of [requirements, tests, issues]) service.setTransitionGuard(transitionGuard)
  const validations = new ValidationsService(git, sync, schema, versions, traceability, history, new ExecutionHistoryService(tests, campaigns, requirements))
  graph.setValidations(validations)
  versions.setImpactSources({ traceability, campaigns })
  const dashboardLibrary = new DashboardLibraryService(git, workspaceTree)
  const scriptEngine = new ScriptEngineService(graph, dashboardLibrary)
  const suivi = new SuiviService(scriptEngine, graph, savedQueries, dashboards, schema, workspaceTree)
  const workspaceLinks = new WorkspaceLinksService(reqIndex, testsIndex, schema, git, workspaceTree, revalidation, campaigns, issues)
  // GH150 — sans ReqRefsService : les références `{req.<champ>}` restent littérales (lecture seule,
  // sans effet sur les écritures de paramètres).
  const parameters = new ParametersService(git, reqIndex, testsIndex, schema, polentaRepo, revalidation, workspaceTree)
  const resultsImport = new ResultsImportService({ git, tests, testsIndex, reqIndex, campaigns, workspaceLinks, workspaceTree, testedConfig })
  const tree = new TreeService(
    indexObjectLister(reqIndex, testsIndex, p => issues.findAll(p)),
    serviceTitleAdopter(requirements, tests, issues),
  )

  // GH371 — même graphe que main/container.ts (issues et validations comprises).
  const fieldRename = new FieldRenameService(requirements, tests, campaigns, issues, validations, versions)

  return {
    repoPath, workspaceDir, git, schema, requirements, tests, campaigns, versions, issues, validations, transitionGuard, workspaceTree, reqIndex, testsIndex,
    user, savedQueries, dashboards, history, graph, dashboardLibrary, scriptEngine, suivi, workspaceLinks, parameters, resultsImport, tree, fieldRename,
  }
}
