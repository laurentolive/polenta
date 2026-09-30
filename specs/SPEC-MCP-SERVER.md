# SPEC-MCP-SERVER — Serveur MCP Polenta

> Introduit par T122 (sprints 1-4). Documente le point d'entrée du serveur MCP stdio
> exposé par `apps/desktop`, tous les tools qu'il expose (contrats entrée/sortie), et
> le mécanisme de génération/régénération d'`AGENTS.md`/`.mcp.json`.

---

## 1. Vue d'ensemble

Le serveur MCP donne à un agent IA externe (Claude Code, Cursor, Codex, Copilot,
Gemini CLI…) une interface programmatique sur un projet Polenta, en couche fine
au-dessus du **même noyau de services** que l'app Electron (`main/services/*` —
`SchemaService`, `RequirementsService`, `TestsService`, `CampaignsService`,
`WorkspaceTreeService`…), sans dupliquer leur logique (génération d'ID, résolution
d'`objectTypeRef`, validation des champs requis, format des fichiers).

- **Transport** : stdio (JSON-RPC), pas de port HTTP — cohérent avec
  `SPEC-ELECTRON-DESKTOP.md` §1 règle 1 ("Pas de serveur HTTP"). Process Node.js
  autonome, lancé à la demande par le client MCP, indépendant du process Electron
  principal (n'appelle jamais `app.whenReady()`, n'ouvre aucune `BrowserWindow`).
- **Scoping** : un repo fixe par instance — `--repo <path>` au démarrage. Un agent
  connecté ne voit/modifie qu'un seul projet Polenta à la fois.
- **Aucun commit/push automatique** — comme le reste de Polenta (`SPEC-ELECTRON-
  DESKTOP.md` §1 règle 3), les tools écrivent sur le filesystem sans jamais committer ;
  l'utilisateur committe/publie explicitement ensuite depuis l'app.
- **Respect des nœuds `readonly: true`** — tout tool d'écriture (import massif,
  mutation de schéma) refuse d'écrire dans un nœud marqué `readonly: true`.
- **Dry-run obligatoire pour l'import massif** — `bulk_import_*` valide et prévisualise
  par défaut (`dryRun: true`), n'écrit qu'avec `dryRun: false` explicite. Même règle pour
  `create_links`/`delete_links` (GH16, §4.4) et pour toutes les écritures de la vue Suivi
  (GH18, §4.5).
- **Enforcement EARS/cohérence** : hors scope (statu quo) — sauf la vérification EARS
  spécifique aux champs `validator: EARS` dans `bulk_import_*` (cf. §4.1), les autres
  règles de `CLAUDE.md` §"Règles de cohérence" restent documentées dans `AGENTS.md`,
  pas enforcées par le serveur.

---

## 2. Point d'entrée

### 2.1 Développement (monorepo source)

```bash
pnpm --filter @polenta/desktop run mcp-server -- --repo <path> [--workspace <path>]
```

Équivalent : `tsx src/mcp-server/index.ts --repo <path>`. Suppose un `node` sur le
PATH (déjà requis pour `pnpm`/le développement de ce repo).

### 2.2 Arguments / variables d'environnement

| Paramètre | CLI | Variable d'env | Obligatoire | Comportement si absent |
|---|---|---|---|---|
| Repo produit ciblé | `--repo <path>` | `POLENTA_REPO_PATH` | Oui | `process.exit(1)`, message sur **stderr uniquement** (jamais stdout — canal réservé au protocole MCP) |
| Racine workspace multi-repo | `--workspace <path>` | `POLENTA_WORKSPACE_DIR` | Non | Mode mono-repo (cf. §2.3) ; si fourni mais introuvable, avertissement stderr + repli mono-repo (pas un échec) |
| Utilisateur Polenta (GH18) | `--user <login>` | `POLENTA_USER` | Non | Scope **partagé** seulement pour les tools de la vue Suivi (§4.5). Valeur hors `^[A-Za-z0-9][A-Za-z0-9._-]*$` ou contenant `..` → `process.exit(1)`, message stderr. Même login que l'app (nom du fichier `.{login}.pref`). `.mcp.json` généré par l'app ne le pose pas. |

CLI prioritaire si les deux mécanismes sont fournis pour un même paramètre.

### 2.3 Mode mono-repo (workspace absent)

Sans `--workspace`, `resolveComponentRepoPath()` ne route jamais vers un vrai
composant **submodule** (nœud avec `url`) — seuls `root` et les composants
**locaux** (T113/T123, sans `url`, même repo, imbriqués ou non) sont correctement gérés. Avec
`--workspace`, le serveur lit le cache existant
(`<workspaceDir>/.polenta/tree.cache.yaml`) **sans jamais appeler
`buildTree()`/`openWorkspace()`** (qui peuvent déclencher un clone réseau implicite) —
si le cache est absent, repli silencieux en mode mono-repo (avertissement stderr).

### 2.4 Packaging (app Electron installée, hors monorepo source)

Le point d'entrée doit rester invocable depuis une app Electron packagée
(`electron-builder`), sans dépendre de `pnpm`/`tsx`/Node système sur le poste de
l'utilisateur final :

- **Bundle autonome** : `pnpm --filter @polenta/desktop run build:mcp-server` (esbuild,
  `--bundle --platform=node --format=cjs`) produit `out/mcp-server/index.cjs` —
  un seul fichier CJS, sans dépendance à `tsx`. Deux substitutions au bundling :
  - `electron` est **alias-é** vers `src/mcp-server/electron-shim.ts` (objet qui lève
    une erreur explicite si `app`/`shell`/`BrowserWindow` sont réellement invoqués —
    jamais le cas dans les tools MCP de ce ticket, cf. §7 "Limitations connues").
    Évite un `Cannot find module 'electron'` au chargement du bundle packagé (hors
    process Electron, le vrai module `electron` n'est pas résolvable).
  - `keytar` (addon natif `.node`, non bundleable en un seul fichier JS) reste
    `--external`, résolu au runtime par la remontée standard de `node_modules`.
- **`electron-builder.yml`** : `out/mcp-server/**/*` est exclu de `files` (donc de
  `app.asar`) et copié via `extraResources` vers `resources/mcp-server/` — doit
  rester un fichier ordinaire sur disque, lançable comme process séparé. `keytar`
  est copié séparément vers `resources/mcp-server/node_modules/keytar` pour que
  `require('keytar')` le retrouve par résolution Node standard depuis ce dossier.
- **Lancement en build packagé** (`main/services/mcp-launch.util.ts::
  resolveMcpServerLaunchConfig()`, `app.isPackaged === true`) : `command:
  process.execPath` (le binaire Electron packagé lui-même), `args: [
  <resourcesPath>/mcp-server/index.cjs, '--repo', '.']`, `env: {
  ELECTRON_RUN_AS_NODE: '1' }` — fait tourner le binaire Electron packagé comme un
  Node.js ordinaire, sans dépendre d'un Node.js système sur le poste utilisateur
  final (souvent absent, contrairement à un poste de développement).
- **Lancement en dev** (`app.isPackaged === false`) : `command: 'node'`, `args: [
  <appPath>/node_modules/tsx/dist/cli.mjs, <appPath>/src/mcp-server/index.ts,
  '--repo', '.']`, résolu via `app.getAppPath()`.

**Vérification effectuée (T122 sprint 4)** : le bundle esbuild démarre et répond
correctement à un vrai client MCP (`get_schema`, découverte des 12 tools) à la fois
lancé via `node out/mcp-server/index.cjs` (Node système) et via
`ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe
out/mcp-server/index.cjs` (reproduit exactement le mécanisme packagé, sans nécessiter
un build `electron-builder` complet). **Non vérifié dans cet environnement** : un
build `electron-builder` de bout en bout (génération de l'installeur, exécution du
binaire installé) — nécessiterait un temps d'exécution et des outils de signature/
téléchargement (winCodeSign) hors de portée raisonnable de cette session ; la
configuration (`extraResources`, résolution `process.resourcesPath`) suit le
mécanisme standard `electron-builder` documenté, mais reste à valider une fois sur
une vraie installation par l'humain avant une première release packagée.

---

## 3. DI headless (`mcp-server/container.ts`)

`createMcpContainer(repoPath, workspaceDir?)` construit **exactement les mêmes
classes** que `main/container.ts::createContainer()` pour la partie schéma/exigences/
tests/campagnes (`AuthService`, `GitService`, `SyncService`, `PolentaRepoService`,
`WorkspaceTreeService`, `SchemaService`, `RequirementsIndexService`,
`TestsIndexService`, `RequirementsService`, `TestsService`, `CampaignsService`,
`TreeService`) — sans `RepoWatcherService` (chokidar, inutile pour un process à appels
ponctuels) ni les autres services hors périmètre (`ReviewsService`, `TraceabilityService`,
`QueryEngineService`, `DashboardsService`, `ExportService`, `WorkspaceService`,
`BaselineService`, `InterfaceComplianceService`, `SavedQueriesService`,
`DashboardSeedService`).

**T130 : `TreeService` EST construit** (T138, `container.ts` du serveur MCP) — retiré de la
liste "hors périmètre" ci-dessus où il figurait par erreur. Sans lui, les objets créés par ce
serveur MCP sont écrits sur disque mais n'apparaissent jamais dans SystemView/ExcelView (arbre
`.polenta/trees/<nœud>/<type>.yaml` jamais mis à jour).

Synchrone (pas de `createContainer()` async) — pas de fenêtre à ouvrir, pas d'attente
`app.whenReady()`.

**GH18** : le container construit aussi `TraceabilityService`, `QueryEngineService`,
`DashboardsService`, `SavedQueriesService` (même graphe que `main/container.ts`) et expose
`user` — `DashboardSeedService` reste exclu (le seed des dashboards pré-configurés est
propre à l'app). `TraceabilityService` n'est appelé que via `computeCoverage` (pur).

**GH16** : `McpContainer` expose aussi `reqIndex`/`testsIndex`, pour que `create_links`
puisse invalider ces index quand un ID est introuvable (pas de watcher dans ce process).

**Limitation connue documentée** : `AuthService`/`SyncService` sont construits (requis
transitivement) mais aucun tool de ce ticket n'appelle une méthode qui touche
`app.getPath`/`keytar` (lecture seule, pas de clone/push/pull/commit/token). Ceci
repose sur le comportement actuel du code (pas d'appel agressif dans un constructeur),
pas sur une garantie de type — cf. §7.

---

## 4. Tools exposés

Chaque tool retourne un `CallToolResult` MCP standard (`{ content: [{ type: 'text',
text: <JSON> }] }` via `jsonToolResult()`) en cas de succès. Les erreurs de validation
métier **attendues** (prefix pris, nœud readonly, champ manquant…) reviennent comme
`{ isError: true, content: [{ type: 'text', text: <message> }] }` (`errorToolResult()`)
— jamais une exception JS non catchée. Les erreurs **inattendues** (FS, YAML corrompu)
remontent telles quelles, traduites par le SDK MCP en erreur de protocole côté client.

### 4.1 Lecture (`tools/schema.tools.ts`, `tools/read.tools.ts`)

#### `get_schema`

Aucun paramètre. Retourne le `.polenta/schema.yaml` résolu (`ProjectSchema` — nœuds,
types d'objets, champs, statuts, types de lien), identique à `SchemaService.get()` —
y compris le repli sur le schéma par défaut (`root` seul, `objectTypes: []`) si le
repo n'a jamais été initialisé comme projet Polenta.

#### `list_requirements` / `list_tests`

```ts
filters?: { type?: string; status?: string; search?: string }
```

- `list_requirements` réutilise `RequirementsService.findAll` (index MiniSearch sur
  `title`/`statement`/`rationale` pour `search`).
- `list_tests` : `TestsService.findAll()` n'accepte aucun filtre côté service — le
  filtrage `type`/`status`/`search` (substring sur `title` uniquement) est fait en
  mémoire par le tool.

Résultat : `{ items: T[]; total: number; truncated: boolean }` — plafonné à
`LIST_RESULT_LIMIT` = 200 objets ; au-delà, `truncated: true` et `total` reflète le
compte réel (jamais une réponse silencieusement incomplète).

#### `list_campaigns`

```ts
filters?: { component?: string; level?: string }
```

Réutilise `CampaignsService.list(repoPath, component?, level?)` tel quel. Même
plafonnement/troncature que ci-dessus.

### 4.2 Import massif (`tools/bulk-import.tools.ts`)

`bulk_import_requirements` / `bulk_import_tests` / `bulk_import_campaigns` :

```ts
{ entries: TDto[]; dryRun?: boolean }   // dryRun par défaut true
```

- `entries` : mêmes DTOs que la création UI (`CreateRequirementDto`/
  `CreateTestCaseDto` — zod schemas réutilisés tel quel depuis `@polenta/zod-schemas` ;
  `CreateCampaignDto` — zod schema local à ce fichier, pas encore exporté ailleurs).
- **`dryRun: true` (défaut)** : valide chaque entrée, DANS L'ORDRE, la première règle
  en échec arrêtant la validation de CETTE entrée (n'empêche pas les autres) :
  1. `objectTypeRef` résout vers un type existant — `'unresolvable'` (ref
     cross-composant non vérifiable localement) est **accepté** avec avertissement
     implicite, pas une erreur (une entrée sans `objectTypeRef` du tout, ex.
     campagne non typée, saute directement à "valide").
  2. Le nœud propriétaire du type n'est pas `readonly: true` — vérifié même quand le
     TYPE lui-même est `'unresolvable'` (forme normale d'un nœud submodule non
     inliné localement — cf. bug corrigé en revue au sprint 2, `T122-sprint2.md`).
  3. Tous les champs `required: true` du type sont présents et non vides.
  4. Tout champ `validator: EARS` respecte l'un des 5 patterns EARS (réutilise
     `maturity.util.ts::isEarsCompliant`, même heuristique que le dashboard de
     maturité).

  Retourne un aperçu **sans aucune écriture disque** :
  ```ts
  { dryRun: true, summary: { total, ok, failed },
    wouldCreate: [{ index, id /* prévisionnel */ }], created: [], errors: BulkEntryError[] }
  ```
  Les IDs prévisionnels sont calculés par `peekNextCounterId` (lecture seule de
  `config/counters.yaml` + listing du dossier, sans écrire), une fois par préfixe
  distinct du batch, puis un offset en mémoire par préfixe garantit des IDs
  prévisionnels distincts au sein d'un même batch.

- **`dryRun: false`** : réutilise `RequirementsService.create`/`TestsService.create`/
  `CampaignsService.create` **en série** (jamais `Promise.all` — l'ordre conditionne
  les IDs attribués par `nextCounterId`, T118) pour chaque entrée valide. Une entrée
  qui échoue à l'écriture est reportée dans `errors` **sans annuler** les précédentes
  déjà écrites (best-effort, non transactionnel, conforme au spec) :
  ```ts
  { dryRun: false, summary: { total, ok, failed },
    created: [{ index, id /* réel */ }], wouldCreate: [], errors: BulkEntryError[] }
  ```

`BulkEntryError` : `{ index: number; reason: string; field?: string }`.

### 4.3 Mutation de schéma (`tools/schema-mutation.tools.ts`)

Un tool par méthode ciblée de `SchemaService` — chacune : `get()` → valide (lève
`SchemaValidationError` AVANT tout `save()` si un invariant est violé) → construit une
copie immuable du schéma → `save()` (réécriture complète du fichier — atomicité au
niveau du fichier). Toutes les 5 méthodes passent par une file de sérialisation par
`repoPath` (`SchemaService::withMutationQueue`, même classe de bug/remède que T118
pour `counters.yaml` — un agent MCP peut pipeliner plusieurs `add_*` sans attendre la
réponse précédente).

| Tool | Entrée | Refuse si |
|---|---|---|
| `add_component` | `{ name, label, description?, readonly?, parentName? }` | `name` déjà pris par un `SystemNode` existant à n'importe quelle profondeur (y compris `"root"`) — `NODE_NAME_TAKEN` ; `parentName` fourni mais introuvable dans le repo courant — `NODE_NOT_FOUND` |
| `add_object_type` | `{ nodeName, objectType: ObjectTypeDefinition }` | nœud introuvable (`NODE_NOT_FOUND`) ou `readonly` (`NODE_READONLY`) ; `objectType.name` déjà pris dans ce nœud (`TYPE_NAME_TAKEN`) ; `objectType.prefix` déjà utilisé par un type de **n'importe quel** nœud du projet (`PREFIX_TAKEN`, règle 10 CLAUDE.md) |
| `add_field` | `{ nodeName, typeName, field: SchemaField }` | nœud/type introuvables, nœud `readonly`, `field.name` déjà présent (`FIELD_NAME_TAKEN`) |
| `add_status` | `{ nodeName, typeName, status: SchemaStatus }` | nœud/type introuvables, nœud `readonly`, `status.name` déjà présent (`STATUS_NAME_TAKEN`) |
| `add_link_type` | `{ linkType: LinkTypeDefinition }` | `linkType.name` déjà pris (`LINK_TYPE_NAME_TAKEN`) |

`add_component` mappe vers `SchemaService.addNode` (nom de tool aligné sur le
vocabulaire "composant" du spec/UI, nom de méthode aligné sur `SystemNode`).
`parentName` (T123) imbrique le nouveau composant dans les `children[]` du composant local désigné
(même repo uniquement) au lieu de l'ajouter au niveau racine de `nodes[]` — absent, comportement
T122 inchangé.

Réponse succès : le `ProjectSchema` complet mis à jour (`jsonToolResult`). Réponse
refus : `{ isError: true, content: [{ type: 'text', text: '[<CODE>] <message>' }] }`.

`SchemaValidationErrorCode` : `NODE_NAME_TAKEN | NODE_NOT_FOUND | NODE_READONLY |
TYPE_NAME_TAKEN | TYPE_NOT_FOUND | PREFIX_TAKEN | FIELD_NAME_TAKEN |
STATUS_NAME_TAKEN | LINK_TYPE_NAME_TAKEN`.

### 4.4 Liens (`tools/links.tools.ts`, GH16)

Liens (`ObjectLink`) toujours lus/écrits dans `links/links.yaml` du **repo ciblé**
(`--repo`), jamais dans un composant. Chaque tool relit ce fichier depuis le disque
(`RequirementsIndexService.reloadLinks`) : le process MCP n'a pas de `RepoWatcherService`,
son cache peut ignorer un lien créé entre-temps par l'app, et une écriture basée dessus
l'écraserait. `reloadLinks` lève si le fichier a un contenu dont `links` n'est pas un
tableau (fichier absent ou vide → `[]`) ; un YAML invalide lève déjà dans `readYaml`.
Dans l'autre sens, l'app voit les écritures MCP (son watcher invalide l'index sur tout
changement sous `links/`).

#### `list_links`

```ts
{ objectId?: string; type?: string }   →   { links: ObjectLink[] }
```
`objectId` : liens dont l'objet est source **ou** cible ; `type` : `linkTypes[].name`. Filtres
cumulés (ET). Pas de `paginate`.

#### `create_links`

```ts
{ entries: Array<{ type, sourceId, targetId }>; dryRun?: boolean }   // dryRun par défaut true
→ { dryRun, summary: { total, ok, failed },
    wouldCreate: Array<{ index, type, sourceId, targetId }>,   // dryRun: true
    created: Array<{ index, id }>,                              // dryRun: false
    errors: Array<{ index, code, reason }> }
```

Validation stricte (`main/services/link-validation.util.ts::validateLinkEntries`, pure),
par entrée, première règle en échec retenue :

1. `type` ∈ `schema.linkTypes` — sinon `LINK_TYPE_NOT_FOUND`.
2. `sourceId !== targetId` — sinon `SELF_LINK`.
3. Source et cible existent — sinon `OBJECT_NOT_FOUND` (raison : « source »/« cible » + ID).
   Recherche dans `resolveWorkspaceRepoPaths` (repo ciblé seul en mono-repo ; + repos
   composants du cache d'arbre avec `--workspace`) : exigences, tests, campagnes. Si un ID
   du lot est introuvable, les index exigences/tests de ces repos sont invalidés et la
   recherche refaite **une fois** (objet créé par l'app après la construction de l'index).
4. Compatibilité : **catégorie = dossier de stockage** (`requirements/` → `requirement`,
   `tests/` → `test`, `campaigns/` → `campaign`), pas le schéma — un type de composant
   submodule `'unresolvable'` dans le schéma produit a donc une catégorie fiable. Une ref
   `nœud::type` est comparée à l'`objectTypeRef` stocké, sinon à la catégorie ; liste vide
   = tout accepté (même règle que `renderer/.../linkUtils.ts::matchesRefs`, dupliquée).
   Valide si l'un des deux sens est compatible ; le sens fourni est **conservé** (pas de
   normalisation). Sinon `LINK_TYPE_INCOMPATIBLE`.
5. Pas de doublon (même `type`, même paire, quel que soit le sens) avec un lien existant
   ou une entrée valide précédente du lot — sinon `DUPLICATE_LINK` (cite l'id existant).

`dryRun: false` : `RequirementsIndexService.createLinks(repoPath, dtos, 'mcp')` — sous
verrou par repo (`withKeyLock`), relit le fichier, **refait le contrôle de doublon** contre
cet état (appel MCP concurrent, lien ajouté par l'app entre la validation et l'écriture :
l'entrée est alors reportée `DUPLICATE_LINK`), puis **une seule** écriture pour le lot.
Liens créés : `createdBy: 'mcp'`, `createdAt` ISO, id `lnk_<timestamp>_<aléa>` unique.
Ne pose pas `needsRevalidation`. Lot vide → aucune écriture.

#### `delete_links`

```ts
{ ids: string[]; dryRun?: boolean }   // dryRun par défaut true
→ { dryRun, summary, wouldDelete: ObjectLink[] /* dryRun */, deleted: string[] /* réel */,
    errors: Array<{ index, code: 'LINK_NOT_FOUND', reason }> }
```
Id inexistant ou répété dans le lot → `LINK_NOT_FOUND` à son index, les autres sont
traités. `dryRun: false` : `RequirementsIndexService.deleteLinks` (même verrou, relecture,
une seule écriture) ; un lien disparu entre-temps est reporté `LINK_NOT_FOUND`.

Toutes les erreurs par entrée sont dans `errors[]` (jamais `isError`, même si tout le lot
échoue) ; une erreur inattendue (YAML corrompu) remonte en erreur de protocole, fichier
non modifié.

Le chemin IPC de l'UI (`requirements:link-create`/`link-delete`) reste **sans
validation** (hors scope GH16).

### 4.5 Vue Suivi — requêtes et dashboards (`tools/queries.tools.ts`, `tools/dashboards.tools.ts`, GH18)

Helpers communs : `tools/suivi-common.ts` ; règles pures : `main/services/suivi-validation.util.ts`.
Écritures via `SavedQueriesService` / `DashboardsService` (formats et ids de
`SPEC-DASHBOARDS.md` §3), `createdBy: 'mcp'`.

**Règles communes aux écritures** : un objet par appel ; `dryRun` par défaut `true`
(validation complète, requête comprise, aperçu sans écriture — l'id partagé prévu est lu
dans `config/counters.yaml` sans l'incrémenter) ; branche `''`/`prj-*` → `READONLY_BRANCH`
même en dryRun (`readonly-branch.util.ts`, règle partagée avec `DashboardSeedService`).
Erreur attendue → `isError` avec message `[CODE] raison`.

**Scope** : sans `--user`, les services reçoivent une sentinelle `NO_USER` (caractère nul) :
lecture `.pref` → vide, écriture `.pref` physiquement impossible ; toute opération privée →
`PRIVATE_SCOPE_UNAVAILABLE`, un id privé n'est jamais résolu. Un id partagé hors format
`QUERY-NNNN` / `DASHBOARD-NNNN` n'est jamais résolu (`*_NOT_FOUND`) — il servirait de chemin.

**Exécution d'une requête** (`runDefinition`) — échec classé dans l'ordre :
`INVALID_QUERY_DEFINITION` (sqlText XOR builderConfig selon `mode`) → `FORBIDDEN_SQL`
(`isReadOnlySql`) → `INVALID_BUILDER_CONFIG` (`QueryEngineService.inspectBuilderTarget` :
type ou `component` introuvable — **sans** le repli historique de l'exécution UI —, champ
hors allowlist ; opérateurs contrôlés par l'enum zod d'entrée) → `QUERY_EXECUTION_ERROR`
(message AlaSQL). Les index exigences/tests de tous les repos du périmètre sont invalidés
avant chaque exécution (pas de watcher dans ce process).

| Tool | Entrée | Points clés |
|---|---|---|
| `list_queries` | `{ scope? }` | historique jamais exposé |
| `run_query` | `{ queryId? \| definition?, offset?, limit? }` | exactement un des deux (`INVALID_INPUT`) ; sortie `{ sql, columns, rows, total, offset, limit }`, `limit ≤ LIST_RESULT_LIMIT` ; n'écrit pas l'historique |
| `create_query` | `{ title, mode, sqlText?, builderConfig?, scope='shared', dryRun? }` | `DUPLICATE_TITLE` (même scope, casse/espaces ignorés) ; sortie `{ query, preview: { columns, total, sample(5) } }` |
| `update_query` | `{ id, title?, mode?, sqlText?, builderConfig?, dryRun? }` | changer de mode exige la définition complète ; l'autre définition est retirée du YAML ; `warnings: WIDGET_MAPPING_BROKEN` (non bloquant) pour les widgets dont une colonne disparaît ; scope non modifiable |
| `delete_query` | `{ id, dryRun? }` | `QUERY_IN_USE` + liste des widgets (même limite que l'app : dashboards privés d'un autre utilisateur invisibles) |
| `list_dashboards` | `{ scope? }` | widgets dans l'ordre `widgetOrder`, `queryTitle` ; **ne déclenche pas le seed** |
| `create_dashboard` | `{ title, scope='shared', dryRun? }` | créé vide ; `DUPLICATE_TITLE` |
| `update_dashboard` | `{ id, title, dryRun? }` | renommage seul |
| `delete_dashboard` | `{ id, dryRun? }` | widgets embarqués supprimés, requêtes conservées |
| `add_widget` | `{ dashboardId, title, queryId, type, fieldMapping, size='md', position?, dryRun? }` | règles widget ci-dessous ; `position` = index dans `widgetOrder` |
| `update_widget` | `{ dashboardId, widgetId, title?, queryId?, type?, fieldMapping?, size?, dryRun? }` | `fieldMapping` fourni **remplace** l'ancien ; mêmes règles |
| `delete_widget` | `{ dashboardId, widgetId, dryRun? }` | retire aussi l'id de `widgetOrder` |
| `reorder_widgets` | `{ dashboardId, order, dryRun? }` | permutation exacte, sinon `INVALID_ORDER` |

**Règles widget** (dans l'ordre) : `DASHBOARD_NOT_FOUND` → `QUERY_NOT_FOUND` →
`PRIVATE_QUERY_IN_SHARED_DASHBOARD` → exécution de la requête → `MISSING_MAPPING` /
`INVALID_MAPPING` (bar/line/pie : `category`+`measure` ; `series` bar/line ; `stacked` bar
avec `series` ; kpi : `measure` ; table : `columns` optionnel ; clé inconnue rejetée par
zod) → `UNKNOWN_COLUMN` (résultat vide : contrôle sauté, `warnings: COLUMNS_UNVERIFIED`) →
`DUPLICATE_WIDGET` (même requête, type et mapping normalisé). La cohérence type ↔ forme du
résultat n'est pas contrôlée au-delà (`SPEC-DASHBOARDS.md` §4).

**Rafraîchissement de l'app** : cf. `SPEC-DASHBOARDS.md` §6.1.

---

## 5. Génération/régénération d'`AGENTS.md` et `.mcp.json`

### 5.1 À la création d'un nouveau projet

`WorkspaceService.createNewProject()` écrit `AGENTS.md` (`AGENTS_MD_TEMPLATE`,
`agents-md.template.ts`) et `.mcp.json` (`buildMcpJsonContent`,
`mcp-server/mcp-json.template.ts`, avec la commande résolue par
`mcp-launch.util.ts::resolveMcpServerLaunchConfig()`) à côté de `.gitignore`, tous
inclus dans le commit initial `init: create project` — `git status` après création
est propre (rien laissé non suivi).

### 5.2 À l'ouverture d'un projet existant (T122 sprint 4, absorbe T121)

`WorkspaceService.openWorkspace()` appelle `ensureAgentFiles(rootRepoPath)` à
**chaque** ouverture (nouveau projet, projet existant, projet cloné — y compris le
court-circuit "cache de tree valide"), avant tout autre traitement. Best-effort : une
erreur de lecture/écriture (permissions, repo en lecture seule) est journalisée sur
stderr mais n'empêche jamais l'ouverture du projet.

Pour chacun des deux fichiers, `ensureAgentFiles` (factorisé dans
`ensureVersionedFile`) :

1. Lit le fichier existant (s'il existe) et en extrait le marqueur de version
   embarqué :
   - `AGENTS.md` : commentaire en première ligne, `<!-- polenta:agents-md-version:N -->`
     (`extractAgentsMdVersion`).
   - `.mcp.json` : champ JSON racine `_polentaTemplateVersion` (`extractMcpJsonVersion`)
     — les clients MCP ignorent les clés inconnues à la racine, ce champ ne perturbe
     pas la découverte des tools.
2. Compare ce marqueur à la constante courante (`AGENTS_MD_TEMPLATE_VERSION` /
   `MCP_JSON_TEMPLATE_VERSION`, toutes deux `1` au sprint 4 ; `AGENTS_MD_TEMPLATE_VERSION`
   passée à `2` par GH16 — ajout des tools de liens) :
   - **Égal** → **aucune écriture** (mtime/hash strictement inchangés — vérifié
     manuellement, cf. `specs/T122-sprint4.md`).
   - **Absent** (fichier pré-T122/T106, ou créé/édité à la main sans le marqueur) ou
     **périmé** (marqueur < constante courante) → régénération complète (réécriture
     intégrale du fichier).

**Pas une comparaison de contenu byte à byte** : si l'utilisateur a ajouté des notes
personnelles en bas d'`AGENTS.md`, elles ne sont PAS effacées tant que la version du
gabarit n'a pas changé (aucune écriture dans ce cas). En revanche, une régénération
déclenchée par un changement de version **écrase tout le fichier** (pas de merge de
contenu, résolution 3-way explicitement hors scope — cf. `specs/T122.md` "Hors
scope") : des notes ajoutées survivent tant que la version ne bouge pas, mais sont
perdues à la prochaine régénération réelle. Vérifié manuellement (cf.
`specs/T122-sprint4.md`) : marqueur à jour → fichier identique byte pour byte,
mtime inchangé ; marqueur périmé → fichier entièrement régénéré (note utilisateur
ajoutée en bas perdue, comme documenté).

À incrémenter (`AGENTS_MD_TEMPLATE_VERSION`/`MCP_JSON_TEMPLATE_VERSION`) à chaque
changement de contenu du gabarit correspondant qui doit se propager aux projets déjà
créés.

---

## 6. Convention d'erreur

Deux catégories (cf. §4) :

- **Erreur de validation métier attendue** → `{ isError: true, content: [...] }`,
  jamais une exception non catchée.
- **Erreur inattendue** (FS, YAML corrompu, bug) → remonte telle quelle, traduite par
  le SDK MCP en erreur de protocole côté client.

---

## 7. Limitations connues

- **Mode mono-repo par défaut** (§2.3) : sans `--workspace`, un `objectTypeRef` vers un
  vrai composant submodule (nœud avec `url`) retombe silencieusement sur le repo
  produit — pas une erreur, mais pas le comportement attendu pour un vrai submodule.
  Pour `create_links` (GH16), un objet vivant dans un repo composant n'est pas trouvé
  sans `--workspace` → `OBJECT_NOT_FOUND`.
- **Liens : fenêtre de course inter-process résiduelle** (GH16) — le verrou de
  `createLinks`/`deleteLinks` est propre au process MCP ; une écriture de l'app sur
  `links.yaml` entre la relecture sous verrou et l'écriture MCP (quelques ms) serait
  perdue. Même niveau de risque que les autres écritures YAML read-modify-write.
- **`add_object_type.prefix` : scan mono-repo, pas workspace-wide** — le contrôle
  d'unicité (règle 10 CLAUDE.md) ne porte que sur `schema.nodes` du repo COURANT ;
  les prefixes d'un vrai composant submodule (schéma vivant dans un autre repo, non
  chargé) ne sont pas visibles. Sur un produit avec de vrais submodules git,
  `add_object_type` peut donc accepter un prefix qui collisionne avec un composant
  externe non chargé.
- **`readonly` non vérifié dans `RequirementsService.create`/`TestsService.create`/
  `CampaignsService.create` eux-mêmes** — le refus `readonly` (bulk import) est une
  garde de la seule couche de validation MCP (`bulk-import-validation.util.ts`),
  appliquée uniquement au chemin MCP ; l'UI reste, comme avant ce ticket, sans
  protection `readonly` sur l'écriture directe (constat préexistant, hors scope).
- **`AuthService`/`SyncService` construits mais jamais réellement invoqués par les
  tools de ce ticket** (§3) — repose sur le comportement actuel du code, pas une
  garantie de type. Un futur sprint qui élargirait l'usage de
  `WorkspaceTreeService`/`SchemaService` au point d'appeler `app.getPath`/`keytar`
  devra vérifier l'absence d'appel réel depuis un tool MCP, ou durcir avec des
  `Noop*Service` typés (alternative déjà envisagée, rejetée par simplicité).
- **Repli silencieux de `SchemaService.readFromDisk()` sur `DEFAULT_SCHEMA`** en cas
  d'échec de lecture/parse (fichier absent ET YAML corrompu traités pareil) —
  désormais exploité par des écritures autonomes (`add_*` depuis un agent MCP, sans
  supervision humaine) : un `schema.yaml` transitoirement illisible pourrait voir un
  `add_*` réussir silencieusement sur un schéma quasi vide et écraser le fichier
  réel. Risque réel, documenté au sprint 3, non corrigé (cross-cutting, partagé par
  tous les appelants de `SchemaService`, hors périmètre de ce ticket).
- **Vue Suivi (GH18)** : `delete_query` ne voit pas les widgets des dashboards privés d'un
  *autre* utilisateur (même limite que l'app) ; course inter-process résiduelle sur
  `config/counters.yaml` et sur un même fichier de dashboard (écriture app + MCP
  simultanées) ; `run_query` reconstruit les index à chaque appel (coûteux sur un très gros
  workspace).
- **Bundle `alasql`** (GH18) : la build Node d'alasql contient des `require('react-native…')`
  (try/catch ou branches React Native) — marqués `--external` dans `build:mcp-server`.
- **Packaging non vérifié de bout en bout** (§2.4) : bundle + mécanisme
  `ELECTRON_RUN_AS_NODE` vérifiés directement ; un build `electron-builder` complet
  (installeur réel) ne l'a pas été dans cet environnement.

---

## 8. Fichiers

| Fichier | Rôle |
|---|---|
| `apps/desktop/src/mcp-server/index.ts` | Point d'entrée exécutable (parse args, construit le container, enregistre les tools, connecte `StdioServerTransport`) |
| `apps/desktop/src/mcp-server/container.ts` | DI headless (`createMcpContainer`) |
| `apps/desktop/src/mcp-server/mcp-types.ts` | `paginate`, `jsonToolResult`, `errorToolResult`, `LIST_RESULT_LIMIT` |
| `apps/desktop/src/mcp-server/mcp-json.template.ts` | Contenu/version de `.mcp.json` (`buildMcpJsonContent`, `extractMcpJsonVersion`) |
| `apps/desktop/src/mcp-server/electron-shim.ts` | Substitut d'`electron` pour le bundle packagé (esbuild `--alias`) |
| `apps/desktop/src/mcp-server/tools/schema.tools.ts` | `get_schema` |
| `apps/desktop/src/mcp-server/tools/read.tools.ts` | `list_requirements`, `list_tests`, `list_campaigns` |
| `apps/desktop/src/mcp-server/tools/bulk-import.tools.ts` | `bulk_import_requirements`, `bulk_import_tests`, `bulk_import_campaigns` |
| `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` | `add_component`, `add_object_type`, `add_field`, `add_status`, `add_link_type` |
| `apps/desktop/src/mcp-server/tools/links.tools.ts` | `list_links`, `create_links`, `delete_links` (GH16) |
| `apps/desktop/src/mcp-server/tools/suivi-common.ts` | Helpers vue Suivi : `NO_USER`, `resolveUser`, `assertWritableBranch`, `freshenIndexes`, `runDefinition`, `findVisibleQuery`/`findVisibleDashboard`, `peekSharedId` (GH18) |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts` | `list_queries`, `run_query`, `create_query`, `update_query`, `delete_query` (GH18) |
| `apps/desktop/src/mcp-server/tools/dashboards.tools.ts` | `list_dashboards`, `create/update/delete_dashboard`, `add/update/delete_widget`, `reorder_widgets` (GH18) |
| `apps/desktop/src/main/services/suivi-validation.util.ts` | Validation pure vue Suivi : codes, définition de requête, titres, widget, ordre (GH18) |
| `apps/desktop/src/main/services/readonly-branch.util.ts` | `isReadonlyBranch` (GH18, partagé avec `DashboardSeedService`) |
| `apps/desktop/src/main/services/link-validation.util.ts` | `validateLinkEntries`, `matchesRefs` (GH16, logique pure) |
| `apps/desktop/src/main/services/requirements-index.service.ts` | `reloadLinks`/`createLinks`/`deleteLinks` (GH16 — relecture disque, verrou par repo, écriture unique par lot) |
| `apps/desktop/src/main/services/bulk-import-validation.util.ts` | `validateBulkEntries` (logique métier pure) |
| `apps/desktop/src/main/services/id-counter.util.ts` | `nextCounterId` (T118) + `peekNextCounterId`/`formatCounterId` (T122) |
| `apps/desktop/src/main/services/schema.service.ts` | `addNode`/`addObjectType`/`addField`/`addStatus`/`addLinkType`, `SchemaValidationError`, `withMutationQueue` |
| `apps/desktop/src/main/services/agents-md.template.ts` | `AGENTS_MD_TEMPLATE`, `AGENTS_MD_TEMPLATE_VERSION`, `extractAgentsMdVersion` |
| `apps/desktop/src/main/services/mcp-launch.util.ts` | `resolveMcpServerLaunchConfig` (dev vs packagé) |
| `apps/desktop/src/main/services/workspace.service.ts` | `createNewProject` (écriture initiale), `ensureAgentFiles`/`ensureVersionedFile` (contrôle/régénération à l'ouverture) |
| `apps/desktop/electron-builder.yml` | `extraResources` (bundle mcp-server + `keytar`) |
| `apps/desktop/package.json` | Scripts `mcp-server` (dev), `build:mcp-server` (bundle esbuild), dépendance `@modelcontextprotocol/sdk` |
