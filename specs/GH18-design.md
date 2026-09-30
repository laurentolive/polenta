# GH18 — Design : tools MCP de la vue Suivi (requêtes, dashboards, widgets)

> Spec : `specs/GH18.md` — **2 sprints** (§8).

## 1. Vue d'ensemble

```
mcp-server/index.ts            ← +--user / POLENTA_USER, registerQueryTools, registerDashboardTools
mcp-server/container.ts        ← +traceability, queryEngine, savedQueries, dashboards, user
mcp-server/tools/
  suivi-common.ts              ← NOUVEAU : utilisateur, branche readonly, fraîcheur des index, exécution classée
  queries.tools.ts             ← NOUVEAU : list_queries, run_query, create/update/delete_query
  dashboards.tools.ts          ← NOUVEAU : list_dashboards, create/update/delete_dashboard,
                                            add/update/delete_widget, reorder_widgets
main/services/
  suivi-validation.util.ts     ← NOUVEAU (pur) : définition de requête, titres, widget, ordre
  query-engine.service.ts      ← +isReadOnlySql (export), +inspectBuilderTarget
  saved-queries.service.ts     ← UpdateSavedQueryDto +mode, nettoyage de l'autre définition
  readonly-branch.util.ts      ← NOUVEAU : isReadonlyBranch (factorisé depuis DashboardSeedService)
renderer/hooks/useLiveFileSync.ts ← invalidation queries/ dashboards/ .{user}.pref
```

Même découpage que GH16 / `bulk_import_*` : règles métier dans une fonction **pure** de
`main/services/*.util.ts`, le tool fait les lectures (services existants), appelle la
validation, puis écrit via les services existants (`SavedQueriesService`,
`DashboardsService`). Aucune écriture YAML/`.pref` n'est réimplémentée dans les tools.

## 2. Fichiers modifiés / créés

| Fichier | Nature | Pourquoi |
|---|---|---|
| `src/mcp-server/index.ts` | modifié | parse `--user`, validation du nom, passage au container, enregistrement des 2 familles de tools |
| `src/mcp-server/container.ts` | modifié | construit `TraceabilityService`, `QueryEngineService`, `DashboardsService`, `SavedQueriesService` (graphe identique à `main/container.ts` l. 59–74) ; expose `user?: string` |
| `src/mcp-server/tools/suivi-common.ts` | nouveau | helpers partagés (§4) |
| `src/mcp-server/tools/queries.tools.ts` | nouveau | 5 tools requêtes |
| `src/mcp-server/tools/dashboards.tools.ts` | nouveau | 8 tools dashboards/widgets |
| `src/main/services/suivi-validation.util.ts` | nouveau | validation pure (§5) |
| `src/main/services/query-engine.service.ts` | modifié | `isReadOnlySql` exporté ; `inspectBuilderTarget` public |
| `src/main/services/saved-queries.service.ts` | modifié | `UpdateSavedQueryDto.mode` ; `update` efface la définition de l'autre mode |
| `src/main/services/readonly-branch.util.ts` | nouveau | `isReadonlyBranch(branch)` ; réutilisé par `DashboardSeedService` (l. 150) |
| `src/main/services/dashboard-seed.service.ts` | modifié | utilise `isReadonlyBranch` (pas de changement de comportement) |
| `src/renderer/hooks/useLiveFileSync.ts` | modifié | rafraîchissement live (spec §4) |
| `src/main/services/agents-md.template.ts` | modifié | section Vue Suivi ; `AGENTS_MD_TEMPLATE_VERSION` 2 → 3 |
| `specs/SPEC-MCP-SERVER.md`, `specs/SPEC-DASHBOARDS.md`, `specs/SPEC-INDEX.md` | modifiés | cf. spec §6 |

Chemins IPC de l'UI (`queries:*`, `dashboards:*`) : **inchangés**, hormis l'effet de
`UpdateSavedQueryDto.mode` (optionnel, jamais envoyé par l'UI actuelle).

## 3. Utilisateur (`--user`)

### 3.1 Parsing (`index.ts`)
- `parseArgs` : `--user <v>` ; repli `process.env.POLENTA_USER`.
- Validation : `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` et pas de `..` → sinon stderr +
  `process.exit(1)`. (Couvre `/`, `\`, `:`, espaces, vide, nom commençant par `.`.)
- Log de démarrage : ajoute `, user: <v>` si fourni.

### 3.2 Sans utilisateur : sentinelle
Les services existants exigent un `username` à chaque appel et lisent `.{username}.pref`
même pour lister le partagé. Plutôt que de rendre `username` optionnel dans deux services
(signature touchée par ~25 handlers IPC), les tools passent une **sentinelle**
`NO_USER = '\u0000no-user'` quand `--user` est absent :
- lecture : `readPref` échoue sur le caractère nul → `catch` → `{}` → aucun privé ;
- écriture : `writeFileSync` lèverait sur le caractère nul — garantie qu'aucun `.pref`
  parasite n'est jamais créé. Les tools refusent de toute façon en amont
  (`PRIVATE_SCOPE_UNAVAILABLE`) toute opération sur un scope/id privé.

Helper `resolveUser(container): { username: string; hasUser: boolean }`.
Un id privé se reconnaît avec `isPrivateScopeId` (existant, `id-scope.util.ts`).

*Alternative rejetée* : `username: string | null` dans les services — diff large sur le
chemin UI pour un besoin propre au MCP.

## 4. Helpers communs (`tools/suivi-common.ts`)

```ts
export const NO_USER: string
export function resolveUser(c: McpContainer): { username: string; hasUser: boolean }

/** [CODE] raison → errorToolResult. */
export function suiviError(code: SuiviErrorCode, reason: string): ReturnType<typeof errorToolResult>

/** READONLY_BRANCH si branche '' ou prj-* (git.currentBranch, erreur → ''). */
export async function assertWritableBranch(c: McpContainer): Promise<ReturnType<typeof errorToolResult> | null>

/** Invalide reqIndex/testsIndex de tous les repos du périmètre (resolveWorkspaceRepoPaths)
 *  — le process MCP n'a pas de watcher : sans ça, run_query renverrait un état périmé. */
export async function freshenIndexes(c: McpContainer): Promise<void>

/** Exécute une définition et classe l'échec. */
export async function runDefinition(c: McpContainer, def: QueryDefinition):
  Promise<{ ok: true; sql: string; result: QueryResult } | { ok: false; code: SuiviErrorCode; reason: string }>
```

`runDefinition`, dans l'ordre :
1. `validateQueryDefinitionShape(def)` (pur, §5) → `INVALID_QUERY_DEFINITION`.
2. SQL : `isReadOnlySql(sqlText)` faux → `FORBIDDEN_SQL`.
3. Builder : `queryEngine.inspectBuilderTarget(...)` → `resolved: false` ou champ hors
   allowlist ou opérateur inconnu → `INVALID_BUILDER_CONFIG`. SQL finale obtenue par
   `queryEngine.builderToSql` (existant).
4. `freshenIndexes` puis `queryEngine.execute(repoPath, def, workspaceDir)` ; exception →
   `QUERY_EXECUTION_ERROR` avec le message (préfixe `Requête invalide : ` retiré).

`freshenIndexes` est appelé une fois par tool (pas une fois par exécution quand un tool
exécute plusieurs requêtes, ex. `update_query` qui revérifie les widgets : une seule
exécution suffit, c'est la même requête).

## 5. Validation pure (`main/services/suivi-validation.util.ts`)

```ts
export type SuiviErrorCode =
  | 'INVALID_INPUT' | 'PRIVATE_SCOPE_UNAVAILABLE' | 'READONLY_BRANCH'
  | 'INVALID_QUERY_DEFINITION' | 'FORBIDDEN_SQL' | 'INVALID_BUILDER_CONFIG' | 'QUERY_EXECUTION_ERROR'
  | 'QUERY_NOT_FOUND' | 'QUERY_IN_USE' | 'DASHBOARD_NOT_FOUND' | 'WIDGET_NOT_FOUND'
  | 'DUPLICATE_TITLE' | 'PRIVATE_QUERY_IN_SHARED_DASHBOARD' | 'MISSING_MAPPING'
  | 'INVALID_MAPPING' | 'UNKNOWN_COLUMN' | 'DUPLICATE_WIDGET' | 'INVALID_ORDER'
export type SuiviWarningCode = 'COLUMNS_UNVERIFIED' | 'WIDGET_MAPPING_BROKEN'
export interface SuiviIssue { code: SuiviErrorCode; reason: string }
export interface SuiviWarning { code: SuiviWarningCode; reason: string; widgetId?: string; dashboardId?: string }

export function validateQueryDefinitionShape(def: { mode; sqlText?; builderConfig? }): SuiviIssue | null
export function normalizeTitle(t: string): string          // trim + toLocaleLowerCase
export function findDuplicateTitle<T extends { id: string; title: string; scope: QueryScope }>(
  items: T[], title: string, scope: QueryScope, excludeId?: string): T | null
/** Règles 5 à 7 d'add_widget (mapping requis, mapping autorisé, colonnes, doublon).
 *  resultColumns = null ⇒ résultat vide : contrôle des colonnes sauté + warning. */
export function validateWidget(
  widget: { type; fieldMapping; queryId },
  resultColumns: string[] | null,
  siblings: Widget[],                                        // autres widgets du dashboard
): { issue: SuiviIssue | null; warnings: SuiviWarning[] }
export function mappingColumns(m: WidgetFieldMapping): string[]   // category, measure, series, columns[]
export function validateOrder(current: string[], order: string[]): SuiviIssue | null
```

- `validateQueryDefinitionShape` : exclusivité `sqlText` / `builderConfig` selon `mode`,
  `sqlText.trim()` non vide, `builderConfig.combinator ∈ {AND, OR}`, `conditions` tableau.
- Mapping requis/autorisé (spec §3 `add_widget` règle 5) :

  | type | requis | autorisés |
  |---|---|---|
  | `bar` | category, measure | + series, stacked (stacked seulement si series) |
  | `line` | category, measure | + series |
  | `pie` | category, measure | — |
  | `kpi` | measure | — |
  | `table` | — | columns |

- Doublon de widget : même `queryId`, même `type`, et `fieldMapping` égal après
  normalisation (clés triées, `undefined`/`false` pour `stacked` équivalents, `columns`
  comparé dans l'ordre).
- Colonnes du résultat : `result.rows.length === 0 ? null : result.columns.map(c => c.name)`.

## 6. Moteur de requête (`query-engine.service.ts`)

```ts
export function isReadOnlySql(sql: string): boolean   // !FORBIDDEN_SQL.test(stripStringLiterals(sql))
// assertReadOnlySql réécrit en s'appuyant dessus (comportement inchangé).

/** Cible d'un builderConfig SANS repli silencieux : resolved=false si le type est
 *  introuvable dans le schéma du composant (l'UI garde son repli historique via
 *  resolveTableInfo, inchangé). */
async inspectBuilderTarget(repoPath: string, objectTypeRef: string, component: string | undefined,
  workspaceDir?: string): Promise<{ resolved: boolean; table: QueryTable; allowedFields: string[] }>
```

`inspectBuilderTarget` réutilise `resolveTableInfo` (factoriser pour retourner aussi
`resolved`). La vérification des champs/opérateurs est faite par le tool avec
`allowedFields` et les clés de `OPERATOR_SQL` (exporter `SUPPORTED_OPERATORS`).

`TraceabilityService` est construit avec `sync` (déjà dans le container MCP) ;
`computeCoverage`, seule méthode appelée par le moteur, ne touche ni réseau ni `keytar`
(même constat que `SPEC-MCP-SERVER.md` §3 pour `AuthService`/`SyncService`).

## 7. Tools — mise en œuvre

Zod pour toutes les entrées (idiome `links.tools.ts`). `dryRun: z.boolean().optional().default(true)`.
Toutes les erreurs de validation → `suiviError(code, reason)` ; aucune exception pour un
cas prévu. Ordre commun aux écritures : entrée zod → `assertWritableBranch` →
contrôle scope privé / utilisateur → existence → validation → exécution → écriture si
`!dryRun`.

### 7.1 `queries.tools.ts`
- `list_queries` : `savedQueries.list(repo, username)`, filtre `scope`.
- `run_query` : `queryId` → `savedQueries.findOne` (privé sans user → `QUERY_NOT_FOUND`) ;
  `runDefinition` ; sortie `{ sql, columns, rows: rows.slice(offset, offset+limit), total,
  offset, limit }`, `limit` défaut et max `LIST_RESULT_LIMIT`.
- `create_query` : scope `private` sans user → `PRIVATE_SCOPE_UNAVAILABLE` ; titre vide →
  `INVALID_INPUT` ; `findDuplicateTitle(list, title, scope)` ; `runDefinition`.
  `dryRun` : objet prévisualisé avec `id` = `peekNextCounterId(repo,'QUERY','QUERY')`
  (partagé) ou `'(généré à l'écriture)'` (privé), `createdBy: 'mcp'`, `createdAt` courant.
  Sinon `savedQueries.create(repo, username, { ..., createdBy: 'mcp' })`.
  `preview = { columns, total: rows.length, sample: rows.slice(0, 5) }`.
- `update_query` : `findOne` ; id privé sans user → `PRIVATE_SCOPE_UNAVAILABLE` ;
  fusion : si `mode` fourni et ≠ existant, la définition du nouveau mode est requise
  (sinon `INVALID_QUERY_DEFINITION`) et celle de l'ancien est effacée ; `runDefinition` ;
  titre → `findDuplicateTitle(..., excludeId: id)` ; widgets dépendants
  (`dashboards.findDependentWidgets`) → pour chacun, `mappingColumns` absent des colonnes
  → warning `WIDGET_MAPPING_BROKEN` (rien si résultat vide). Écriture via
  `savedQueries.update` (DTO étendu, §7.3).
- `delete_query` : `findOne` ; `findDependentWidgets` non vide → `QUERY_IN_USE` (liste en
  JSON dans la raison) ; sinon `savedQueries.delete`. Le contrôle est fait par le tool
  **avant** l'appel pour renvoyer un code propre ; le garde du service reste (défense en
  profondeur).

### 7.2 `dashboards.tools.ts`
- Lecture d'un dashboard : `dashboards.get(repo, username, id)` (null → `DASHBOARD_NOT_FOUND`).
- `list_dashboards` : `dashboards.list` (**pas** `dashboardSeed`), filtre `scope`, widgets
  retriés selon `widgetOrder` (ids hors ordre ajoutés à la fin, comme la vue Dashboard),
  `queryTitle` résolu depuis une seule lecture `savedQueries.list`.
- `create_dashboard` / `update_dashboard` / `delete_dashboard` : même schéma que les
  requêtes ; `update` → `dashboards.update(..., { title })`.
- `add_widget` : règles 1–4 (existence, scope via `isPrivateScopeId(queryId)` sur dashboard
  partagé, type/size par zod) → `runDefinition` de la requête du widget → `validateWidget`
  → écriture `dashboards.addWidget` puis, si `position` fournie et ≠ fin,
  `dashboards.setWidgetOrder` avec l'id inséré (deux écritures successives du même
  fichier, acceptable : mono-process, pas d'intervalle d'attente entre elles). `dryRun` :
  widget prévisualisé avec `id: '(généré à l'écriture)'`.
- `update_widget` : widget introuvable → `WIDGET_NOT_FOUND` ; fusion (fieldMapping
  **remplacé**) puis mêmes règles avec `siblings` = autres widgets ; `dashboards.updateWidget`.
- `delete_widget` : `dashboards.deleteWidget`.
- `reorder_widgets` : `validateOrder(dashboard.widgets.map(w => w.id), order)` →
  `dashboards.setWidgetOrder`.

Un dashboard partagé dont un widget privé serait refusé par le service lève une exception
`Impossible de partager…` — ne peut pas arriver après la règle 3 ; si c'est le cas, elle
remonte comme erreur inattendue (bug).

### 7.3 `saved-queries.service.ts`
```ts
export interface UpdateSavedQueryDto { title?: string; mode?: QueryMode; builderConfig?: BuilderConfig; sqlText?: string }
```
Dans `update`, après fusion : `mode === 'sql'` ⇒ `delete updated.builderConfig` ;
`mode === 'builder'` ⇒ `delete updated.sqlText` (évite qu'un YAML garde les deux
définitions, ce que `SavedQuery` interdit). Sans effet pour l'UI actuelle (même mode).

## 8. Rafraîchissement renderer (`useLiveFileSync.ts`)

Avant le bloc `.polenta/schema.yaml` :
```ts
if (/^queries\//.test(relPath)) {
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'queries' && q.queryKey[1] === repoPath })
  return
}
if (/^dashboards\//.test(relPath)) {
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'dashboards' && q.queryKey[1] === repoPath })
  return
}
if (/^\.[^/]+\.pref$/.test(relPath)) {
  qc.invalidateQueries({ predicate: (q) =>
    ['queries', 'dashboards', 'queries-order', 'dashboards-order'].includes(q.queryKey[0] as string)
    && q.queryKey[1] === repoPath })
  return
}
```
Clés vérifiées dans `DashboardPanel.tsx`, `routes/dashboard.tsx`, `routes/query.tsx`
(`['queries'|'dashboards'|…, repoPath, username]`). Le watcher (`RepoWatcherService`)
n'ignore ni `queries/`, ni `dashboards/`, ni les `.pref` → aucun changement côté main.
Effet de bord accepté : une écriture de l'app elle-même déclenche aussi une invalidation
(refetch redondant, sans conséquence — l'UI invalide déjà ces clés après ses mutations).

*Point de vigilance* : `.{user}.pref` porte aussi `fieldVisibility` et l'historique ; une
invalidation des 4 clés à chaque exécution de requête dans l'app (l'historique est écrit
dans `.pref`) → refetch des listes. Coût négligeable (lecture de quelques YAML).

## 9. Décisions et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Un objet par appel, `dryRun` défaut `true` | Lots façon `create_links` | Objets peu nombreux, chaque écriture exécute une requête ; le lot compliquait la sortie sans gain. |
| Sentinelle `NO_USER` | `username` optionnel dans les services | Diff minimal, chemin UI intact, écriture `.pref` physiquement impossible. |
| `inspectBuilderTarget` strict, séparé | Rendre `resolveTableInfo` strict | L'UI dépend du repli historique (type supprimé du schéma → requête toujours exécutable). |
| Invalidation des index à chaque tool | Watcher chokidar dans le process MCP | Process à appels ponctuels (`SPEC-MCP-SERVER.md` §3) ; reconstruction acceptable pour la taille des projets visés. |
| Doublon de titre insensible à la casse, même scope | Pas de contrôle (comme l'UI) | Un agent qui rejoue un appel ne doit pas dupliquer ; l'UI reste permissive. |
| Contrôle `QUERY_IN_USE` dans le tool | Parser le message d'erreur du service | Code d'erreur stable, liste structurée. |

## 10. Limitations connues (à reporter dans `SPEC-MCP-SERVER.md` §7)

- Même limite que l'app : dépendants dans les dashboards privés d'un **autre** utilisateur
  invisibles (`delete_query` peut orpheliner un widget privé d'un tiers).
- Course inter-process sur `config/counters.yaml` et sur un même fichier de dashboard
  (écriture app + MCP simultanées) : même niveau de risque que les autres écritures YAML
  read-modify-write.
- `run_query` reconstruit les index à chaque appel : coûteux sur un très gros workspace.

## 11. Découpage en sprints

### Sprint 1 — socle + requêtes + rafraîchissement live
- `--user` (index.ts), container étendu, `suivi-common.ts`, `readonly-branch.util.ts`
  (+ usage dans `DashboardSeedService`).
- `query-engine.service.ts` (`isReadOnlySql`, `inspectBuilderTarget`, `SUPPORTED_OPERATORS`).
- `suivi-validation.util.ts` (fonctions requêtes : shape, titres ; types d'erreur complets).
- `saved-queries.service.ts` (`mode` dans le DTO).
- `queries.tools.ts` : `list_queries`, `run_query`, `create_query`, `update_query`
  (warnings widgets inclus), `delete_query`.
- `useLiveFileSync.ts`.
- Scénarios tests : Q1–Q14, U1–U3, L1–L2 de `GH18-tests.md`.

### Sprint 2 — dashboards, widgets, documentation
- `suivi-validation.util.ts` : `validateWidget`, `mappingColumns`, `validateOrder`.
- `dashboards.tools.ts` : les 8 tools.
- `agents-md.template.ts` (v3), `SPEC-MCP-SERVER.md` (§2.2, §3, §4.5, §7, §8),
  `SPEC-DASHBOARDS.md` (§6 rafraîchissement live), `SPEC-INDEX.md`.
- Scénarios tests : D1–D16, L3, A1.
