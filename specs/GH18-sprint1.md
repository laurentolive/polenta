# GH18 — Sprint 1 : socle, tools requêtes, rafraîchissement live

> Issue [#18](https://github.com/laurentolive/polenta/issues/18) — spec `specs/GH18.md`,
> design `specs/GH18-design.md`, tests `specs/GH18-tests.md`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `apps/desktop/src/mcp-server/index.ts` | `--user` / `POLENTA_USER`, validation du nom (exit 1 sinon), `registerQueryTools` |
| `apps/desktop/src/mcp-server/container.ts` | construit `TraceabilityService`, `QueryEngineService`, `DashboardsService`, `SavedQueriesService` ; expose `user` |
| `apps/desktop/src/mcp-server/tools/suivi-common.ts` | **nouveau** — `NO_USER`, `resolveUser`, `suiviError`, `assertWritableBranch`, `freshenIndexes`, `runDefinition`, `resultColumnNames` |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts` | **nouveau** — `list_queries`, `run_query`, `create_query`, `update_query`, `delete_query` |
| `apps/desktop/src/main/services/suivi-validation.util.ts` | **nouveau** — codes d'erreur/avertissement, `validateQueryDefinitionShape`, `unknownBuilderFields`, `mappingColumns`, `findDuplicateTitle` |
| `apps/desktop/src/main/services/readonly-branch.util.ts` | **nouveau** — `isReadonlyBranch` |
| `apps/desktop/src/main/services/dashboard-seed.service.ts` | utilise `isReadonlyBranch` (comportement inchangé) |
| `apps/desktop/src/main/services/query-engine.service.ts` | `isReadOnlySql` exporté ; `inspectBuilderTarget` (strict) ; `resolveTableInfo` retourne aussi `resolved` |
| `apps/desktop/src/main/services/saved-queries.service.ts` | `UpdateSavedQueryDto.mode` ; `withSingleDefinition` (une seule définition, ordre des clés conservé) |
| `apps/desktop/src/renderer/hooks/useLiveFileSync.ts` | invalidation `queries/`, `dashboards/`, `.{user}.pref` |
| `apps/desktop/package.json` | `build:mcp-server` : `--external` react-native (cf. divergence 1) |

## Comportement implémenté

Conforme à la spec §1–§4 pour la partie requêtes : `--user` optionnel (sans lui, partagé
seulement ; aucune écriture `.pref` possible), `run_query` (requête sauvegardée ou ad hoc,
pagination offset/limit, index reconstruits à chaque appel), `create/update/delete_query`
avec `dryRun` par défaut, validation classée (`INVALID_QUERY_DEFINITION` →
`FORBIDDEN_SQL` → `INVALID_BUILDER_CONFIG` → `QUERY_EXECUTION_ERROR`), `DUPLICATE_TITLE`
insensible à la casse, `QUERY_IN_USE` avec la liste des widgets, `WIDGET_MAPPING_BROKEN`
non bloquant, `READONLY_BRANCH` sur `''`/`prj-*`, `createdBy: mcp`. L'app rafraîchit
panneau latéral et dashboard ouvert sur écriture externe.

## Divergences par rapport au design

1. **Bundle MCP** : `QueryEngineService` fait entrer `alasql` dans le bundle esbuild, dont
   la build Node contient des `require('react-native…')` (dans un try/catch ou des branches
   réservées à React Native). `react-native`, `react-native-fetch-blob`, `react-native-fs`
   sont marqués `--external` dans `build:mcp-server`.
2. **Aperçu d'id partagé** : lecture directe de `config/counters.yaml` (`QUERY + 1`, même
   calcul que `GitService.nextCounterId`) plutôt que `peekNextCounterId`, qui réconcilie
   aussi avec les fichiers présents et pouvait prédire un autre id que celui réellement
   attribué.
3. **Opérateurs builder** : pas d'export `SUPPORTED_OPERATORS` ; contrôlés par l'enum zod
   (erreur de validation d'entrée MCP, pas `INVALID_BUILDER_CONFIG`) — conforme au scénario
   Q10 (« zod ou `INVALID_BUILDER_CONFIG` »).
4. `mappingColumns` livré dès le sprint 1 (requis par les avertissements d'`update_query`).
5. **Garde de format d'id** (ajout) : un id partagé hors `QUERY-NNNN` n'est jamais résolu
   (`QUERY_NOT_FOUND`) — il servait sinon de chemin de fichier (`../…`).
6. **Revue `/code-review`** :
   - `useLiveFileSync` invalide aussi `['dashboard', …]` et `['print-dashboard', …]` (le
     dashboard ouvert ne se rafraîchissait pas, seulement la liste) ;
   - `inspectBuilderTarget` refuse un `component` introuvable (le repli de
     `resolveTableInfo` sur le repo courant pouvait résoudre un type homonyme).

## Tests exécutés

Client MCP stdio scripté (`@modelcontextprotocol/sdk/client`) sur une copie jetable de
`PL/Product` (+ fixtures `QUERY-0001`, `DASHBOARD-0001`, `.alice.pref`) :
Q1–Q14, U1, U2 **OK** (hashes inchangés en dryRun, aucun `.pref` créé sans user, index
frais après ajout d'un fichier en cours de session, `READONLY_BRANCH` sur `prj-test`,
exit 1 sur `--user` invalide). `tsc --noEmit` OK, `build:mcp-server` OK.

**Non exécutés (UI)** : L1, L2 (rafraîchissement live dans l'app), U3 (seed sur `prj-*`,
refactor à comportement identique).

## Comment tester manuellement

1. `pnpm --filter desktop run build:mcp-server`.
2. Lancer l'app sur un projet, ouvrir l'onglet Suivi.
3. Depuis un client MCP (`node out/mcp-server/index.cjs --repo <projet> [--user <login>]`) :
   `create_query { title, mode: 'sql', sqlText, dryRun: false }` → la requête apparaît dans
   le panneau Requêtes sans recharger ; `delete_query` → disparaît.
4. Avec `--user <login GitHub de l'app>` et `scope: 'private'` → visible dans l'app.
