# T122-sprint1 — Squelette serveur MCP + DI headless + tools de lecture

## Fichiers modifiés

Nouveaux :
- `apps/desktop/src/mcp-server/container.ts` — `createMcpContainer(repoPath, workspaceDir?)`, DI headless.
- `apps/desktop/src/mcp-server/index.ts` — point d'entrée exécutable (`--repo`/`--workspace`, repli env vars, `StdioServerTransport`).
- `apps/desktop/src/mcp-server/mcp-types.ts` — `paginate()`, `jsonToolResult()`, `LIST_RESULT_LIMIT`.
- `apps/desktop/src/mcp-server/tools/schema.tools.ts` — tool `get_schema`.
- `apps/desktop/src/mcp-server/tools/read.tools.ts` — tools `list_requirements`, `list_tests`, `list_campaigns`.

Modifiés :
- `apps/desktop/package.json` — dépendance `@modelcontextprotocol/sdk` (^1.29.0, dernière stable au moment du sprint), `zod` bumpé de `^3.23.0` à `^3.25.76` (toujours zod 3.x, requis par le SDK ; aucune autre dépendance du repo n'est affectée), devDependency `tsx` (^4.23.1), script `"mcp-server": "tsx src/mcp-server/index.ts"`.
- `pnpm-lock.yaml` — régénéré par `pnpm add`.
- `TICKETS.md` — T122 passé en statut `coding sprint 1`.

Non modifiés (conforme au design §7) : `apps/desktop/src/main/container.ts`, `apps/desktop/src/main/ipc/index.ts`.

## Prérequis T118 — déjà satisfait

Vérifié en tout début de sprint : `master` a été mergé dans `T122` après l'archivage
de T118 (`git log` : `...5176f92 chore: T118 — archive ticket after validation` puis
`8124e82 Merge branch 'master' into T122`), et `apps/desktop/src/main/services/id-counter.util.ts`
est bien présent avec `nextCounterId()` sérialisé. L'action "merge T118 dans T122"
prévue en Design §0 était donc déjà faite — aucune action supplémentaire nécessaire.

## Comportement implémenté

- `createMcpContainer(repoPath, workspaceDir?)` instancie `AuthService`, `GitService`,
  `SyncService`, `PolentaRepoService`, `WorkspaceTreeService`, `SchemaService`,
  `RequirementsIndexService`, `TestsIndexService`, `RequirementsService`,
  `TestsService`, `CampaignsService` — même graphe de dépendances que
  `main/container.ts`, sans `RepoWatcherService` ni les services hors périmètre
  (Reviews/Traceability/QueryEngine/Dashboards/Export/Workspace/Tree/Baseline/
  InterfaceCompliance/SavedQueries/DashboardSeed).
- `index.ts` parse `--repo`/`--workspace` (CLI prioritaire) avec repli sur
  `POLENTA_REPO_PATH`/`POLENTA_WORKSPACE_DIR` ; échoue avec `process.exit(1)` et un
  message **stderr uniquement** si `--repo` est absent ou introuvable sur disque ;
  un `--workspace` introuvable dégrade proprement en mode mono-repo (avertissement
  stderr, pas d'échec).
- 4 tools enregistrés : `get_schema` (aucun paramètre), `list_requirements`/
  `list_tests` (`filters: { type?, status?, search? }`), `list_campaigns`
  (`filters: { component?, level? }`).
  - `list_requirements` réutilise `RequirementsService.findAll` (donc
    `RequirementsIndexService` + MiniSearch, recherche sur `title`/`statement`/
    `rationale`) tel quel.
  - `list_tests` : `TestsService.findAll()` ne prenant aucun filtre côté service,
    le filtrage `type`/`status`/`search` est fait en mémoire dans le tool (recherche
    substring sur `title` uniquement — moins riche que l'index MiniSearch des
    exigences, cf. divergence ci-dessous), tri par ID reproduit manuellement.
  - `list_campaigns` réutilise `CampaignsService.list(repoPath, component?, level?)`
    tel quel.
  - Chaque liste est plafonnée à 200 objets (`LIST_RESULT_LIMIT`), avec `total` et
    `truncated` toujours renvoyés.
- Aucun tool d'écriture dans ce sprint — conforme au périmètre.

## Divergences par rapport au design

- **Aucune divergence de périmètre.** Une seule précision d'implémentation : le
  design ne détaille pas explicitement comment `repoPath`/`workspaceDir` sont
  transmis aux tools ; ils sont portés par `McpContainer` (champs `repoPath` et
  `workspaceDir` en plus des 6 services listés en §2.2 du design) plutôt que
  capturés séparément — plus simple qu'un second paramètre à faire circuler partout,
  et cohérent avec "Retourne `{ schema, requirements, tests, campaigns, workspaceTree, git }`"
  qui n'était pas présenté comme une liste exhaustive.
- **`list_tests` recherche uniquement sur `title`**, pas sur un contenu plus large
  (pas d'équivalent `statement`/`rationale` pour un `TestCase` de toute façon — les
  champs pertinents seraient `preconditions`/`postconditions`/`steps[].action`, non
  indexés). Le design actait déjà "filtrage fait en mémoire... besoin propre à
  l'exploration MCP" sans figer le champ exact ; `title` seul est documenté dans la
  description du tool pour que l'agent appelant ne suppose pas une recherche
  plein-texte équivalente à `list_requirements`.
- **Dette technique documentée (reprise du design §2.1, pas nouvelle)** :
  `AuthService`/`SyncService` sont construits mais aucune méthode touchant
  `app.getPath`/`keytar` n'est jamais appelée par les tools de ce sprint (lecture
  seule). Ceci repose sur le comportement actuel du code (electron non importé de
  façon agressive dans un constructeur), pas sur une garantie de type — un futur
  sprint qui élargirait l'usage de `WorkspaceTreeService`/`SchemaService` devra
  vérifier qu'aucun appel réel à ces méthodes n'est introduit, ou durcir avec des
  `Noop*Service` typés (alternative déjà rejetée pour ce sprint par simplicité,
  cf. design).

## Vérifications effectuées

- `pnpm --filter @polenta/desktop run typecheck` → 0 erreur.
- `pnpm run lint` (racine, `turbo lint`) → `apps/desktop` n'a pas de script `lint`
  (pré-existant, pas introduit par ce sprint) ; `turbo lint` échoue sur
  `apps/api#lint` (`'eslint' n'est pas reconnu...`) — échec pré-existant de
  l'environnement (`eslint` non installé dans `apps/api`), sans rapport avec ce
  diff, confirmé en lisant `apps/api/package.json`/l'absence d'installation locale
  d'eslint. Aucune régression introduite par ce sprint.
- `/code-review` sur le diff : 1 point mineur relevé (double appel
  `fs.existsSync(workspaceDir)` dans `index.ts`) — corrigé (factorisé en
  `workspaceDirExists`). Aucun bug de correctness trouvé.
- Vérification manuelle bout-en-bout via un vrai client MCP (`@modelcontextprotocol/sdk`
  `Client`/`StdioClientTransport`, script jetable, supprimé après usage) contre
  `C:\Dev\polenta-demo\aspirateur-demo` (repo Polenta réel, non trivial : plusieurs
  nœuds/types, 34 exigences, 8 tests, 4 campagnes) :
  - Découverte : les 4 tools (`get_schema`, `list_requirements`, `list_tests`,
    `list_campaigns`) sont bien listés.
  - `get_schema` retourne le schéma fidèle au fichier disque.
  - `list_requirements` sans filtre → 34 résultats, triés par ID, `truncated: false`.
  - `list_requirements` avec `filters: { status: 'approved' }` → 3 résultats, tous
    `status === 'approved'`.
  - `list_tests`/`list_campaigns` sans filtre → 8 / 4 résultats.
  - Repo inexistant (`--repo C:\Dev\does-not-exist-xyz`) → exit code 1, **stdout
    strictement vide**, message d'erreur explicite sur stderr uniquement.
  - Repo git valide mais sans `.polenta/schema.yaml` (dossier neuf, `git init`) →
    démarre sans erreur, `get_schema` retourne le schéma par défaut (`root` seul,
    `objectTypes: []`), `list_requirements`/`list_tests`/`list_campaigns` renvoient
    des listes vides (`total: 0`) sans erreur.
  - Aucune écriture disque : `git status` dans le repo de test avant/après est
    identique pour tout ce qui touche à nos tools (le repo de démo avait déjà des
    modifications non committées préexistantes, avec des timestamps ~7h avant cette
    session — confirmé sans rapport avec ce sprint, qui n'expose que des tools en
    lecture seule).

Pas d'infrastructure de test automatisé pour ces services (cf. T122-tests.md,
hérité de T118) — les scénarios ci-dessus reprennent 1 à 4, 8, 9, 10 de
`specs/T122-tests.md` (scénario 11 "volume > 200" et 12 "--workspace absent avec
ref cross-composant" non exercés faute de fixture adaptée sous la main ; le code
de troncature/repli est identique pour tous les volumes et a été relu ligne à
ligne, risque jugé faible).

## Comment tester manuellement

```bash
# Démarrer le serveur sur un repo Polenta existant
pnpm --filter @polenta/desktop run mcp-server -- --repo "C:\chemin\vers\repo-polenta"

# Ou via variables d'environnement
POLENTA_REPO_PATH="C:\chemin\vers\repo-polenta" pnpm --filter @polenta/desktop run mcp-server
```

Le process reste actif en attente sur stdio (pas de sortie tant qu'aucun client ne
se connecte). Pour l'interroger avec un vrai client MCP, ajouter dans
`.mcp.json` à la racine du repo cible (ou de ce worktree, pour un test rapide) :

```json
{
  "mcpServers": {
    "polenta": {
      "command": "node",
      "args": [
        "C:\\Dev\\polenta-T122\\apps\\desktop\\node_modules\\tsx\\dist\\cli.mjs",
        "C:\\Dev\\polenta-T122\\apps\\desktop\\src\\mcp-server\\index.ts",
        "--repo",
        "C:\\chemin\\vers\\repo-polenta"
      ]
    }
  }
}
```

puis se connecter avec un client MCP compatible (ex. Claude Code) et appeler
`get_schema`, `list_requirements`, `list_tests`, `list_campaigns` (avec ou sans
`filters`).

## Ce qui reste (hors périmètre de ce sprint)

- Sprint 2 : `bulk_import_requirements`/`bulk_import_tests`/`bulk_import_campaigns`
  avec dry-run (`bulk-import-validation.util.ts`, `peekNextCounterId`).
- Sprint 3 : `add_component`/`add_object_type`/`add_field`/`add_status`/
  `add_link_type` (nouvelles méthodes `SchemaService` + `SchemaValidationError`).
- Sprint 4 : `AGENTS.md` mis à jour, `.mcp.json` généré par
  `WorkspaceService.createNewProject()`, packaging (`electron-builder.yml`),
  `specs/SPEC-MCP-SERVER.md`.
