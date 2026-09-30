# GH18-tests — Scénarios de validation

Pas d'infrastructure de test unitaire sur `main/services/*` ni sur le serveur MCP (cf.
T122-tests.md, GH16-tests.md) : scénarios à exécuter par l'Agent Dev via un client MCP
réel ou un script Node client stdio (`@modelcontextprotocol/sdk/client`), sur une
**copie jetable** d'un repo Polenta d'exemple, plus `pnpm typecheck`.

**Pré-requis du repo de test** : branche `main` (écriture autorisée) ; ≥ 3 exigences de
statuts différents d'un type `root::exigence-systeme` (champ `priority`) ; ≥ 1 test ; une
requête partagée `QS` (`SELECT status, COUNT(*) AS n FROM requirements GROUP BY status`) ;
un dashboard partagé `DS` contenant un widget `bar` sur `QS` (`category: status`,
`measure: n`) ; un fichier `.alice.pref` avec une requête privée `QP` et un dashboard privé
`DP`.

Pour chaque écriture : hash de `queries/`, `dashboards/`, `.alice.pref`,
`config/counters.yaml` avant/après. Serveur lancé **sans** `--user` sauf mention
« (alice) » = `--user alice`.

## Sprint 1 — démarrage, requêtes

- **Q1 — `--user` invalide** : `--user ../x`, `--user "a b"`, `--user ""` → exit 1, message
  stderr, rien sur stdout. `POLENTA_USER=alice` sans CLI = équivalent à `--user alice`.
- **Q2 — Découverte** : la liste des tools contient `list_queries`, `run_query`,
  `create_query`, `update_query`, `delete_query`.
- **Q3 — `list_queries`** : sans user → `QS` seule ; (alice) → `QS` + `QP` ;
  (alice) `{ scope: 'private' }` → `QP` seule.
- **Q4 — `run_query` SQL** : définition de `QS` → mêmes lignes que la vue Requêtes de
  l'app ; `sql` renvoyée = texte fourni.
- **Q5 — `run_query` builder** : `{ mode: 'builder', builderConfig: { objectTypeRef:
  'root::exigence-systeme', conditions: [{ field: 'priority', operator: '=', value:
  'high' }], combinator: 'AND' } }` → lignes filtrées ; `sql` = SQL générée.
- **Q6 — `run_query { queryId }`** : `QS` OK ; `QP` sans user → `QUERY_NOT_FOUND` ;
  ni `queryId` ni `definition`, ou les deux → `INVALID_INPUT`.
- **Q7 — Pagination** : `limit: 2, offset: 1` → 2 lignes, `total` = nombre complet.
- **Q8 — Fraîcheur** : créer une exigence dans l'app (serveur déjà lancé) puis `run_query`
  sur `requirements` → la nouvelle exigence est présente.
- **Q9 — Garde-fous** : `DELETE FROM requirements` → `FORBIDDEN_SQL` ; `SELECT * INTO
  CSV('x.csv') FROM requirements` → `FORBIDDEN_SQL`, aucun fichier créé ; `SELECT * FROM
  requirements WHERE title LIKE '%update%'` → accepté.
- **Q10 — Builder invalide** : `objectTypeRef: 'root::inexistant'` → `INVALID_BUILDER_CONFIG` ;
  `field: 'nope'` → `INVALID_BUILDER_CONFIG` citant `nope` ; `operator: 'LIKE'` → zod
  ou `INVALID_BUILDER_CONFIG`.
- **Q11 — `create_query` dryRun implicite** : aperçu avec `id` = prochain `QUERY-xxxx`,
  `createdBy: mcp`, `preview.columns`/`total`/`sample` ; hashes **inchangés** (compteur
  compris).
- **Q12 — `create_query { dryRun: false }`** : fichier `queries/QUERY-xxxx.yaml`,
  `createdBy: mcp` ; relancer avec le même titre en majuscules → `DUPLICATE_TITLE` citant
  l'id. SQL `SELECT FROM` → `QUERY_EXECUTION_ERROR`. `mode: 'sql'` + `builderConfig` →
  `INVALID_QUERY_DEFINITION`. `scope: 'private'` sans user → `PRIVATE_SCOPE_UNAVAILABLE`.
  (alice) `scope: 'private'` → ajoutée dans `.alice.pref`, id `local-…`, aucun fichier
  sous `queries/`.
- **Q13 — `update_query`** : renommer `QS` → OK ; changer sa SQL en
  `SELECT priority, COUNT(*) AS n FROM requirements GROUP BY priority` → écrit, `warnings`
  contient `WIDGET_MAPPING_BROKEN` pour le widget de `DS` (colonne `status` disparue).
  Passage `mode: 'builder'` sans `builderConfig` → `INVALID_QUERY_DEFINITION` ; avec →
  YAML sans `sqlText`. Id inconnu → `QUERY_NOT_FOUND`. `QP` sans user →
  `PRIVATE_SCOPE_UNAVAILABLE`.
- **Q14 — `delete_query`** : `QS` → `QUERY_IN_USE` avec `DS`/widget listés, fichier
  toujours présent ; requête sans widget, `dryRun: false` → fichier supprimé.
- **U1 — Branche lecture seule** : `git checkout -b prj-test` → tout tool d'écriture
  (même en dryRun) → `READONLY_BRANCH` ; `list_*`/`run_query` fonctionnent.
- **U2 — Pas de `.pref` parasite** : après toute la série sans user, aucun fichier
  `.*.pref` nouveau dans le repo.
- **U3 — Seed inchangé** : `DashboardSeedService` saute toujours le seed sur `prj-*`
  (vérif. app : dossier `dashboards/` vide, branche `prj-*` → pas de dashboard Status).
- **L1 — Live requêtes** : app ouverte sur Suivi ; `create_query { dryRun: false }` → la
  requête apparaît dans la section Requêtes en ≤ 2 s, sans rechargement ; `delete_query`
  → disparaît.
- **L2 — Live `.pref`** : (alice, app connectée en alice) création privée → visible.

## Sprint 2 — dashboards, widgets, doc

- **D1 — Découverte** : 8 tools de plus (`list_dashboards`, `create_dashboard`,
  `update_dashboard`, `delete_dashboard`, `add_widget`, `update_widget`, `delete_widget`,
  `reorder_widgets`).
- **D2 — `list_dashboards`** : sans user → `DS` seul, widgets dans l'ordre `widgetOrder`,
  `queryTitle` renseigné ; (alice) → + `DP`.
- **D3 — Pas de seed** : sur un repo sans `dashboards/`, `list_dashboards` → `[]`, aucun
  fichier créé (ni `DASHBOARD-*`, ni `.seeded.yaml`).
- **D4 — `create_dashboard`** : dryRun → aucun fichier ; `dryRun: false` →
  `dashboards/DASHBOARD-xxxx.yaml`, `widgets: []`, `createdBy: mcp` ; même titre →
  `DUPLICATE_TITLE`.
- **D5 — `update_dashboard` / `delete_dashboard`** : renommage OK ; id inconnu →
  `DASHBOARD_NOT_FOUND` ; suppression → fichier retiré, requêtes intactes.
- **D6 — `add_widget` nominal** : `bar` sur `QS` (`category: status, measure: n`) dans un
  nouveau dashboard, `dryRun: false` → widget présent, id ajouté en fin de `widgetOrder`,
  `size: md` par défaut.
- **D7 — `position`** : `position: 0` → id en tête de `widgetOrder`.
- **D8 — Scope** : dashboard partagé + `QP` (alice) → `PRIVATE_QUERY_IN_SHARED_DASHBOARD` ;
  dashboard privé `DP` + `QP` (alice) → accepté.
- **D9 — Mapping requis** : `kpi` sans `measure` → `MISSING_MAPPING` ; `pie` sans
  `category` → `MISSING_MAPPING` ; `table` sans `columns` → accepté.
- **D10 — Mapping autorisé** : `pie` avec `series` → `INVALID_MAPPING` ; `bar` avec
  `stacked: true` sans `series` → `INVALID_MAPPING` ; `kpi` avec `columns` → `INVALID_MAPPING`.
- **D11 — Colonnes** : `category: 'inexistant'` → `UNKNOWN_COLUMN` avec la liste des
  colonnes ; requête au résultat vide (`WHERE 1=0`) → accepté + `COLUMNS_UNVERIFIED`.
- **D12 — Doublon** : même requête/type/mapping qu'un widget existant → `DUPLICATE_WIDGET` ;
  même requête, type différent → accepté.
- **D13 — `update_widget`** : changer `type` en `pie` (mapping conservé) → OK ; changer
  `fieldMapping` → ancien mapping remplacé (pas fusionné) ; rendre identique à un voisin →
  `DUPLICATE_WIDGET` ; widget inconnu → `WIDGET_NOT_FOUND`.
- **D14 — `delete_widget`** : widget retiré de `widgets` et `widgetOrder`.
- **D15 — `reorder_widgets`** : permutation valide → écrite ; id manquant, id inconnu,
  doublon → `INVALID_ORDER`.
- **D16 — dryRun global** : chaque tool d'écriture dashboard sans `dryRun` → hashes
  inchangés.
- **L3 — Live dashboards** : app ouverte sur `DS` ; `add_widget`/`delete_widget` via MCP
  → la grille se met à jour en ≤ 2 s.
- **A1 — AGENTS.md** : ouverture d'un projet avec AGENTS.md v2 → régénéré en v3,
  mentionne les 13 tools, `--user`, `run_query` avant `add_widget`.

## Critères transverses

- `pnpm --filter desktop typecheck` sans erreur (et `build:mcp-server`).
- Chemin UI inchangé : créer/modifier/supprimer requête, dashboard, widget depuis l'app
  fonctionne comme avant ; exécuter une requête builder sur un type supprimé du schéma
  fonctionne toujours (repli historique préservé).
