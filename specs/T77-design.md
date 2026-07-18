# T77 — Design technique

**Statut** : designing
**Branche** : T77
**Worktree** : `../polenta-T77/`

---

## Vue d'ensemble des couches

- **Main process** (Electron) : 3 nouveaux services — `query-engine.service.ts` (exécution AlaSQL sur données agrégées), `saved-queries.service.ts` (CRUD requêtes + historique, règles de scope/dépendance), `dashboards.service.ts` (CRUD dashboards + widgets embarqués).
- **IPC** : nouveaux namespaces `queries:*` et `dashboards:*`, suivant le pattern existant (`tree:save` → handler dans `ipc/index.ts` + méthode dans `ApiClient`/`ipc-client.ts`, pont preload générique inchangé).
- **Renderer** : nouveau panel `'dashboard'` dans l'`ActivityBar`, deux familles de routes (Requêtes / Dashboard), nouveaux composants dédiés.

---

## Nouvelles dépendances

| Lib | Usage | Où | Alternative rejetée |
|---|---|---|---|
| `alasql` | SQL sur tableaux JS, sans moteur de stockage | main process (`query-engine.service.ts`) | `better-sqlite3` (natif, nécessite un vrai schéma/INSERT, nomme explicitement "SQLite" — voir décision D1 discutée avec l'utilisateur) |
| `recharts` | Rendu des widgets barres/camembert/courbe | renderer | `visx` (plus bas niveau, plus de code pour le même résultat) ; `chart.js` (canvas, plus dur à thémer avec les tokens CSS/dark mode du design system existant — cf. mémoire "Tailwind opacité CSS variables") |
| `exceljs` | Export `.xlsx` du résultat de requête | main process | Aucune infra d'export Excel existante trouvée dans le repo malgré la mention `SPEC.md` §2.4/T43 — **le ticket T43 (export cahier Excel/Word) n'est pas encore implémenté**. On implémente ici un export autonome minimal (result table → .xlsx), sans dépendre de T43. Si T43 est fait plus tard, mutualiser. |

Aucune de ces libs n'existe actuellement dans le monorepo (vérifié par grep sur tous les `package.json`).

---

## Fichiers à créer / modifier

### Main process
- `apps/desktop/src/main/services/query-engine.service.ts` **(NEW)**
- `apps/desktop/src/main/services/saved-queries.service.ts` **(NEW)**
- `apps/desktop/src/main/services/dashboards.service.ts` **(NEW)**
- `apps/desktop/src/main/ipc/index.ts` **(MODIFIED)** — handlers `queries:*`, `dashboards:*`
- `apps/desktop/src/main/ipc/pref.handlers.ts` **(MODIFIED)** — étend le JSON `.{username}.pref` avec `savedQueries`, `queryHistory`, `dashboards`
- `config/counters.yaml` (mécanisme existant, cf. `reviews.service.ts`) — ajoute `nextQueryId`, `nextDashboardId`

### Types partagés
- `packages/types/src/dashboard.ts` **(NEW)** — `SavedQuery`, `QueryHistoryEntry`, `BuilderConfig`, `Widget`, `Dashboard`, `QueryResult`
- `packages/api-client/src/types.ts` **(MODIFIED)** — interface `queries.*` / `dashboards.*`
- `packages/api-client/src/ipc-client.ts` **(MODIFIED)** — implémentation `invoke(...)`

### Renderer
- `apps/desktop/src/renderer/components/layout/ActivityBar.tsx` **(MODIFIED)** — entrée panel `dashboard`
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` **(MODIFIED)** — `Panel` type + `deducePanel()`
- `apps/desktop/src/renderer/components/layout/Sidebar.tsx` **(MODIFIED)** — branchement du nouveau panel
- `apps/desktop/src/renderer/components/sidebar/DashboardPanel.tsx` **(NEW)** — 2 sections réorganisables (Dashboards / Requêtes)
- `apps/desktop/src/renderer/routes/query.$id.tsx` **(NEW)** — vue Requêtes
- `apps/desktop/src/renderer/routes/dashboard.$id.tsx` **(NEW)** — vue Dashboard
- `apps/desktop/src/renderer/components/dashboard/QueryBuilder.tsx` **(NEW)**
- `apps/desktop/src/renderer/components/dashboard/SqlEditor.tsx` **(NEW)**
- `apps/desktop/src/renderer/components/dashboard/ResultTable.tsx` **(NEW)**
- `apps/desktop/src/renderer/components/dashboard/WidgetConfigModal.tsx` **(NEW)**
- `apps/desktop/src/renderer/components/dashboard/widgets/{Bar,Pie,Line,Kpi,Table}Widget.tsx` **(NEW)**
- `apps/desktop/src/renderer/components/dashboard/DashboardGrid.tsx` **(NEW)** — grille réordonnable, DnD natif façon `ElementTree` (pas de nouvelle lib de DnD)
- `apps/desktop/src/renderer/routes/project.$id.tsx` **(MODIFIED)** — retrait des StatCards/répartitions/récemment modifiées

---

## Nouveaux types (`packages/types/src/dashboard.ts`)

```ts
export type QueryScope = 'private' | 'shared'
export type QueryMode = 'builder' | 'sql'

export interface BuilderCondition {
  field: string
  operator: '=' | '!=' | '>' | '<' | 'contains' | 'in'
  value: unknown
}

export interface BuilderConfig {
  objectTypeRef: string
  conditions: BuilderCondition[]
  combinator: 'AND' | 'OR'
  groupBy?: string[]
}

export interface SavedQuery {
  id: string
  title: string
  mode: QueryMode
  builderConfig?: BuilderConfig   // requis si mode === 'builder'
  sqlText?: string                // requis si mode === 'sql'
  scope: QueryScope
  createdBy: string
  createdAt: string
}

export interface QueryHistoryEntry {
  id: string
  mode: QueryMode
  builderConfig?: BuilderConfig
  sqlText?: string
  executedAt: string
}

export type WidgetType = 'bar' | 'pie' | 'line' | 'kpi' | 'table'
export type WidgetSize = 'sm' | 'md' | 'lg'

export interface WidgetFieldMapping {
  category?: string   // bar/pie/line
  measure?: string     // bar/pie/line/kpi
  series?: string      // line (multi-série), optionnel
  columns?: string[]   // table
}

export interface Widget {
  id: string
  title: string
  queryId: string
  type: WidgetType
  fieldMapping: WidgetFieldMapping
  size: WidgetSize
}

export interface Dashboard {
  id: string
  title: string
  scope: QueryScope
  widgetOrder: string[]
  widgets: Widget[]
  createdBy: string
  createdAt: string
}

export interface QueryResultColumn {
  name: string
  type: 'string' | 'number' | 'date' | 'boolean'
}

export interface QueryResult {
  columns: QueryResultColumn[]
  rows: Record<string, unknown>[]
}
```

---

## Moteur de requête

`query-engine.service.ts` :

1. **`buildDataset(repoPath): Promise<{ requirements: FlatRow[]; tests: FlatRow[]; links: FlatRow[] }>`**
   - Appelle `RequirementsIndexService.getOrBuild(repoPath)` et `TestsIndexService.getOrBuild(repoPath)` pour le repo courant.
   - Résout les composants submodules via `WorkspaceService.resolve()` (déjà utilisé pour la vue Structure/T70), répète l'appel pour chaque `repoPath` composant.
   - Fusionne toutes les lignes en ajoutant une colonne `component` (nom du nœud `schema.yaml`) pour distinguer l'origine — permet des requêtes cross-composant (`WHERE component = 'motor-control'`).
2. **`execute(repoPath, queryDef): Promise<QueryResult>`**
   - Reconstruit le dataset (étape 1) à chaque exécution — jamais mis en cache sur disque, cohérent avec l'esprit "index en mémoire reconstruit depuis le working tree" (`SPEC.md` §5). Le volume attendu (quelques milliers d'objets au plus) rend ce recalcul systématique négligeable en performance (analysé avec l'utilisateur en phase Spec).
   - Si `mode === 'builder'` : traduit `BuilderConfig` en SQL généré (`SELECT ... FROM requirements WHERE ... [GROUP BY ...]`).
   - Si `mode === 'sql'` : exécute `queryDef.sqlText` directement.
   - Exécute via `alasql(sql, [tables])`, retourne `{ columns, rows }`.
   - **Garde-fou mode SQL avancé** : rejette (erreur explicite, pas de faille de sécurité réelle puisqu'AlaSQL n'a accès à rien d'autre que les tableaux en mémoire fournis) toute requête contenant `INSERT|UPDATE|DELETE|DROP|CREATE|ATTACH` — protège contre une confusion utilisateur plutôt qu'une vraie vulnérabilité.

---

## Stockage

- **Partagé** : nouveaux dossiers `queries/` et `dashboards/` à la racine du repo produit — un fichier YAML par objet (`queries/QUERY-0001.yaml`, `dashboards/DASHBOARD-0001.yaml`), widgets **embarqués** dans le YAML du dashboard (pas de fichier séparé par widget — même logique que les approbations embarquées dans `reviews.service.ts`). IDs générés via `config/counters.yaml` (même mécanisme que les reviews).
- **Privé** : extension du fichier `.{username}.pref` existant avec trois clés : `savedQueries: SavedQuery[]`, `queryHistory: QueryHistoryEntry[]`, `dashboards: Dashboard[]`. IDs générés localement (uuid) — pas de compteur central nécessaire, aucun risque de collision puisque jamais commité.

---

## Règles de dépendance et de scope — décisions techniques

**Simplification par rapport à la Spec** : la Spec décrit trois entités indépendamment "privées ou partagées" (Requête / Widget / Dashboard). En pratique, un **Widget n'a pas de stockage propre** — il est toujours embarqué dans le fichier de son Dashboard parent. Il n'a donc pas de champ `scope` indépendant : son scope effectif est celui du Dashboard qui le contient. La règle "un widget ne peut être partagé que si sa requête est partagée" se traduit donc concrètement par : **`dashboards.service.ts` refuse de sauvegarder un `Dashboard` en `scope: 'shared'` si un seul de ses widgets référence une `SavedQuery` dont `scope !== 'shared'`.**

**Détection des dépendants (suppression / rétrogradation d'une requête)** :
- `findDependentWidgets(queryId)` scanne tous les dashboards **partagés** (dossier `dashboards/`) + les dashboards **privés de l'utilisateur courant** (son `.pref`).
- ⚠️ **Limite connue, acceptée pour ce ticket** : un dashboard privé d'un *autre* utilisateur référençant cette requête ne peut pas être détecté — son fichier `.{username}.pref` n'est ni versionné ni accessible depuis la session courante. Le blocage de suppression/rétrogradation n'offre donc une garantie complète que sur les dépendances visibles (partagées + les siennes). C'est un compromis assumé plutôt qu'un bug à corriger dans ce ticket — à documenter dans l'UI (ex. tooltip "aucune dépendance privée d'un autre utilisateur détectée" plutôt qu'une garantie absolue).

---

## Widgets pré-configurés (couverture / avancement / maturité)

- Fournis comme **dashboards partagés par défaut**, créés au premier accès à l'onglet si le dossier `dashboards/` est vide (seed automatique, pas une action manuelle de l'utilisateur).
- Dashboard "Couverture" : widgets basés sur des requêtes réutilisant la sémantique `CoverageStatus` déjà calculée par `traceability.service.ts` (le dataset du moteur de requête expose cette colonne directement sur la table `requirements`/`links`, pas de recalcul dupliqué).
- Dashboard "Maturité" : la requête AlaSQL calcule les 5 critères listés dans `specs/T77.md` § Critères de maturité, comme colonnes booléennes dérivées, agrégées ensuite en taux global/par domaine.

---

## Découpage en sprints

**Sprint 1 — Moteur de requête + vue Requêtes**
- Dépendances `alasql`, `exceljs`
- `query-engine.service.ts`, `saved-queries.service.ts` (CRUD + historique, sans les règles de dépendance widget/dashboard qui n'existent pas encore)
- IPC + types + `api-client`
- Nouvel onglet `ActivityBar` + panel latéral section "Requêtes" (liste réordonnable + filtre texte)
- Vue Requêtes complète : builder guidé, éditeur SQL avancé, table de résultat, sauvegarde, historique (purge auto + croix), export Excel

**Sprint 2 — Widgets + Dashboards**
- Dépendance `recharts`
- Types `Widget`/`Dashboard`, `dashboards.service.ts` (CRUD + règles de scope/dépendance)
- Panel latéral section "Dashboards"
- Vue Dashboard : grille à tailles prédéfinies réordonnable, popup d'ajout de widget avec aperçu live, rendu des 5 types de widget
- Règles de promotion/rétrogradation/suppression bloquée (validation croisée requêtes ↔ widgets)

**Sprint 3 — Dashboards pré-configurés + retrait de l'ancien tableau de bord**
- Seed des 3 dashboards partagés par défaut (couverture / avancement / maturité)
- Calcul des critères de maturité
- Retrait des StatCards/répartitions/récemment modifiées de `project.$id.tsx`

---

## Alternatives rejetées

- **SQLite en mémoire (`better-sqlite3`)** — rejeté après discussion avec l'utilisateur : nomme explicitement "SQLite", interdit par `CONTEXT.md` D1, nécessite une étape de matérialisation (schéma + INSERT) alors qu'AlaSQL interroge directement les tableaux JS déjà produits par les services d'index existants. Le volume de données attendu ne justifie pas la puissance supplémentaire d'un vrai moteur avec index B-tree (cf. analyse de seuil faite en phase Spec).
- **Contrainte du type de widget selon la forme du résultat** — envisagée puis abandonnée à la demande de l'utilisateur (trop frustrant) ; remplacée par un aperçu live dans la popup de configuration, qui laisse l'utilisateur seul juge.
- **Redimensionnement libre des widgets (`react-grid-layout`)** — abandonné pour une grille à tailles prédéfinies, plus simple et cohérente avec le pattern de réorganisation déjà utilisé ailleurs (DnD natif, pas de lib dédiée).
