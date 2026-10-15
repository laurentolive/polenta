# GH65 — Sprint 2 : navigation (sprint final)

Spec : [GH65.md](GH65.md) · Design : [GH65-design.md](GH65-design.md) · Tests : [GH65-tests.md](GH65-tests.md) ·
Sprint 1 : [GH65-sprint1.md](GH65-sprint1.md)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/dashboard.ts` | `DrillDownSelection`, `DrillDownResult`, `RowTarget` |
| `packages/api-client/src/{ipc-client,types}.ts` | `queries.drillDown`, `queries.resolveRowTarget` |
| `apps/desktop/src/main/services/query-engine.service.ts` | `drillDown` (builder + AST AlaSQL exécuté, repli), `resolveRowTarget`, `runOnDataset` |
| `apps/desktop/src/main/ipc/index.ts`, `web-server/channel-policy.ts` | channels `queries:drill-down` (`ROOT_ARGS` [0, 3]), `queries:resolve-row-target` ([0, 2]), exposés au client web |
| `apps/desktop/src/renderer/components/dashboard/widgets/*` | `onSelect` (barre/segment, part, point, KPI), `onRowClick` (table), valeurs brutes (`drilldown.ts`) |
| `apps/desktop/src/renderer/components/dashboard/{ResultTable,DashboardGrid,DrillDownModal}.tsx` | lignes cliquables, popup de détail (portail) |
| `apps/desktop/src/renderer/lib/rowNavigation.ts`, `hooks/useOpenRowTarget.ts` | lignes navigables, route de l'objet, ouverture en onglet |
| `apps/desktop/src/renderer/hooks/useQueryResult.ts` | `toQueryDefinition` partagé |
| `apps/desktop/src/renderer/contexts/TabsContext.tsx` | `useOptionalTabs` (routes sans `TabsProvider`) |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | filtre par statut (paramètre d'URL optionnel `status`, pastilles bascule) |
| `apps/desktop/src/renderer/hooks/useLiveFileSync.ts` | invalidation de `widget-drilldown` |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | libellés |
| `specs/SPEC-*.md`, `specs/SPEC-INDEX.md` | mises à jour SPEC (ci-dessous) |
| Tests | `query-engine.drilldown.test.ts` (22), `rowNavigation.test.ts` (3), `e2e-web/gh65-navigation.spec.ts` (5) |

## Comportement implémenté

- **Drill-down** : clic sur une barre / un segment (catégorie + série), une part, un point de courbe
  (catégorie), une tuile KPI (toutes les lignes) → popup « Détail » avec les lignes sources.
  Builder : `groupBy` retiré, valeurs en `AND`. SQL : AST de la requête modifié puis exécuté
  (jamais re-sérialisé) pour une sélection mono-table simple ; sinon repli sur les lignes du
  résultat, signalé dans la popup.
- **Ouverture** : clic sur une ligne (popup ou widget table) → entrée exécutée = résultat
  d'exécution ; entrée `pending` = page de campagne filtrée ; `campaignId` = campagne ; `id` =
  exigence / test / campagne, cherchés dans tous les repos du workspace. Introuvable ou erreur →
  mention sous la table.
- **Page campagne** : pastilles de statut = filtres (re-clic pour retirer), état dans l'URL.
- **Temps réel** : la popup ouverte se met à jour comme les widgets.

## Divergences par rapport au design

1. **Réécriture SQL par AST exécuté**, pas par chaînes (revue) : le `toString()` d'AlaSQL n'échappe
   pas les apostrophes (`'l''eau'` → `'l'eau'`), ce qui changeait le sens du WHERE. Bonus : l'alias
   de table est conservé. TOP / LIMIT / OFFSET / INTO → repli.
2. Nœuds de l'AST testés par `instanceof alasql.yy.*` : le bundle serveur est minifié, les
   `constructor.name` n'y survivent pas (trouvé par l'e2e — les tests unitaires passaient).
3. Builder : colonne cliquée hors allowlist ou valeur non scalaire → **repli explicite**, plutôt
   qu'ignorer silencieusement le filtre (revue).
4. Courbe : clic = catégorie seule (point visé non identifiable de façon fiable avec plusieurs séries).
5. Lignes de lien (`sourceId` + `targetId`) non cliquables ; erreur d'ouverture distinguée de
   « introuvable » ; `resolveRowTarget` par `findById` (revue).
6. `useOptionalTabs` : la route d'impression d'un dashboard n'a pas de `TabsProvider` — `useTabs()`
   y levait une exception et cassait l'export PDF (trouvé par l'e2e S4-1).
7. Pas de toast dans l'app : « Objet introuvable » est affiché sous la table concernée.

Point de revue non retenu : deux valeurs brutes différentes de même libellé (`1` et `'1'`, dates au
même libellé local) sont confondues au clic — cas marginal.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-DASHBOARDS.md` §2 | quatre tables, dataset mutualisé ; §2.1 table `campaign_entries` ; §2.2 drill-down et ouverture d'objet |
| `SPEC-DASHBOARDS.md` §4 | navigation depuis les widgets |
| `SPEC-DASHBOARDS.md` §5 | §5.1b dashboard « Campagnes » privé par utilisateur, marqueur à reprise |
| `SPEC-DASHBOARDS.md` §6.1 | invalidation des widgets et de la popup sur tout repo |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §2.5 | intervalle du pull automatique réglable |
| `SPEC-TEMPLATES.md` §2 (§1–4) | préférence `autoPullIntervalMinutes` |
| `SPEC-TESTS.md` §4.3 | filtre par statut de la page campagne, renvoi vers la vue Suivi |
| `SPEC-MCP-SERVER.md` | `run_query` sur `campaign_entries` |
| `SPEC-INDEX.md` | colonne MAJ → GH65 pour ces 8 entrées, mots-clés ajoutés |

`SPEC-WEB.md` : inchangé (les deux channels suivent la règle générale de la liste blanche).

## Vérifications

- `pnpm typecheck` : 0 erreur. Pas de tâche lint configurée.
- `pnpm test` : desktop 221/221, merge-core 34/34.
- `pnpm test:e2e:web` : 36 passés, 13 ignorés (suites déploiement), 0 échec — dont GH65 8/8.

## Tester manuellement

1. Suivi → dashboard **Campagnes** : cliquer un segment FAIL → popup des entrées FAIL de cette
   campagne ; cliquer une ligne → résultat d'exécution.
2. Cliquer la tuile **% exécuté** → toutes les entrées des campagnes en cours ; une ligne `pending`
   → page de campagne filtrée sur `pending`.
3. Page de campagne : cliquer « 2 FAIL » → liste filtrée, URL `status=FAIL` ; re-cliquer.
4. Une requête **builder** sur les exigences groupée par statut, en barre : clic → exigences du
   statut ; clic sur une ligne → éditeur de l'exigence.
5. Une requête SQL avec jointure, en barre : clic → popup avec la mention de repli.
6. Camembert et courbe : clic sur une part / un point (scénario 2.5).
7. Aperçu dans la popup de configuration d'un widget, export PDF d'un dashboard : rien de cliquable,
   export inchangé (2.27).
