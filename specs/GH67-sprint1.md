# GH67 — Sprint 1 : aperçus de portée, partage groupé (main)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/dashboard.ts` | `PRIVATE_SCOPE_ID_PREFIX`, `isPrivateScopeId` (déplacés du main) ; types `ScopeWidgetRef`, `QueryScopeBlocker`, `QueryScopePreview`, `DashboardShareQuery`, `DashboardSharePreview` |
| `apps/desktop/src/main/services/id-scope.util.ts` | réexporte le préfixe ; `assertScope` (portée reçue d'un canal) |
| `apps/desktop/src/main/services/suivi-scope.service.ts` (nouveau) | `previewQueryScope`, `previewDashboardShare`, `shareDashboardWithQueries` |
| `apps/desktop/src/main/services/dashboards.service.ts` | `DependentWidget` = `ScopeWidgetRef` ; `renameInOrder` → `moveDashboardUserState` + `moveDashboardKeys` (point unique des données `.pref` par dashboard) ; `assertScope` dans `setScope` |
| `apps/desktop/src/main/services/saved-queries.service.ts` | `assertScope` dans `setScope` |
| `apps/desktop/src/main/container.ts`, `main/ipc/index.ts` | `suiviScope` ; canaux `queries:scope-preview`, `dashboards:share-preview`, `dashboards:share-with-queries` |
| `apps/desktop/src/web-server/channel-policy.ts` | trois canaux exposés, `ROOT_ARGS` `[0]` |
| `packages/api-client/src/{types,ipc-client}.ts` | `queries.scopePreview`, `dashboards.sharePreview`, `dashboards.shareWithQueries` |
| `apps/desktop/src/main/services/suivi-scope.service.test.ts` (nouveau) | 17 tests |

## Comportement implémenté

- Aperçu d'une requête : bloquants `read-only` / `params` (et `dependents` en rétrogradation),
  `remapped` (dashboards privés de l'utilisateur), `titleTakenBy` (partagées au même titre, casse
  et espaces de bord ignorés, lues seulement pour une promotion), `columnRemoved`.
- Aperçu d'un dashboard privé : une entrée par requête privée (widgets de ce dashboard, autres
  dashboards remappés), `missing` (id privé introuvable) ; deux requêtes du lot au même titre se
  signalent l'une l'autre. Dashboard en lecture seule → `SUIVI_READ_ONLY` ; déjà partagé → erreur.
- Partage groupé : aperçu recalculé, refus `SCOPE_BLOCKED` sans écriture ; promotions puis
  dashboard ; échec après au moins une promotion → `SCOPE_PARTIAL: k requête(s) sur N partagée(s) ; …`,
  échec à la première → erreur d'origine (rien de promu).
- Portée autre que `private` / `shared` refusée dans les deux `setScope` et l'aperçu.

## Divergences par rapport au design

- `previewDashboardShare` refuse aussi un dashboard déjà partagé ; `titleTakenBy` couvre les
  homonymes du lot ; `SCOPE_PARTIAL` seulement si au moins une requête a été promue (constats de la
  revue de code).
- `assertScope` ajouté aux deux `setScope` existants (revue : une portée invalide reçue par le canal
  web aurait été traitée comme une promotion).
- Les gardes de l'aperçu recopient celles de `SavedQueriesService.setScope` (commentaire « à garder
  alignées ») plutôt qu'une fonction commune : `setScope` mêle gardes et écriture, l'extraction
  aurait élargi le changement.

## Vérifications

- `pnpm typecheck` : 0 erreur. `pnpm lint` : aucune tâche lint définie dans le monorepo (no-op).
- `npx vitest run` ciblé (`suivi-scope`, `suivi-store`, `suivi-params`, `channel-policy`) : vert.
- `pnpm test` complet : 1608 / 1609 ; échec `sync.service.gh173.test.ts > U4` (délai de 20 s
  dépassé pendant la suite complète), vert seul — sans rapport (service de synchronisation non
  touché).
- e2e : rien à lancer pour ce sprint (aucune UI) ; e2e du ticket au sprint 2.
- `/code-review` (medium) sur le diff : constats corrigés (voir divergences) ; non retenus : coût
  de `findDependentWidgets` par requête (volumes faibles).

## Comment tester manuellement

Sans UI à ce sprint : `suivi-scope.service.test.ts`.
