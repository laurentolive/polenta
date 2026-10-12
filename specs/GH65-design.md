# GH65 — Design technique

Spec : [GH65.md](GH65.md). Deux sprints (voir § Découpage).

## Vue d'ensemble

| Volet | Où | Principe |
|---|---|---|
| Table `campaign_entries` | `QueryEngineService` (main) | 4e table du dataset, construite depuis `CampaignsService.list` de chaque repo du périmètre |
| Builder sur les campagnes | `QueryBuilder.tsx` + `resolveTableInfo` | type de catégorie `campaign` → table `campaign_entries`, allowlist dédiée |
| Drill-down | `QueryEngineService.drillDown` + `DrillDownModal` (renderer) | lignes sources calculées côté main (builder : config modifiée ; SQL : réécriture AST AlaSQL ou repli) |
| Ouverture d'une ligne | `QueryEngineService.resolveRowTarget` + `openRowTarget` (renderer) | la ligne ne porte pas de chemin de repo : le main retrouve l'objet et son repo |
| Filtre statut page campagne | `campaign.$campaignId.tsx` | paramètre d'URL `status` |
| Seed « Campagnes » | `DashboardSeedService` | seed indépendant, **privé**, marqueur à reprise dans le `.{user}.pref` |
| Rafraîchissement | `useLiveFileSync` | invalidation de `widget-query-result` / `widget-drilldown` sur tout repo |
| Intervalle de pull | `useAutoPull` + `preferences.tsx` + `ProjectPreferences` | `autoPullIntervalMinutes` lu dans le schéma du repo racine |

## 1. Table `campaign_entries`

### `apps/desktop/src/main/services/query-engine.service.ts`

- Constructeur : nouveau paramètre **optionnel** `campaigns?: CampaignsService` (placé après
  `workspaceTree`). Absent → table vide (aucune régression pour un appelant qui ne le passe pas).
  Câblé dans `main/container.ts` **et** `mcp-server/container.ts` (le `CampaignsService` y existe
  déjà).
- `QueryDataset` gagne `campaign_entries: FlatRow[]` ; `QueryTable` devient
  `'requirements' | 'tests' | 'campaign_entries'`.
- `fetchRepoRaw` lit aussi `this.campaigns?.list(rp) ?? []`.
- Nouveau `flattenCampaignEntry(c: TestCampaign, run: CampaignTestRun, component, testTitle)` :

  ```ts
  {
    ...prefixKeys(c.fields ?? {}, 'campaign_'),      // champs perso de la campagne
    campaignId: c.id, campaignTitle: c.title, campaignStatus: c.status,
    objectTypeRef: c.objectTypeRef ?? null,          // alias : le builder filtre sur [objectTypeRef]
    campaignObjectTypeRef: c.objectTypeRef ?? null,
    baselineRef: c.baselineRef ?? null, level: c.level ?? null,
    campaignComponent: c.component ?? null,
    component,                                       // rowComponentFor(location du type de campagne, repo)
    entryId: run.entryId, testCaseId: run.testCaseId, requirementId: run.requirementId ?? null,
    testTitle,                                       // run.testSnapshot?.title ?? tcMap.get(id)?.title ?? null
    status: run.status, executed: run.status !== 'pending',
    executedAt: run.executedAt ?? null, executedDay: run.executedAt?.slice(0, 10) ?? null,
    executedBy: run.executedBy ?? null, runId: run.runId ?? null,
  }
  ```
  `objectTypeRef` doublonne volontairement `campaignObjectTypeRef` : `buildSql` filtre toujours sur
  `[objectTypeRef]` (+ `[component]`), sans cas particulier pour la nouvelle table.
  `executedDay` : préfixe `AAAA-MM-JJ` de l'ISO stocké (UTC), conforme à la spec.
- `execute` : `alasql.tables.campaign_entries = { data: dataset.campaign_entries }`.
- `resolveTableInfo` : `resolved.category === 'campaign'` → table `campaign_entries`, allowlist =
  `CAMPAIGN_ENTRY_FIELDS` (nouvelle constante, `schema-lookup.util.ts`, liste des colonnes système
  ci-dessus) + `campaign_<nom>` pour chaque champ du type. Les autres catégories : inchangé.

### `apps/desktop/src/renderer/components/dashboard/QueryBuilder.tsx`

- `getQueryableTypes` accepte `category === 'campaign'` ; `QueryableType.category` élargi.
- Liste de champs système selon la catégorie : nouvelle constante `CAMPAIGN_SYSTEM_FIELD_DEFS`
  (mêmes noms que `CAMPAIGN_ENTRY_FIELDS`, libellés i18n `queryPage.builder.campaign.*`) ; champs du
  type exposés sous leur nom préfixé `campaign_<nom>`, libellé = libellé du champ.
- Le libellé du type dans le sélecteur est suffixé « (entrées) » pour indiquer le grain.

### MCP

`mcp-server/tools/suivi-common.ts` / descriptions des tools `run_query`, `create_query` : citer
`campaign_entries` dans la liste des tables. Aucun tool nouveau. `SPEC-MCP-SERVER.md` mis à jour au
dernier sprint.

## 2. Rafraîchissement temps réel

### `apps/desktop/src/renderer/hooks/useLiveFileSync.ts`

Constat : `['widget-query-result', repoPath, …]` est indexé sur le **repo racine** ; il n'est
invalidé que par un `'*'` émis pour ce même repo. Ajout, en tête du handler (avant les `return`
anticipés), d'une invalidation **sans filtre de repo** :

```ts
const DATA_PATH = /^(requirements|tests|links|campaigns)\//
if (relPath === '*' || DATA_PATH.test(relPath)) {
  qc.invalidateQueries({ queryKey: ['widget-query-result'] })
  qc.invalidateQueries({ queryKey: ['widget-drilldown'] })   // sprint 2
}
```

Couvre l'avance rapide du pull auto (`.git/refs` → `'*'`), l'écriture locale d'un résultat
(`campaigns/<id>.yaml`) et tout repo composant. Coût : ré-exécution des requêtes des widgets visibles
uniquement (les requêtes inactives sont seulement marquées périmées par TanStack Query).

> Les index `requirements`/`tests` du main sont déjà invalidés par `RepoWatcherService` ; les
> campagnes sont relues du disque à chaque `list` (pas d'index) — aucune action côté main.

### Intervalle de pull

- `packages/types/src/schema.ts` — `ProjectPreferences.autoPullIntervalMinutes?: number`.
- Nouvelle fonction pure `effectivePullIntervalMinutes(v: unknown): number` (fichier
  `renderer/lib/autoPullInterval.ts`) : entier fini dans [1, 60] → valeur ; sinon 5. Testée en
  unitaire.
- `useAutoPull` : lit le schéma du repo racine (`useQuery(['schema', rootRepoPath], …)`, même clé
  que le reste de l'app → invalidée par `useLiveFileSync` sur `schema.yaml`) ; l'intervalle entre
  dans les dépendances de l'effet → minuteur réarmé au changement.
- Libellé hors ligne `layout.syncIndicator.offline` : interpolation `{{minutes}}` (fr + en) ;
  `useAutoPull` passe la valeur effective.
- `routes/preferences.tsx` : champ numérique « Intervalle de récupération automatique (minutes) »
  (min 1, max 60), sauvegardé avec `autoPropagatePin` dans `schema.preferences`. Valeur affichée =
  valeur effective.

## 3. Seed du dashboard « Campagnes »

### `apps/desktop/src/main/services/dashboard-seed.service.ts`

> **Révisé en sprint 1 (revue + décision utilisateur)** : seed **privé** (`scope: 'private'`,
> `.{user}.pref`), marqueur sous la clé `campaignsSeed` du `.pref` (store injectable
> `CampaignsSeedMarkerStore` pour les tests). Aucune écriture dans le repo, donc pas de garde
> « branche en lecture seule » ; un échec est journalisé sans faire échouer `dashboards:list`.

- `ensureSeeded(repoPath, username, locale?)` : enchaîne le seed historique (inchangé) **puis**
  `ensureCampaignsSeeded`. Même dédup `inFlightSeeds` (clé repo).
- Marqueur **à reprise** (forme) :
  ```yaml
  state: partial | done
  queries: { <cléRequête>: QUERY-00xx }   # requêtes déjà créées
  dashboardId: DASHBOARD-00xx             # présent une fois le dashboard créé
  seededAt / seededBy
  ```
  - `done` → rien.
  - absent ou `partial` → crée ce qui manque (requête par requête, puis dashboard, puis widgets),
    en réécrivant le marqueur `partial` après chaque création ; `done` à la fin. Une reprise après
    échec ne duplique donc rien. Différence assumée avec le seed historique (qui raisonne sur le
    dossier vide) : ici le dossier contient déjà « Status ».
  - Une requête référencée par le marqueur mais supprimée entre-temps est recréée (cas d'un échec
    puis nettoyage manuel) ; un dashboard référencé mais supprimé alors que `state: partial` est
    recréé. Une fois `done`, plus jamais rien.
- Libellés : table statique `CAMPAIGN_SEED_LABELS: Record<'fr' | 'en', …>` dans le service (le main
  n'a pas d'i18next) ; `locale` absent ou inconnu → `fr` (cohérent avec le seed historique). Le
  handler `dashboards:list` reçoit un 3e argument optionnel `locale` (renderer :
  `i18n.resolvedLanguage`) ; `api.dashboards.list` et le bridge web suivent (channel déjà exposé).
- Requêtes (SQL avancé, `scope: private`) — texte final ajusté en dev (AlaSQL) :
  - `avancement` : `SELECT campaignTitle, status, COUNT(*) AS n FROM campaign_entries WHERE campaignStatus IN ('planned','in_progress') GROUP BY campaignTitle, status`
  - `pctExecuted` : `SELECT ROUND(100 * SUM(CASE WHEN executed THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct FROM campaign_entries WHERE campaignStatus = 'in_progress'`
  - `pctPass` : idem, `PASS` / exécutées (dénominateur nul → `NULL`, le KPI affiche son état vide)
  - `perDay` : `SELECT executedDay, COUNT(*) AS n FROM campaign_entries WHERE executed GROUP BY executedDay ORDER BY executedDay`
  - `failures` : `SELECT campaignId, campaignTitle, entryId, testCaseId, testTitle, status, executedAt, executedBy FROM campaign_entries WHERE campaignStatus = 'in_progress' AND status IN ('FAIL','BLOCKED') ORDER BY executedAt DESC`
- Widgets : `bar` lg stacked (category `campaignTitle`, series `status`, measure `n`), `kpi` sm × 2,
  `line` md (category `executedDay`, measure `n`), `table` lg.

## 4. Drill-down (sprint 2)

### Types (`packages/types/src/dashboard.ts`)

```ts
export interface DrillDownSelection {
  /** Valeurs cliquées, par colonne du résultat (catégorie, série). Vide = KPI (toutes les lignes). */
  values: Record<string, unknown>
}
export interface DrillDownResult extends QueryResult {
  /** 'source' = lignes sources (requête réécrite) ; 'result' = repli sur les lignes du résultat. */
  mode: 'source' | 'result'
}
export type RowTarget =
  | { kind: 'requirement' | 'test'; id: string; repoPath: string }
  | { kind: 'campaign'; id: string; repoPath: string; status?: TestRunStatus }
  | { kind: 'campaign-run'; campaignId: string; entryId: string; repoPath: string }
```

### `QueryEngineService.drillDown(repoPath, queryDef, selection, workspaceDir)`

- **Builder** : copie du `builderConfig`, `groupBy` retiré, ajout d'une condition par valeur
  (`=`), combinées en `AND` avec le reste. Les conditions existantes de l'utilisateur sont
  conservées : si son combinator est `OR`, `buildSql` reçoit un `extraConditions` séparé, rendu
  `AND (<conditions utilisateur>) AND [col] = v` — nouvelle signature interne de `buildSql`.
  Valeur `null`/`undefined` → `[col] IS NULL` (nouvel opérateur interne, non exposé dans l'UI).
  Colonne hors allowlist (ex. `count`, cas KPI) ignorée. → `mode: 'source'`.
- **SQL** : `alasql.parse(sql)` ; réécriture si et seulement si : une seule instruction `Select`,
  `from` = une seule `Table` connue du dataset, pas de `joins`/`union`/`except`/`intersect`, pas de
  sous-requête dans `from`, et chaque colonne cliquée correspond dans `columns` à une `Column`
  simple (directement ou via son alias `as`). SQL reconstruit **par chaînes** :
  `SELECT * FROM [table] WHERE (<where.toString()>) AND [col] = <sqlValue>` (sans
  `GROUP BY`/`HAVING`/`ORDER BY`/`LIMIT`/`TOP`), passé par `assertReadOnlySql` puis exécuté sur le
  même dataset. → `mode: 'source'`. Sinon : exécution de la requête d'origine puis filtrage JS des
  lignes dont les colonnes cliquées valent les valeurs cliquées (`Object.is`, `null` ≡ `undefined`)
  → `mode: 'result'`. Une erreur de parse → repli `result`.
- Comparaison robuste du libellé : le renderer envoie la **valeur brute** de la ligne cliquée, pas
  le libellé recharts (voir ci-dessous) — pas de conversion `toLabel` à inverser.

### `QueryEngineService.resolveRowTarget(repoPath, row, workspaceDir)`

Ordre de la spec (§2) : `campaignId`+`entryId` → `campaign-run` si `status` ≠ `pending` (ou si la
ligne n'a pas de `status`, l'entrée est relue dans la campagne), sinon `campaign` +
`status: 'pending'` ; `campaignId` seul → `campaign` (+ `status` si la ligne en porte un valide) ;
`id` → recherche dans les index exigences / tests puis dans les campagnes de chaque repo du
périmètre (`resolveRepos`) → `requirement` / `test` / `campaign` ; sinon `null`.

### IPC

- `queries:drill-down` (repoPath, queryDef, selection, workspaceDir) → `DrillDownResult`
- `queries:resolve-row-target` (repoPath, row, workspaceDir) → `RowTarget | null`
- Ajout aux `WEB_EXPOSED` (`web-server/channel-policy.ts`), preload/`api.queries`, bridge web. Lecture
  seule, chemins passés par la garde existante (`ROOT_ARGS`, mêmes positions que
  `queries:execute`).

### Renderer

- `WidgetRenderer` / widgets : nouvelle prop optionnelle `onSelect?(values: Record<string, unknown>)`
  et `onRowClick?(row)` ; absentes (aperçu de `WidgetConfigModal`, impression) → rien de cliquable.
  - `BarWidget` / `LineWidget` : chaque point pivoté garde `__raw: { [category]: valeurBrute }` et,
    par série, la valeur brute de la série (map `label → brut` construite au pivot). `onClick` de
    `<Bar>` (segment, donc série connue) / `activeDot.onClick` de `<Line>`.
  - `PieWidget` : `onClick` de `<Pie>` → `payload.__raw`.
  - `KpiWidget` : tuile cliquable → `onSelect({})`.
  - `TableWidget` / `ResultTable` : prop `onRowClick` ; curseur main seulement sur les lignes pour
    lesquelles `isRowNavigable(row)` (colonnes `campaignId` ou `id` présentes et non vides — la
    résolution finale reste côté main ; ligne finalement introuvable → toast « Objet introuvable »).
- `DashboardGrid.WidgetCard` (hors `printMode`) : `onSelect` → ouvre `DrillDownModal` ;
  `onRowClick` → `openRowTarget`.
- Nouveau `components/dashboard/DrillDownModal.tsx` : modale standard de l'app (même gabarit que
  `WidgetConfigModal`), titre `widget.title — v1 / v2`, `useQuery(['widget-drilldown', repoPath,
  widget.id, values])`, `ResultTable` avec `onRowClick`, bandeau de repli si `mode === 'result'`.
- Nouveau `lib/openRowTarget.ts` : `api.queries.resolveRowTarget` puis `openTab(pathname, search)`
  (`TabsContext`) :
  - `requirement` → `/req/$id`, `test` → `/test/$id` (search `repoPath`, `projectId`) ;
  - `campaign` → `/campaign/$id` (+ `status`) ; `campaign-run` → `/campaign/$id/run/$entryId`.

### Page campagne — `routes/campaign.$campaignId.tsx`

- `validateSearch` : `status?: TestRunStatus` (valeur hors liste ignorée).
- Les pastilles de compteur deviennent des boutons bascule (clic = filtrer ; re-clic = retirer) ;
  état reflété dans l'URL (`navigate({ search, replace: true })`). Une puce « Filtre : X ✕ » rappelle
  le filtre actif. La liste des entrées (`campaign.runs.map`) est filtrée ; les actions groupées
  existantes (sélection, retrait) ne portent que sur les entrées visibles.

## Fichiers modifiés

| Fichier | Sprint | Pourquoi |
|---|---|---|
| `packages/types/src/schema.ts` | 1 | `autoPullIntervalMinutes` |
| `packages/types/src/dashboard.ts` | 2 | `DrillDownSelection`, `DrillDownResult`, `RowTarget` |
| `main/services/query-engine.service.ts` | 1, 2 | table, allowlist ; `drillDown`, `resolveRowTarget` |
| `main/services/schema-lookup.util.ts` | 1 | `CAMPAIGN_ENTRY_FIELDS` |
| `main/services/dashboard-seed.service.ts` | 1 | seed « Campagnes » |
| `main/container.ts`, `mcp-server/container.ts` | 1 | injection `CampaignsService` |
| `main/ipc/index.ts`, `preload`, `renderer/api.ts`, bridge web, `web-server/channel-policy.ts` | 1, 2 | `locale` sur `dashboards:list` ; 2 channels |
| `mcp-server/tools/suivi-common.ts` (+ descriptions) | 1 | table citée |
| `renderer/hooks/useLiveFileSync.ts` | 1 (+2) | invalidation widgets |
| `renderer/hooks/useAutoPull.ts`, `renderer/lib/autoPullInterval.ts` | 1 | intervalle |
| `renderer/routes/preferences.tsx` | 1 | réglage |
| `renderer/components/dashboard/QueryBuilder.tsx` | 1 | source campagne |
| `renderer/routes/dashboard.tsx` / appel `dashboards.list` | 1 | `locale` |
| `renderer/components/dashboard/widgets/*`, `ResultTable.tsx`, `DashboardGrid.tsx` | 2 | clics |
| `renderer/components/dashboard/DrillDownModal.tsx`, `renderer/lib/openRowTarget.ts` | 2 | nouveaux |
| `renderer/routes/campaign.$campaignId.tsx` | 2 | filtre statut |
| `renderer/i18n/locales/{fr,en}.json` | 1, 2 | libellés |
| tests unitaires `*.test.ts`, `e2e-web/gh65-*.spec.ts` | 1, 2 | voir GH65-tests.md |

## Décisions et alternatives rejetées

- **Champs de campagne préfixés `campaign_`** plutôt qu'étalés tels quels : une campagne a souvent
  un champ `status`/`title`/`description` qui écraserait les colonnes de l'entrée.
- **`objectTypeRef` dupliqué sur `campaign_entries`** plutôt qu'un `scopeColumn` par table dans
  `buildSql` : zéro changement du générateur SQL du builder.
- **Réécriture SQL par AST + reconstruction par chaînes** plutôt que `SELECT * FROM (<sql>) WHERE` :
  l'enveloppe ne rend jamais les lignes sources d'une requête agrégée (spec validée : builder + SQL).
  Reconstruction par chaînes plutôt que mutation de l'AST : la priorité `AND`/`OR` est garantie par
  les parenthèses explicites.
- **Valeurs brutes transmises par le widget** plutôt que libellés recharts : `toLabel` est lossy
  (`null` → `—`, dates localisées).
- **Résolution de la cible côté main** plutôt qu'une colonne `repoPath` dans les tables : pas de
  chemin absolu exposé en SQL / MCP / exports, et le même mécanisme sert les trois tables.
- **Seed à marqueur de reprise** plutôt que « dossier vide » : le dossier contient déjà « Status ».
- **Seed privé** plutôt que partagé (révision sprint 1) : un seed partagé automatique sur des projets
  existants multi-utilisateurs crée un exemplaire par clone (doublons / conflits add/add) et laisse
  des fichiers non publiés qui bloquent le pull automatique.
- **Invalidation sans filtre de repo** plutôt qu'un mapping repo composant → repo racine : plus
  simple, coût négligeable (seuls les widgets montés se ré-exécutent).
- **Libellés du seed côté main en table statique fr/en** plutôt qu'un seed déclenché par le
  renderer : garde le seed côté main (garanties existantes : dédup, branche lecture seule).
- Rejeté : index en mémoire des campagnes — `list` relit des YAML peu nombreux ; à revoir si mesuré
  lent.

## Découpage en sprints

**Sprint 1 — données et temps réel** : table `campaign_entries` (moteur, builder, MCP), invalidation
des widgets, intervalle de pull (préférence + UI + libellé), seed « Campagnes ». Livrable
autonome : le dashboard Campagnes existe et se met à jour seul.

**Sprint 2 — navigation** : `drillDown`, `resolveRowTarget`, IPC, clics des widgets,
`DrillDownModal`, `openRowTarget`, filtre par statut de la page campagne, invalidation
`widget-drilldown`, e2e de navigation, mises à jour SPEC (dernier sprint).
