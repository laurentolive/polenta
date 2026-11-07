# GH67 — Design technique

> Spec : `specs/GH67.md` (validée le 2026-11-07). Deux sprints : **S1** main (types, services,
> IPC, client API, tests unitaires) ; **S2** renderer (confirmations, `/query`, panneau, dashboard),
> i18n, e2e, documentation et SPEC.

## 1. Vue d'ensemble

Tout passe par les mécanismes de portée existants (`SavedQueriesService.setScope`,
`DashboardsService.setScope`), qui restent l'unique chemin d'écriture. GH67 ajoute :

- des **aperçus** en lecture seule (ce qui sera fait, ce qui bloque), calculés côté main pour que
  l'UI et la vérification avant écriture utilisent la même règle ;
- une **orchestration** du partage groupé (requêtes puis dashboard) ;
- l'UI des deux confirmations.

## 2. Types (`packages/types/src/dashboard.ts`)

```ts
export const PRIVATE_SCOPE_ID_PREFIX = 'local-'
export function isPrivateScopeId(id: string): boolean      // déplacé depuis main/id-scope.util.ts (réexporté)

export interface ScopeWidgetRef { dashboardId: string; dashboardTitle: string; dashboardScope: QueryScope; widgetId: string; widgetTitle: string }

export type QueryScopeBlocker =
  | { kind: 'read-only'; reason: 'legacy-sql' | 'newer-format' }
  | { kind: 'params'; message: string }
  | { kind: 'dependents'; widgets: ScopeWidgetRef[] }          // rétrogradation seulement

export interface QueryScopePreview {
  queryId: string; title: string; from: QueryScope; to: QueryScope
  blockers: QueryScopeBlocker[]
  /** Promotion : widgets des dashboards privés de l'utilisateur qui suivront le nouvel id. */
  remapped: ScopeWidgetRef[]
  /** Promotion : ids des requêtes partagées au même titre (casse et espaces de bord ignorés). */
  titleTakenBy: string[]
  /** Rétrogradation : colonne calculée retirée (libellé brut, résolu par l'UI). */
  columnRemoved: QueryColumnDef['label'] | null
}

export interface DashboardShareQuery extends QueryScopePreview {
  /** Widgets de CE dashboard qui l'utilisent ; `remapped` = les autres dashboards privés. */
  widgets: { widgetId: string; widgetTitle: string }[]
}

export interface DashboardSharePreview {
  dashboardId: string
  queries: DashboardShareQuery[]                               // requêtes privées seulement, une par id
  missing: { widgetId: string; widgetTitle: string; queryId: string }[]  // id privé introuvable
}
```

`DependentWidget` (main) devient un alias de `ScopeWidgetRef`.

## 3. Services (main)

### 3.1 `SuiviScopeService` (nouveau, `main/services/suivi-scope.service.ts`)

Dépend de `SavedQueriesService` et `DashboardsService` (aucune dépendance circulaire : ni l'un ni
l'autre ne le connaît). Instancié dans `container.ts` après eux.

- `previewQueryScope(repo, user, id, to)` → `QueryScopePreview`. Requête introuvable → erreur.
  `readOnly` → bloquant `read-only` ; `parametersError` → `params` ; `to === 'private'` :
  `findDependentWidgets` non vide → `dependents`, `columnRemoved = column?.label ?? null` ;
  `to === 'shared'` : `remapped = findDependentWidgets` (que des privés), `titleTakenBy` sur
  `savedQueries.list` partagées. Même portée → aucun bloquant, listes vides.
- `previewDashboardShare(repo, user, id)` → `DashboardSharePreview`. Dashboard introuvable → erreur ;
  dashboard en lecture seule → erreur `SUIVI_READ_ONLY` (pas d'UI possible). Pour chaque `queryId`
  privé distinct des widgets (ordre des widgets) : `findOne` ; absent → `missing` ; sinon aperçu de
  promotion, `widgets` = dépendants dont `dashboardId === id`, `remapped` = les autres.
- `shareDashboardWithQueries(repo, user, id)` → `Dashboard`. Recalcule l'aperçu (liste périmée
  côté UI) ; bloquant ou `missing` → `Error('SCOPE_BLOCKED: …')` sans écriture. Puis
  `savedQueries.setScope(q, 'shared')` requête par requête ; un échec à la k-ième →
  `Error('SCOPE_PARTIAL: k-1 requête(s) sur N partagée(s) ; le dashboard n'a pas été partagé : <msg>')`.
  Enfin `dashboards.setScope(id, 'shared')` (l'id du dashboard privé n'a pas changé : le remappage
  ne touche que les widgets). Échec à cette étape : même message `SCOPE_PARTIAL` (N sur N).

Le préfixe de code d'erreur suit la convention `SUIVI_READ_ONLY` : l'UI affiche le message tel quel
(il est en français côté service, comme les autres erreurs de portée existantes) ; la confirmation
n'appelle l'écriture que si l'aperçu est sans bloquant, donc ces erreurs ne surviennent que sur une
liste périmée ou un échec d'écriture.

### 3.2 `DashboardsService` — point unique du déplacement des préférences par dashboard

`renameInOrder` est remplacé par `moveDashboardUserState(repo, user, oldId, newId)`, qui délègue à
une fonction pure `moveDashboardKeys(pref, oldId, newId): boolean` regroupant **toutes** les
données du `.pref` indexées par id de dashboard : `dashboardsOrder`, `suiviParamValues` (GH93).
GH125 (`suiviWidgetParamValues`, valeurs par dashboard + widget) n'aura qu'une ligne à y ajouter ;
les ids de widget sont conservés au changement de portée. Commentaire en tête de la fonction pour
le signaler. Aucun changement de comportement.

### 3.3 `SavedQueriesService`

Inchangé fonctionnellement. `findOne` / `list` / `setScope` suffisent.

## 4. IPC, client, serveur web

| Canal | Arguments | Retour |
|---|---|---|
| `queries:scope-preview` | `repoPath, username, id, scope` | `QueryScopePreview` |
| `dashboards:share-preview` | `repoPath, username, id` | `DashboardSharePreview` |
| `dashboards:share-with-queries` | `repoPath, username, id` | `Dashboard` |

`packages/api-client` (`types.ts`, `ipc-client.ts`) : `queries.scopePreview`,
`dashboards.sharePreview`, `dashboards.shareWithQueries`. `web-server/channel-policy.ts` : les trois
dans `WEB_EXPOSED`, `ROOT_ARGS` `[0]`. Pas de MCP (spec §3.10).

## 5. Renderer (S2)

- `components/dashboard/QueryScopeModal.tsx` : props `{ repoPath, username, query: { id, title,
  scope }, onClose, onChanged(updated: SavedQuery) }`. Lit l'aperçu (`['query-scope-preview', repo,
  user, id, to]`, `staleTime: 0`), affiche effet / bloquants / autres dashboards / titre pris /
  colonne retirée ; bouton de confirmation absent s'il y a un bloquant. Confirmer →
  `api.queries.setScope` ; succès → invalide `['queries', repo, user]`, `['queries-order', …]`,
  `['dashboards', …]`, `['dashboard', …]`, `['widget-query-result']`, `['suivi-updates']`, puis
  `onChanged`. Erreur → message dans la fenêtre. `useModalHotkeys` (Échap / Entrée).
- `components/dashboard/DashboardShareModal.tsx` : même structure sur `sharePreview` /
  `shareWithQueries` ; une ligne par requête (titre, widgets, « Aussi utilisée par », titre pris,
  bloquant), widgets à requête introuvable, ligne « les requêtes restent partagées si le dashboard
  repasse en privé ». Erreur `SCOPE_PARTIAL` : affichée, aperçu relu (ne liste plus que les
  requêtes restées privées), listes invalidées.
- `routes/dashboard.tsx` : clic **Partagé** sur un dashboard privé → si un widget a un
  `queryId` privé (`isPrivateScopeId`), ouvre `DashboardShareModal` ; sinon `scopeMutation`
  (inchangé). `onChanged` réutilise le code de succès actuel (cache + navigation sur le nouvel id).
- `routes/query.tsx` : sélecteur Privée / Partagée dans `ViewHeader.actions` (avant l'export),
  si `current && !readOnly` ; clic sur l'autre portée → `QueryScopeModal`. `onChanged` :
  `loadedRef.current = updated.id` (l'éditeur n'est pas rechargé : modifications en cours
  conservées) puis `navigate` vers le nouvel id (`replace`).
- `ReorderableSidebarSection.tsx` : prop facultative `onToggleScope?: (item) => void` → bouton au
  survol (icône `Users2` / `Lock` de la portée cible, `title` « Passer en partagée / privée »,
  `data-testid="scope-toggle"`), masqué pour `state.readOnly`. `DashboardPanel.tsx` la passe pour la
  section Requêtes seulement et monte `QueryScopeModal` ; `onChanged` : si la requête est ouverte
  dans `/query`, navigation vers le nouvel id.
- i18n fr / en : clés `suivi.scope.*`.

## 6. Décisions techniques et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Service d'orchestration séparé | Injecter `SavedQueriesService` dans `DashboardsService` | Dépendance circulaire (`SavedQueriesService` dépend déjà de `DashboardsService`) |
| Aperçu calculé dans le main | Calcul dans le renderer à partir des listes | Une seule règle pour l'UI et la vérification avant écriture ; le renderer ne voit pas les dépendants privés des autres dashboards sans relire tous les dashboards |
| Promotions séquentielles, pas de rollback | Rollback | Décision D4 de la spec |
| Pas de verrou entre l'aperçu et l'écriture | Jeton d'aperçu | Le recalcul de l'aperçu dans `shareDashboardWithQueries` suffit (même process) |
| `isPrivateScopeId` déplacé dans `@polenta/types` | Préfixe dupliqué dans le renderer | Une seule convention |

## 7. Sprints

- **S1** — §2, §3, §4 + tests unitaires `suivi-scope.service.test.ts` (aperçus, partage groupé,
  échec partiel, reprise, préférences par dashboard déplacées), `channel-policy.test.ts` vert.
- **S2** — §5, e2e `e2e-web/gh67-scope.spec.ts`, `SPEC-DASHBOARDS.md` §7.0b / §8 / §10,
  `SPEC-INDEX.md`, tutoriel `07-suivi` fr / en.
