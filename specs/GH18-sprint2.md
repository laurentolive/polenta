# GH18 — Sprint 2 : dashboards, widgets, documentation

> Issue [#18](https://github.com/laurentolive/polenta/issues/18) — spec `specs/GH18.md`,
> design `specs/GH18-design.md`, tests `specs/GH18-tests.md`, sprint 1 `specs/GH18-sprint1.md`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `apps/desktop/src/mcp-server/tools/dashboards.tools.ts` | **nouveau** — `list_dashboards`, `create/update/delete_dashboard`, `add/update/delete_widget`, `reorder_widgets` |
| `apps/desktop/src/mcp-server/tools/suivi-common.ts` | + `findVisibleQuery` (déplacé depuis `queries.tools.ts`), `findVisibleDashboard`, `peekSharedId` (généralise `peekSharedQueryId`) |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts` | utilise les helpers déplacés |
| `apps/desktop/src/mcp-server/index.ts` | `registerDashboardTools` |
| `apps/desktop/src/main/services/suivi-validation.util.ts` | + `validateWidget`, `validateOrder`, `orderedWidgets`, `pruneMapping` |
| `apps/desktop/src/main/services/agents-md.template.ts` | tools vue Suivi + `--user` documentés ; version 2 → 3 |
| `specs/SPEC-MCP-SERVER.md`, `specs/SPEC-DASHBOARDS.md`, `specs/SPEC-INDEX.md` | cf. « Mises à jour SPEC » |

## Comportement implémenté

Conforme à la spec §3 (dashboards/widgets) : un objet par appel, `dryRun` par défaut,
`READONLY_BRANCH`, `PRIVATE_SCOPE_UNAVAILABLE`, widgets validés dans l'ordre
`DASHBOARD_NOT_FOUND` → `QUERY_NOT_FOUND` → `PRIVATE_QUERY_IN_SHARED_DASHBOARD` → exécution
de la requête → `MISSING_MAPPING`/`INVALID_MAPPING` → `UNKNOWN_COLUMN` (ou
`COLUMNS_UNVERIFIED` si résultat vide) → `DUPLICATE_WIDGET`. `position` d'`add_widget`
appliquée par un `setWidgetOrder` après l'ajout. `list_dashboards` trie les widgets selon
`widgetOrder`, ajoute `queryTitle`, ne déclenche pas le seed.

## Divergences par rapport au design

1. **`update_widget` — revue `/code-review`** : l'éditeur de l'app (`WidgetConfigModal`)
   conserve les clés de mapping d'un ancien type (ex. kpi avec `category`, line avec
   `stacked: false`) et peut créer des widgets identiques. Pour ne pas bloquer un simple
   renommage de ces widgets :
   - titre/taille seuls → aucune revalidation du contenu ;
   - type changé sans `fieldMapping` → `pruneMapping` retire les clés inapplicables au
     nouveau type (écrit ainsi), puis validation normale ;
   - `fieldMapping` fourni → remplacement et validation complète (inchangé).
2. **`stacked: false` ≡ absent** (revue) : n'est plus compté comme clé renseignée — un
   widget line/pie/kpi/table portant `stacked: false` n'est plus refusé en `INVALID_MAPPING`.
3. `fieldMapping` validé en `.strict()` par zod : une clé inconnue est une erreur de
   validation d'entrée MCP (pas un code `INVALID_MAPPING`).
4. `orderedWidgets`, `pruneMapping`, `findVisibleDashboard`, `peekSharedId` ajoutés
   (non listés au design).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-MCP-SERVER.md` §1 | `dryRun` par défaut étendu aux écritures de la vue Suivi |
| `SPEC-MCP-SERVER.md` §2.2 | argument `--user` / `POLENTA_USER` |
| `SPEC-MCP-SERVER.md` §3 | services construits pour la vue Suivi, `user` exposé |
| `SPEC-MCP-SERVER.md` §4.5 | **nouvelle** — 13 tools, règles communes, scope, classement des erreurs, règles widget |
| `SPEC-MCP-SERVER.md` §7 | limites vue Suivi, externals alasql du bundle |
| `SPEC-MCP-SERVER.md` §8 | 5 nouveaux fichiers |
| `SPEC-DASHBOARDS.md` §6.1 | **nouvelle** — rafraîchissement sur écriture externe (`useLiveFileSync`) |
| `SPEC-DASHBOARDS.md` §7 | hors scope MCP (scope, ordre du panneau, historique, seed) |
| `SPEC-INDEX.md` | lignes `SPEC-MCP-SERVER §global` et `SPEC-DASHBOARDS §6` : mots-clés, MAJ → GH18 |

## Tests exécutés

Client MCP stdio scripté sur une copie jetable de `PL/Product` (+ fixtures) :
D1–D16 **OK** (dont D3 : aucun fichier créé sur un repo sans `dashboards/` ; D16 : hashes
inchangés en dryRun), U1 (écriture refusée sur `prj-x`, lecture OK), vérifications de la
revue (renommage/redimensionnement de widgets « legacy », élagage du mapping au changement
de type, `stacked: false` accepté sur line et considéré égal à « absent » pour le doublon).
`tsc --noEmit` OK, `build:mcp-server` OK.

**Non exécutés (UI)** : L3 (grille du dashboard ouvert mise à jour en direct), A1
(régénération d'AGENTS.md v3 à l'ouverture d'un projet), L1/L2 du sprint 1.

## Comment tester manuellement

1. `pnpm --filter desktop run build:mcp-server`, lancer l'app, ouvrir un dashboard partagé.
2. Via MCP : `run_query { queryId }` pour lire les colonnes, puis
   `add_widget { dashboardId, title, queryId, type: 'bar', fieldMapping: { category, measure }, dryRun: false }`
   → le widget apparaît sans recharger ; `reorder_widgets` / `delete_widget` idem.
3. Rouvrir un projet dont `AGENTS.md` porte le marqueur v2 → régénéré en v3, section
   « Serveur MCP » listant les tools de la vue Suivi.
