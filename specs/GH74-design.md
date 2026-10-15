# GH74 — Design technique

> Entrées : `specs/GH74.md` (spec validée), `specs/GH78-report.md`, prototype branche `GH78`
> (`apps/desktop/spikes/GH78/` : `contract.ts`, `sandbox.ts`, `build-graph.ts`, `lib/`, `widgets/`).
> Code de référence : `main` @ a856ebe.

## 0. Vue d'ensemble

```
                       main process (desktop) / web-server / mcp-server — même code de service
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ index exigences/tests/liens, campagnes, schéma ──► GraphService ──(graphe JSON, cache)──┐ │
 │ dashboards/lib/** (repo + composants) ─────────► DashboardLibraryService ─(modules)─────┤ │
 │                                                                                        ▼ │
 │ SavedQueriesService / DashboardsService ─(script, transform)──► ScriptEngineService ─────┤ │
 │   (format v1 dossiers + .pref, migrations à la lecture)          │  worker_threads       │ │
 │                                                                  ▼                       │ │
 │                                               script-worker : QuickJS (wasm plafonné),   │ │
 │                                               contexte préparé par (workspace, versions) │ │
 └───────────────────────────────────────────────── lignes ─────────────────────────────────┘
                     │ IPC (desktop) / RPC (client web, même canaux)
                     ▼
  renderer : VegaView (vega-embed + interpréteur, chunk paresseux) ; KPI / table natifs ;
             éditeurs CodeMirror JS / JSON ; formulaires des modèles ; DrillDownModal
```

Principes :
- **Un seul moteur** (main, serveur web, MCP) ; le renderer ne reçoit que des lignes et ne charge
  que Vega.
- **Logique pure partagée** (contrat, modèles, migrations de format, validation des lignes) dans
  `@polenta/types`, testable sans Electron.
- Le moteur SQL et l'interprétation GH71 / maturité sont **supprimés**, pas laissés en parallèle.

---

## 1. Types partagés (`packages/types/src/`)

### 1.1 `graph.ts` — contrat de données v1 (nouveau)

Repris de `spikes/GH78/contract.ts`, avec les compléments de la spec §1.1 :

```ts
export const GRAPH_CONTRACT_VERSION = 1
export interface PolentaGraph {
  contractVersion: 1; generatedAt: string
  repos: GraphRepo[]                 // { name, label, isRoot }
  components: GraphComponent[]       // { name, label, repo }
  schema: GraphSchema                // objectTypes[], linkTypes[], entryStatuses[], campaignStatuses[]
  requirements: GraphRequirement[]; tests: GraphTest[]; links: GraphLink[]
  campaigns: GraphCampaign[]; runs: GraphTestRun[]
}
export interface GraphFixedStatus { name: string; label: string; order: number; severity?: number }
export interface GraphEntry {
  entryId: string; testCaseId: string; requirementId: string | null; status: EntryStatus
  addedAt: string | null; runId: string | null; executedAt: string | null; executedBy: string | null
  carriedFrom: CampaignEntryRef | null
  snapshot: { title: string; status: string; version: number | null } | null
  resyncable: boolean
}
export interface GraphRemovedEntry extends GraphEntry { removedAt: string }
export interface PolentaHost {
  contractVersion: number; locale: 'fr' | 'en'; timezone: string; today: string
  drill: Record<string, string | number | boolean | null> | null
}
export type Row = Record<string, string | number | boolean | null> & { _ids?: string[] }
```

`GraphTest` sans `steps` / `preconditions` / `postconditions` (spec §1.1). Les commentaires JSDoc
de ce fichier **sont** la documentation du contrat : conventions `_ids`, agrégation en JS, couple
(`repo`, `objectTypeRef`), dates UTC, `polenta.drill`, jetons `var(--…)`.

`polenta.d.ts` est **généré** depuis `graph.ts` (script `scripts/generate-graph-dts.ts`, exécuté au
build et vérifié en CI : le fichier de `resources/dashboard-lib/polenta.d.ts` doit être à jour) — pas
écrit à la main, pour ne jamais diverger du type.

### 1.2 `script.ts` — exécution (nouveau)

```ts
export type ScriptErrorKind = 'syntax' | 'import' | 'runtime' | 'timeout' | 'memory' | 'stack'
  | 'rows' | 'contract' | 'async' | 'legacy-sql' | 'format' | 'spec'
export interface ScriptError {
  kind: ScriptErrorKind; message: string
  /** 'script.js' | '<widgetId>.js' | 'lib/x.js' | '<comp>::lib/x.js' | null */
  file: string | null; line: number | null; column: number | null
}
export interface ScriptColumn { name: string; type: 'string' | 'number' | 'date' | 'boolean' }
export type ScriptRunResult =
  | { ok: true; columns: ScriptColumn[]; rows: Row[]; total: number; truncated: boolean; ms: number }
  | { ok: false; error: ScriptError }
export interface ScriptRunRequest {
  /** Requête enregistrée, OU script fourni (vue Requêtes non enregistrée, test_script). */
  queryId?: string; script?: string
  /** Transformation de widget (enregistrée via widget, ou fournie). */
  dashboardId?: string; widgetId?: string; transform?: string
  drill?: PolentaHost['drill']
  limit?: number
}
export function validateRows(rows: unknown): string | null            // de sandbox.ts, `_ids` facultatif
export function inferColumns(rows: Row[]): ScriptColumn[]            // ordre de 1re apparition
export function parseContractHeader(script: string): number           // `// @polenta contract N`, défaut 1
```

### 1.3 `dashboard.ts` (réécrit)

Retirés : `CAMPAIGN_ENTRY_FIELDS`, `CAMPAIGN_FIELD_PREFIX`, `QueryMode`, `BuilderCondition`,
`BuilderConfig` (déplacé en paramètres du modèle « Liste filtrée »), `QueryDefinition`,
`DrillDownSelection`, `DrillDownResult`, `WidgetType`, `WidgetFieldMapping`, `RowTarget.progress`.

```ts
export const SUIVI_FORMAT_VERSION = 1
export interface TemplateRef { id: string; version: number; params: Record<string, unknown>; hash: string }
/** État calculé à la lecture (jamais stocké). */
export interface SuiviObjectState {
  readOnly?: 'newer-format' | 'legacy-sql'
  /** code ≠ template.hash */
  customized: boolean
  /** version du modèle embarquée plus récente que template.version */
  templateUpdate?: number
}
export interface SavedQuery {
  id: string; title: string; scope: QueryScope; formatVersion: number
  script: string; template?: TemplateRef
  createdBy: string; createdAt: string
  /** Format historique non convertible (SQL) : texte conservé, lecture seule. */
  legacySql?: string
  state: SuiviObjectState
}
export interface Widget {
  id: string; title: string; queryId: string; size: WidgetSize
  transform?: string; spec: string          // texte JSON (préservé tel quel)
  template?: TemplateRef; state: SuiviObjectState
}
export interface Dashboard { id; title; scope; formatVersion; widgetOrder; widgets; createdBy; createdAt; state }
export interface QueryHistoryEntry { id: string; script: string; executedAt: string }
export type RowTarget =
  | { kind: 'requirement' | 'test' | 'campaign'; id: string; repoPath: string }
  | { kind: 'campaign-entry'; campaignId: string; entryId: string; executed: boolean; status: TestRunStatus; repoPath: string }
export interface DescribedObject { id: string; kind: 'requirement' | 'test' | 'campaign' | 'campaign-entry' | 'run' | 'unknown'; title: string | null; status: string | null; typeLabel: string | null }
```

### 1.4 `suivi-templates.ts` (nouveau, pur)

```ts
export interface TemplateParamDef { name: string; label: { fr: string; en: string }
  kind: 'objectType' | 'column' | 'columns' | 'conditions' | 'enum' | 'campaigns' | 'boolean' | 'text'; required?: boolean; values?: string[] }
export interface QueryTemplate { id: 'filtered-list' | 'campaign-entries' | 'campaign-timeline'; version: number
  label; params: TemplateParamDef[]; generate(params): string /* script */ }
export interface WidgetTemplate { id: 'bar' | 'pie' | 'line' | 'kpi' | 'table' | 'matrix' | 'stacked-area'; version: number
  label; params: TemplateParamDef[]; generate(params): { transform?: string; spec: string } }
export const QUERY_TEMPLATES: QueryTemplate[]; export const WIDGET_TEMPLATES: WidgetTemplate[]
```

- Générateurs **déterministes** (même paramètres → même texte, clés JSON triées) : condition de
  l'empreinte.
- **Empreinte** = SHA-256 hex du code normalisé (fins de ligne LF, sans espaces de fin) ;
  script / `transform + '\n\0\n' + spec`. Calculée **dans le main** (`node:crypto`) à l'écriture et à
  la lecture (`state.customized`) — le renderer n'a pas à hacher.
- Transformations générées : regroupement par colonnes, mesures `count` / `sum` / `min` / `max` /
  `distinct` / `worst`, union des `_ids`, tri. Une transformation reçoit `(rows, polenta)`, pas le
  graphe : la gravité des statuts (`worst`) vient de `import { ENTRY_SEVERITY } from
  'lib/status.js'` (§5.1). Code lisible (c'est ce que verra l'utilisateur après détachement).
- `kpi` et `table` : spec Vega-Lite minimale valide portant `"usermeta": { "polenta": { "view":
  "kpi" | "table", … } }` ; l'hôte les rend en HTML natif (lisibilité, sélection de texte, clic par
  ligne). Une spec sans ce `usermeta` est rendue par Vega.
- `stacked-area` : aire empilée + couche `bar` d'opacité 0,01 portant les mêmes lignes (clic) ;
  transformation compatible `polenta.drill` (calcule les `_ids` seulement pour la ligne demandée).
- `campaign-timeline` : script `import { campaignsTimeline } from 'lib/campaign.js'`, pas `day` /
  `week`, sans `_ids` par défaut (IDs à la demande via `polenta.drill`).
- Couleurs : jetons `var(--status-*-solid)`, `var(--chart-series-N)`.

### 1.5 `suivi-format.ts` (nouveau, pur) — migrations à la lecture

```ts
export function migrateQuery(raw: unknown): { query: Omit<SavedQuery, 'state'>; legacy: boolean } | { newerFormat: true; raw: unknown }
export function migrateDashboard(raw: unknown): …
```
- `formatVersion` absent = historique : builder → `filtered-list` (paramètres = `BuilderConfig`),
  SQL → `legacySql` + script vide ; widget `type` + `fieldMapping` → modèle de widget
  correspondant, `preset` ignoré.
- `formatVersion > SUIVI_FORMAT_VERSION` → objet en lecture seule (`state.readOnly =
  'newer-format'`), données brutes conservées pour l'affichage du titre.
- Chaîne de migrations `1 → 2 → …` vide en v1 (structure prête).

### 1.6 Supprimés

`campaign-progress.ts` (et son export de `index.ts`). `TestRunStatus` / gravité : la constante
`RUN_STATUS_SEVERITY` passe de `renderer/lib/runStatus.ts` à `@polenta/types` (`campaign.ts`) pour
être partagée avec `GraphService` (`entryStatuses[].severity`).

---

## 2. Main — services

Règle SPEC-ELECTRON §2–3 : services à plat dans `src/main/services/`.

### 2.1 `graph.service.ts` (nouveau) — `GraphService`

- Reprend de `query-engine.service.ts` : `resolveRepos`, `fetchRepoRaw`, `listCampaigns` (robuste à
  un fichier illisible), `computeCoverage` sur l'agrégat, `rowComponentFor` (devient la résolution
  du `component` d'un objet). Ajoute `test-runs` complets (`TestsIndexService.getRunsMap`),
  `effectiveHistory` (GH77, repli = date du dernier commit), `isResyncable` (GH68, extrait de
  `campaigns.service.ts` vers un util partagé s'il ne l'est pas), `components[]` depuis
  `WorkspaceTreeService` + nœuds locaux du schéma.
- `build(repoPath, workspaceDir?): Promise<{ graph: PolentaGraph; json: string; version: number }>`
  — `json` sérialisé une fois (passé tel quel au worker), `version` entier croissant.
- **Cache** par clé (repo, workspace) + constructions en cours partagées (comme `inFlightDatasets`).
  Invalidation : `invalidate(repoPath)` appelé par un abonné `RepoWatcherService.subscribe` (desktop
  et serveur web) sur `requirements/`, `tests/`, `test-runs/`, `links/`, `campaigns/`, `.polenta/`,
  ref (`'*'`) dans **n'importe quel** repo du workspace → toutes les entrées dont le workspace contient
  ce repo. Écritures de l'app : elles passent par les fichiers → même chemin.
- **Serveur MCP** : pas de watcher → `cache: false` à la construction du service (graphe reconstruit
  par appel ; ≤ 0,4 s sur ×50, acceptable pour un outil IA).
- `describeIds(repoPath, ids, workspaceDir)` → `DescribedObject[]` et `resolveTarget(...)` →
  `RowTarget | null` (remplacent `QueryEngineService.resolveRowTarget`) ; entrée de campagne
  identifiée `CAMP-xxxx/<entryId>` (convention exposée dans le contrat).

### 2.2 `script-engine.service.ts` + `script-worker.ts` + `script-sandbox.ts` (nouveaux)

- `script-sandbox.ts` : code QuickJS de `spikes/GH78/sandbox.ts` industrialisé — `loadQuickJSCapped`
  (wasm plafonné 128 Mo), `prepare` (graphe injecté, gel profond, **durcissement** systématique),
  `PreparedContext.run(script, host)` et `runTransform(transform, rows, host)` (les lignes du script
  sont injectées puis gelées le temps de l'appel), chargeur de modules (clés `lib/x.js`,
  `<comp>::lib/x.js`, relatif `./` confiné au même `lib/`), conversion d'erreurs en `ScriptError`
  (fichier rapporté : `script.js`, `<widgetId>.js`, `lib/…`), détection d'une promesse retournée
  (`kind: 'async'`). Limites : runtime 64 Mo, temps 2 s (script + transformation), pile 256 Ko.
  Pur Node + wasm : **testé directement en vitest**, sans worker.
- `script-worker.ts` : point d'entrée `worker_threads`. Messages `prepare { key, graphJson, library }`,
  `run { key, script, transform?, host, limit }`, `dispose { key }`. Garde au plus **2 contextes**
  préparés (LRU : un workspace ouvert + le précédent). Après `memory` / `stack` / abandon : jette le
  module et en recrée un.
- `script-engine.service.ts` (`ScriptEngineService`) : côté hôte. Un worker par process, démarré à la
  première exécution (`new Worker(path.join(__dirname, 'script-worker.js'))`). File d'attente FIFO.
  Clé de contexte = `${workspaceKey}:${graph.version}:${library.hash}` ; si différente de la dernière
  préparée → `prepare` avant `run`. **Chien de garde** : pas de réponse en `timeMs + 3 s` → `terminate()`
  + nouveau worker, erreur `timeout` (couvre l'abort natif du module observé par #78 §3.4).
  `run(repoPath, workspaceDir, req: ScriptRunRequest, user): Promise<ScriptRunResult>` résout
  `queryId` / widget via les services de stockage, construit `PolentaHost` (`locale`, `timezone` =
  `Intl.DateTimeFormat().resolvedOptions().timeZone` du **client** passé par le renderer — le serveur
  web n'a pas le fuseau de l'utilisateur —, `today` dans ce fuseau), applique `limit` (défaut :
  aucune ; MCP 200).
- **Partage du script entre widgets** : `run` mémorise pour la durée d'un rafraîchissement le
  résultat d'un même (clé de contexte, script) — map des promesses en cours, comme
  `inFlightDatasets` — ; deux widgets sur la même requête ne l'exécutent qu'une fois.

Alternatives écartées : `utilityProcess` Electron (n'existe pas dans le serveur web ni le MCP — on veut
un seul code) ; exécution dans le renderer (#78 §2 : graphe à transférer, wasm sous CSP) ; runtime
neuf par exécution (≥ 420 ms par widget sur ×50).

### 2.3 `dashboard-library.service.ts` (nouveau)

- `load(repoPath, workspaceDir)` → `{ modules: Record<string, string>; hash: string }` : lit
  `dashboards/lib/**/*.js` du repo ouvert (clés `lib/<chemin>`) et de chaque composant du workspace
  (clés `<nomComposant>::lib/<chemin>`, nom = nom de montage du composant, comme la résolution
  `<nœud>::nom` des paramètres T171). `polenta.d.ts` non chargé. Cache invalidé par `dashboards/lib/`.
- Contenu de départ : `apps/desktop/resources/dashboard-lib/` (`campaign.js`, `history.js`,
  `maturity.js`, `status.js`, `polenta.d.ts`, `jsconfig.json`) + `manifest.json`
  `{ files: [{ path, id, versions: [{ version, hash, summary: { fr, en } }] }] }` (toutes les versions
  livrées ; vérifié en CI : la dernière empreinte correspond au fichier livré).
- `seedIfAbsent(repoPath)` (appelé par le seed, §2.6), `listUpdates(repoPath, username)` /
  `applyUpdates(repoPath, files)` / `ignoreUpdate(repoPath, username, path, version)` — empreinte du
  fichier du repo ∈ versions antérieures livrées → proposé. Ignorés : clé `suiviIgnoredUpdates` du
  `.pref`. Les modèles des seeds (§2.6) passent par la même liste (`kind: 'library' | 'seed-widget'`).
- Localisation des ressources : desktop `process.resourcesPath` (packagé) / `resources/` (dev),
  serveur web et MCP : à côté du bundle (copie par les scripts de build, §6).

### 2.4 Stockage — `saved-queries.service.ts`, `dashboards.service.ts` (réécrits en partie)

- **Lecture** : entrées de `queries/` = dossiers `QUERY-NNNN/` (`query.yaml` + `script.js`) **et**
  fichiers historiques `QUERY-NNNN.yaml` ; passés à `migrateQuery`. Même chose pour `dashboards/`
  (`DASHBOARD-NNNN/dashboard.yaml`, `<widgetId>.js`, `<widgetId>.vl.json`), en ignorant `lib/` et
  `jsconfig.json`. `GitService.readYamlDir` n'est plus utilisé ici (il descend récursivement) :
  nouvelle méthode `listEntries(repoPath, dir)` (fichiers + dossiers de premier niveau).
- **Écriture** (create / update / setScope / remap) : toujours au format v1 ; un objet historique
  réécrit → dossier créé **puis** fichier historique supprimé (une seule modification à publier).
  Objet `readOnly` → refus `SUIVI_READ_ONLY` (service, défense en profondeur).
- `id-counter.util.ts` : `maxNumber` reconnaît aussi un **dossier** `<PREFIX>-NNNN/` (segment de
  chemin) en plus du fichier `<PREFIX>-NNNN.yaml`. Suppression : `deleteWithTombstone` étendu à un
  dossier (supprime tous ses fichiers).
- `.pref` : `savedQueries[]` / `dashboards[]` au format v1 (`script`, `transform`, `spec` en texte),
  migrées à la lecture comme le reste, réécrites à l'enregistrement.
- `state` calculé à la lecture (`customized` = empreinte, `templateUpdate` = version embarquée) et
  jamais écrit.
- Règles de dépendance / scope (§3.1 SPEC-DASHBOARDS) inchangées.
- Historique de requêtes : entrées `{ script }` ; les anciennes entrées (`mode`) sont ignorées à la
  lecture (pas de migration, données privées non critiques).

### 2.5 Retraits

- `query-engine.service.ts` et ses tests (`query-engine.*.test.ts`), `alasql` (dépendance et
  exclusion `externalizeDepsPlugin`), `schema-lookup.util.ts` réduit à ce que le formulaire
  « Liste filtrée » utilise (allowlist des champs d'un type — exposée par un canal `suivi:fields`).
- `maturity.util.ts` → renommé `field-checks.util.ts`, réduit à `isEarsCompliant` / `isFilled`
  (imports de `bulk-import-validation.util.ts`, `merge-resolution.service.ts` mis à jour).
- `campaign-progress.ts`, `campaign-progress.test.ts`, `suivi-validation.preset.test.ts`,
  `dashboard-seed.progress.test.ts`, mise à niveau GH71 (`upgradeCampaignsSeed`, `PROGRESS_*`).
- `export/query-result.xlsx.ts` : conservé, alimenté par `ScriptRunResult` (`_ids` joint par « , »).

### 2.6 `dashboard-seed.service.ts` (réécrit)

- Mêmes déclencheurs, marqueurs et gardes (Status partagé + garde de branche ; Campagnes privé par
  utilisateur, reprise `partial`). Définitions = modèles (`QUERY_TEMPLATES` / `WIDGET_TEMPLATES`) +
  paramètres figés ; libellés fr / en inchangés.
- Seed Status : en plus, `DashboardLibraryService.seedIfAbsent` (bibliothèque + `polenta.d.ts` +
  `jsconfig.json`) — marqueur `.seeded.yaml` étendu (`library: [chemins livrés]`) : un fichier
  supprimé par le projet n'est pas recréé.
- Campagnes : widget **Avancement dans le temps** (requête `campaign-timeline` + widget
  `stacked-area`) ajouté aux nouveaux seeds.
- **Réécriture des seeds existants** (une fois, `upgrades: ['gh74']` dans les marqueurs) : requêtes
  et widgets reconnus par contenu (SQL exact des versions GH65 / GH71 connues, mapping d'origine) →
  remplacés par les définitions v1 (même id, même titre si inchangé). Non reconnus → laissés (ils
  tombent en `legacy-sql`).
- Seeds Campagnes existants : « Avancement dans le temps » **proposé** dans le bandeau (entrée
  `kind: 'seed-widget'`), ajouté sur « Appliquer ».

### 2.7 IPC (`main/ipc/index.ts`) et politique web (`web-server/channel-policy.ts`)

Retirés : `queries:execute`, `queries:drill-down`, `queries:builder-to-sql`,
`queries:resolve-row-target`. Ajoutés (même politique de rôle que les canaux remplacés ; écriture :
`suivi:updates-apply`) :

| Canal | Signature |
|---|---|
| `suivi:run` | `(repoPath, workspaceDir, req: ScriptRunRequest, client: { locale, timezone }) → ScriptRunResult` |
| `suivi:describe-ids` | `(repoPath, workspaceDir, ids) → DescribedObject[]` |
| `suivi:resolve-target` | `(repoPath, workspaceDir, id) → RowTarget \| null` |
| `suivi:fields` | `(repoPath, workspaceDir) → champs par type (formulaire « Liste filtrée »)` |
| `suivi:templates` | `() → définitions des modèles (sans les fonctions)` |
| `suivi:render-template` | `(kind, id, params) → { script } \| { transform?, spec }` (aperçu formulaire) |
| `suivi:updates-list` / `-apply` / `-ignore` | bandeau (§2.3) |

`queries:create/update` et `dashboards:add-widget/update-widget` acceptent `{ script | template }`
et `{ transform?, spec | template }`.

---

## 3. Renderer

| Fichier | Changement |
|---|---|
| `components/dashboard/VegaView.tsx` (nouveau) | `import()` paresseux de `vega-embed`, `vega-lite`, `vega`, `vega-interpreter` ; `embed(el, spec, { ast: true, expr: expressionInterpreter, renderer: printMode ? 'svg' : 'canvas', actions: false, config })` ; `data: { name: 'rows' }` alimenté par `view.data('rows', rows)` ; `view.addEventListener('click', (e, item) => onMark(item?.datum))` ; recompilation au changement de thème ; erreurs de compilation → `WidgetError` |
| `components/dashboard/vegaTheme.ts` (nouveau) | remplace `var(--x)` par `rgb(<jeton du thème courant>)` dans la spec (parcours JSON) ; construit la `config` Vega (axes / légendes `ink` / `edge` / `activity-fg`, fond `surface`, `range.category` = `chart-series-1…8`) ; avertit si `aggregate` (spec §3) |
| `widgets/KpiView.tsx`, `widgets/TableView.tsx` | vues natives pour `usermeta.polenta.view` (reprennent `KpiWidget` / `TableWidget` / `ResultTable`) |
| `widgets/WidgetRenderer.tsx` | aiguillage `usermeta.polenta.view` → natif, sinon `VegaView` ; états vide / erreur (`WidgetError` : message, fichier, ligne) |
| `BarWidget`, `PieWidget`, `LineWidget`, `MatrixWidget`, `matrix.ts`, `progressPresentation.ts`, `chartColors.ts`, `numeric.ts`, `drilldown.ts` | **supprimés** (rendus par les modèles) ; `recharts` retiré des dépendances |
| `hooks/useQueryResult.ts` → `useScriptRun.ts` | `widgetRunOptions(repoPath, workspaceDir, { dashboardId, widgetId })` → `api.suivi.run` ; clé `['widget-run', repoPath, dashboardId, widgetId, codeHash]` ; mêmes invalidations que `widget-query-result` (`useLiveFileSync` : clés renommées, + `dashboards/lib/`) |
| `DrillDownModal.tsx` | entrée : liste d'IDs (`_ids` du `datum`, ou résultat d'une relance `drill`) → `suivi:describe-ids` → tableau ID / type / titre / statut, clic → `suivi:resolve-target` → onglet |
| `DashboardGrid.tsx` | `onMark(datum)` : `_ids` présents → popup ; sinon relance `suivi:run` avec `drill` = colonnes scalaires du `datum` → union des `_ids` ; aucun → message « Détail non disponible » |
| `WidgetConfigModal.tsx` | réécrit : choix de la requête, onglets **Modèle** (formulaire généré depuis `params`, colonnes proposées = colonnes du dernier résultat de la requête) / **Code** (CodeMirror JS pour la transformation, JSON pour la spec) ; bascule détache ; « Revenir au modèle » ; aperçu live |
| `routes/query.tsx` | éditeur CodeMirror JS (`@codemirror/lang-javascript`) ou formulaire de modèle, Exécuter, `ResultTable` (colonne `_ids` repliée), erreurs, sauvegarde, historique (script), export xlsx ; requête `legacySql` : texte SQL en lecture seule + bandeau « non prise en charge » |
| `QueryBuilder.tsx`, `SqlEditor.tsx` | supprimés ; la saisie des conditions du builder est réutilisée dans le formulaire « Liste filtrée » (`TemplateForm` → `ConditionsField`, extrait de `QueryBuilder`) |
| `components/dashboard/TemplateForm.tsx` (nouveau) | rendu générique d'un `TemplateParamDef[]` |
| `components/dashboard/CodeEditor.tsx` (nouveau) | CodeMirror JS / JSON (base : `SqlEditor`) |
| `sidebar/DashboardPanel.tsx` | **bandeau** des mises à jour (`suivi:updates-list`, liste à cocher, Appliquer / Ignorer, sans bouton sur branche en lecture seule) ; badge « lecture seule » sur les objets `readOnly` |
| `routes/print.dashboard.tsx`, `print.query-result.tsx` | `VegaView` en `svg`, `notifyPrintReady` après rendu Vega (`view.runAsync()`) |
| `routes/dashboard.tsx` (export docx) | `widgetResults` = lignes de `suivi:run` |
| `routes/campaign.$campaignId.tsx`, `lib/campaignProgress.ts` | pastilles et filtre par **statut brut** (paramètre `status`, comportement GH65 restauré depuis l'historique git) ; `progress` ignoré ; `campaignProgress.ts` supprimé ; « Non approuvé » (GH68) conservé |
| `lib/runStatus.ts` | `RUN_STATUS_SEVERITY` importé de `@polenta/types` |
| i18n `fr` / `en` | libellés modèles, erreurs (`kind`), bandeau, lecture seule |

Dépendances renderer ajoutées : `vega@6.4.0`, `vega-lite@6.4.3`, `vega-embed@7.3.0`,
`vega-interpreter@2.3.2`, `@codemirror/lang-javascript`, `@codemirror/lang-json` (versions exactes,
celles mesurées par #78 pour Vega).

---

## 4. Serveur MCP

| Fichier | Changement |
|---|---|
| `tools/queries.tools.ts` | `create_query` / `update_query` : `script` **ou** `template` + `params` ; `run_query` → `ScriptEngineService.run` (200 lignes max + total) ; validation : exécution à l'enregistrement → avertissement `SCRIPT_ERROR` (non bloquant) |
| `tools/dashboards.tools.ts` | `add_widget` / `update_widget` : `transform?` + `spec` **ou** `template` + `params` ; validation spec (§4.1) ; `MAPPING_RULES`, `pruneMapping`, `preset` retirés |
| `tools/suivi-script.tools.ts` (nouveau) | `get_data_contract` (texte de `polenta.d.ts` + section SPEC-DASHBOARDS « Graphe de données »), `test_script` (`script` ou `queryId` + `transform?`), `list_templates`, `list_library`, `read_library_module`, `write_library_module` (repo ouvert, `dashboards/lib/` seulement, chemin validé par `path-guard`) |
| `tools/suivi-common.ts`, `main/services/suivi-validation.util.ts` | codes d'erreur / avertissement mis à jour (`SCRIPT_ERROR`, `SPEC_INVALID`, `SPEC_AGGREGATE`, `SUIVI_READ_ONLY`) ; règles de mapping supprimées |
| `container.ts` | `GraphService({ cache: false })`, `ScriptEngineService`, `DashboardLibraryService` |
| AGENTS.md (génération) | section Suivi réécrite : contrat, `test_script`, conventions |

### 4.1 Validation de spec côté MCP (Vega ESM-only)

Le bundle MCP reste **CJS**. Un second bundle esbuild **ESM** `out/mcp-server/vega-compile.mjs`
(entrée `src/mcp-server/vega-compile.ts` : `import { compile } from 'vega-lite'`) est chargé par
`await import(pathToFileURL(…).href)` depuis le CJS (import dynamique d'un ESM : supporté par Node).
Validation = JSON valide + `compile()` sans exception + `data.name === 'rows'` + pas de
`url` / `datasets` + avertissement `aggregate`. Alternative écartée : passer tout le serveur MCP en
ESM (risque sur `keytar`, `electron-shim`, `require` existants, sans bénéfice pour #74). Le main
desktop et le serveur web **ne compilent pas** de spec (le renderer le fait).

---

## 5. Bibliothèque de départ (`resources/dashboard-lib/`)

### 5.1 Modules

| Module | Exports | Base |
|---|---|---|
| `status.js` | `ENTRY_ORDER`, `ENTRY_SEVERITY`, `worst(statuses)`, `statusLabel(data, repo, ref, name)` | `RUN_STATUS_SEVERITY` ; utilisé par les transformations générées |
| `history.js` | `valueAt(obj, field, date)`, `timeline(objects, field, { from, to, step, timezone })` | `spikes/GH78/lib/history.js` |
| `campaign.js` | `campaignsTimeline(data, { campaignIds, from, to, step, timezone, withIds })`, `campaignTimeline(…)` (une campagne), `entryStep(data, campaign, entry)`, `lastResult(data, testId)` | `spikes/GH78/lib/campaign.js` (version à balayage unique) + règle GH71 (`campaign-progress.ts`, réécrite sur les faits bruts : `entry.status`, `snapshot`, test live, `resyncable`, `isApproval`) + repli GH73 §6.2 |
| `maturity.js` | `maturity(data, requirement)` → `{ ok, requiredFieldsOk, earsOk, acceptanceOk, verificationOk, noRevalidation, missing[] }` | port JS de `maturity.util.ts::computeMaturity` (mêmes règles, SPEC-DASHBOARDS §5.2) |

- En-tête `// @polenta-lib <id> <version>`, JSDoc typé contre `polenta.d.ts`, `checkJs` sans erreur.
- **Performance** : un balayage des événements triés, index `Map` construits une fois par appel ;
  test de non-régression ×50 (§7 tests) avec budget.
- **Équivalence** : `entryStep` et `maturity` testés contre les sorties actuelles de
  `campaign-progress.ts` / `computeMaturity` sur le jeu de démo **avant** suppression de ces
  derniers (tests écrits au sprint 1, sprint 3 supprime l'ancien code et garde les références JSON).

### 5.2 Exécution des modules dans les tests

Les modules sont du JS standard sans dépendance : exécutés en vitest **dans QuickJS** via
`script-sandbox.ts` (mêmes conditions que la production) et, pour les budgets, mesurés aussi.

---

## 6. Build et packaging

| Cible | Changement |
|---|---|
| `electron.vite.config.ts` (main) | 2ᵉ entrée `script-worker` (`src/main/services/script-worker.ts`) → `out/main/script-worker.js` ; `quickjs-emscripten-core` et `@jitl/quickjs-wasmfile-release-sync` bundlés (ajoutés à `exclude`) ; plugin de copie du `.wasm` vers `out/main/` ; `alasql` retiré de `exclude` |
| `scripts/build-mcp-server.ts` | entrées `index.ts` + `script-worker.ts` (CJS) + bundle ESM `vega-compile.mjs` ; copie du `.wasm` et de `resources/dashboard-lib/` dans `out/mcp-server/` |
| `scripts/build-web-server.ts` | entrée `script-worker.ts` ; copie `.wasm` + `dashboard-lib/` |
| `electron-builder.config.ts` | `extraResources` : `resources/dashboard-lib/**` ; le `.wasm` est dans `out/main` (lu par `fs`, fonctionne dans l'asar ; à vérifier au packaging, sinon `asarUnpack`) |
| `Dockerfile.web` | rien de spécifique (copie de `out/`) |
| `scripts/generate-graph-dts.ts` (nouveau) | `graph.ts` → `resources/dashboard-lib/polenta.d.ts` ; `pnpm test` échoue si différent |
| Chargement du wasm | `newVariant(base, { wasmLocation: path.join(__dirname, 'emscripten-module.wasm'), wasmMemory })` : chemin explicite, indépendant du bundler |

---

## 7. Fichiers SPEC à mettre à jour (dernier sprint)

`SPEC-DASHBOARDS.md` (§1–§7 réécrits + nouvelle section « Graphe de données »), `SPEC-MCP-SERVER.md`
(outils Suivi), `SPEC-TESTS.md` §4.3 (pastilles statut brut), `SPEC-TECH-stack.md` §2 (stack),
`SPEC-ELECTRON-DESKTOP.md` §2–3 (worker du main, ressources), `SPEC-INDEX.md` (colonne MAJ),
`docs/tutoriels/06-suivi.md` (captures `dashboard*.png`, `query*.png` à refaire).

---

## 8. Décisions et alternatives

| Décision | Alternatives rejetées | Raison |
|---|---|---|
| `worker_threads` dans les 3 hôtes | `utilityProcess` | inexistant hors Electron ; un seul code |
| Contexte préparé, 2 contextes max par worker | runtime neuf / contexte par widget | coût de préparation (85–437 ms à ×10–×50) ; mémoire |
| Empreinte calculée dans le main, `state` à la lecture | hash dans le renderer / stocker `customized` | `crypto.subtle` asynchrone et doublon ; un état stocké diverge dès qu'on édite le fichier à la main |
| KPI / table : `usermeta.polenta.view`, rendu natif | tout en Vega | une table Vega n'est ni lisible ni sélectionnable ; reste une spec Vega-Lite valide |
| Transformation dans le bac à sable (même runtime) | regroupement déclaratif par l'hôte | décision utilisateur (spec) ; un seul mécanisme d'exécution |
| `RUN_STATUS_SEVERITY` dans `@polenta/types` | dupliquer dans le graphe seulement | même règle pour la page campagne, le graphe et `status.js` |
| `polenta.d.ts` généré depuis `graph.ts` | écrit à la main | ne jamais diverger du contrat |
| MCP : bundle ESM séparé pour `vega-lite` | MCP entièrement ESM ; JSON Schema seul | moindre risque ; compilation réelle |
| Timezone fournie par le client | fuseau du process | le serveur web n'a pas le fuseau de l'utilisateur |
| MCP sans cache de graphe | cache + empreinte des fichiers | pas de watcher ; coût acceptable |
| Suppression directe de SQL (pas de double moteur) | coexistence temporaire | spec (« sans migration ») ; un seul chemin à maintenir |

---

## 9. Découpage en sprints

Chaque sprint laisse l'application fonctionnelle.

### Sprint 1 — Moteur (additif, aucune UI changée)
- `@polenta/types` : `graph.ts`, `script.ts`, `RUN_STATUS_SEVERITY` déplacé.
- `GraphService` (construction, cache, invalidation, `describeIds`, `resolveTarget`).
- `script-sandbox.ts`, `script-worker.ts`, `ScriptEngineService` (worker, chien de garde, limites,
  partage d'exécution).
- `DashboardLibraryService` (chargement repo + composants, résolution des imports) ; bibliothèque de
  départ `resources/dashboard-lib/` (`status`, `history`, `campaign`, `maturity`) + `manifest.json`
  + génération de `polenta.d.ts`.
- Build : entrées worker, copie wasm / ressources (desktop, web-server, MCP).
- MCP additif : `get_data_contract`, `test_script`, `list_library`, `read_library_module`,
  `write_library_module`.
- Tests : isolation, limites, erreurs, contrat, équivalence `entryStep` / `maturity` avec l'existant,
  budget ×50.

### Sprint 2 — Modèles et format v1 (main, pur + stockage)
- `suivi-templates.ts` (7 modèles de widget, 3 de script), `suivi-format.ts` (migrations).
- Stockage v1 dans `SavedQueriesService` / `DashboardsService` (dossiers, `.pref`, lecture seule,
  conversion builder / SQL / widgets historiques, `state`), `id-counter` (dossiers), `listEntries`.
- **Bascule du moteur** : `queries:*` / `dashboards:*` sur le format v1, canaux `suivi:*`,
  `channel-policy` ; MCP `queries.tools` / `dashboards.tools` réécrits (+ `list_templates`, validation
  de spec ESM).
- Renderer **minimal** pour rester fonctionnel : `useScriptRun`, `VegaView` + `vegaTheme`, vues
  natives KPI / table, `WidgetRenderer`, drill-down (§3), suppression des widgets recharts,
  `QueryBuilder` / `SqlEditor` remplacés par `CodeEditor` + `TemplateForm` (formulaire générique).
- Retraits : `query-engine.service.ts`, `alasql`, `recharts`, `maturity` → `field-checks.util.ts`.

### Sprint 3 — Expérience d'édition, seeds, bandeau
- `WidgetConfigModal` complet (Modèle / Code, détachement, « Revenir au modèle », aperçu), vue
  Requêtes complète (historique, export xlsx, `legacySql`).
- Seeds réécrits, réécriture des seeds existants, widget « Avancement dans le temps », seed de la
  bibliothèque.
- Bandeau des mises à jour (`DashboardPanel`), lecture seule « format plus récent ».
- Page campagne : statuts bruts ; retrait de `campaign-progress.ts`, `campaignProgress.ts`,
  `progressPresentation.ts`.
- Impression / export docx / xlsx.

### Sprint 4 — Non-régression, e2e, SPEC
- Corpus CI (`apps/desktop/src/main/services/suivi-corpus.test.ts` + `fixtures/suivi-corpus/`) :
  démo, projet minimal, ×50 généré (générateur repris de `spikes/GH78/inflate.ts`) ; références JSON.
- Budgets de performance.
- e2e web `gh74-*.spec.ts` (remplacent `gh65` / `gh69` côté widgets).
- Mises à jour SPEC (§7), `SPEC-INDEX.md`, tutoriel.

Estimation : 4 sprints ; le sprint 2 est le plus lourd (bascule). Si besoin, il se scinde en 2a (main
+ MCP, renderer en mode « affichage des lignes en table » seulement) et 2b (Vega, drill-down).
