# GH67 — Sprint 2 : confirmations, `/query`, panneau latéral, dashboard (renderer)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `renderer/components/dashboard/ScopeChangeParts.tsx` (nouveau) | cadre et lignes communes des confirmations ; `invalidateAfterScopeChange` ; `noteQueryRenamed` / `queryRenamedFrom` (nouvel id → ancien id) ; `scopeErrorText` |
| `renderer/components/dashboard/QueryScopeModal.tsx` (nouveau) | confirmation de portée d'une requête seule |
| `renderer/components/dashboard/DashboardShareModal.tsx` (nouveau) | confirmation du partage d'un dashboard avec ses requêtes privées |
| `renderer/routes/dashboard.tsx` | *Partagé* : confirmation si un widget a une requête privée, sinon `setScope` direct ; succès commun `onScopeChanged` |
| `renderer/routes/query.tsx` | sélecteur *Privée / Partagée* dans l'en-tête ; nouvel id suivi sans recharger l'éditeur (`queryRenamedFrom`), colonne retirée en rétrogradation |
| `renderer/components/sidebar/ReorderableSidebarSection.tsx` | prop `onToggleScope` : bouton au survol (`scope-toggle`), absent en lecture seule |
| `renderer/components/sidebar/DashboardPanel.tsx` | bouton de portée sur la section Requêtes, confirmation, URL suivie si la requête est ouverte |
| `renderer/i18n/locales/{fr,en}.json` | clés `suiviScope.*` |
| `e2e-web/gh67-scope.spec.ts` (nouveau) | 9 scénarios |
| `specs/SPEC-DASHBOARDS.md`, `specs/SPEC-INDEX.md`, `docs/tutoriels/07-suivi.md`, `docs/tutorials/07-tracking.md` | mises à jour (ci-dessous) |

## Comportement implémenté

Spec §3.1–§3.11 : confirmations avec aperçu du main ; bloquants sans bouton de confirmation ;
fermeture impossible pendant l'écriture ; Entrée confirme, Échap annule ; après un échec partiel,
l'aperçu est relu (ne liste plus que les requêtes restées privées ; bouton « Partager le dashboard »
s'il n'en reste aucune). Changement de portée d'une requête ouverte dans `/query`, depuis la vue ou
le panneau : l'URL suit, l'éditeur est conservé.

## Divergences par rapport au design

- Suivi du nouvel id dans `/query` : registre `noteQueryRenamed` / `queryRenamedFrom` (au lieu de
  `loadedRef` posé par `onScopeChanged`) pour que le changement fait depuis le panneau conserve aussi
  l'éditeur, et pour retrouver la requête sous son ancien id tant que la liste n'est pas relue
  (constats de la revue de code).
- Ligne ajoutée à la confirmation d'une requête : « Seule la version enregistrée change de portée :
  enregistrez d'abord vos modifications en cours » (revue : l'éditeur conservé pouvait laisser croire
  que les modifications non enregistrées étaient partagées).
- `invalidateAfterScopeChange` dans `ScopeChangeParts.tsx` (au lieu de `QueryScopeModal.tsx`).

### Revue de la PR entière (`/code-review medium 316`, 2026-11-07)

Corrigé :
- **Gardes en double** (aperçu / écriture) : `SavedQueriesService.scopeBlockers` devient la source
  unique, utilisée par `setScope` (mêmes erreurs qu'avant : `SUIVI_READ_ONLY`, paramètres, message
  des dépendants) et par l'aperçu de `SuiviScopeService` ; test ajouté.
- **Normalisation des titres** : `normalizeTitle` de `suivi-validation.util` réutilisée (au lieu d'une
  copie en `toLowerCase`).
- **Partage groupé et `/query` ouverte** : la confirmation du dashboard enregistre l'ancien → nouvel
  id de chaque requête promue (`noteQueryRenamed`) ; une vue `/query` restée sur l'ancien id suit le
  nouveau (`queryRenamedTo`).
- **Relais sous l'ancien id** : le sélecteur de portée de `/query` n'est affiché que pour la requête
  relue sous l'id de l'URL (plus de réouverture de la confirmation sur un id disparu).
- **Ancien id du dashboard relu après le partage** : `invalidateAfterScopeChange(…, exceptDashboardId)`
  ne relit plus le dashboard sous l'id qui vient de disparaître.
- **Message brut** du `setScope` direct du dashboard : passe par `scopeErrorText` comme les
  confirmations.
- **Sélecteur dupliqué** : composant `ScopeToggle` commun (dashboard, `/query`).
- **Contrat d'erreur** de `shareWithQueries` précisé dans `api-client/types.ts` (erreur d'origine si
  rien n'a été partagé).

Écarté :
- Registre `renamedQueries` jamais vidé, réutilisation d'un id partagé : non atteignable, un id
  partagé n'est jamais réattribué (pierre tombale à la rétrogradation, GH20) et un id privé est
  aléatoire ; le registre ne vit que le temps de la session de l'onglet.
- Coût de l'aperçu (relecture du `.pref` et des dashboards privés par requête, aperçu recalculé au
  partage) : volumes faibles (seed Campagnes : 6 requêtes) ; le recalcul avant écriture est voulu
  (liste périmée).

Vérifications après ces corrections : `pnpm typecheck` 4/4 ; tests touchés (`suivi-scope`,
`suivi-store`, `suivi-columns`, `suivi-params`, `channel-policy`) 96/96 ; `pnpm test` complet : desktop
1610/1610 (148 fichiers), merge-core 79/79, admin-service 119 + 3 ignorés ; `pnpm build:web` puis e2e
`gh67-scope` + `gh74-editing`, `gh74-suivi`, `gh93-params`, `gh70-query-column`, `gh65-campaigns` :
32/32 (ports 8950–8953).

## Mises à jour SPEC

- `SPEC-DASHBOARDS.md` en-tête : GH67. §7.0b : rétrogradation bloquée par tout widget dépendant
  (comportement du service, la spec disait « widgets partagés »), colonne retirée, portée invalide
  refusée, point unique `moveDashboardKeys`, paragraphe « Changement de portée depuis l'app ». §8 :
  bouton de portée des requêtes. §10 : MCP (partage groupé compris), hors scope GH67.
- `SPEC-INDEX.md` : lignes §7 et §8–§10, MAJ → GH67.
- Tutoriels fr / en : partage de *Campagnes* avec ses requêtes, portée d'une requête.

## Vérifications

- `pnpm typecheck` : 4/4 tâches vertes. `pnpm lint` : aucune tâche lint dans le monorepo.
- Unitaires : `vitest run` desktop 148/148 fichiers verts (les autres paquets verts) ; l'échec de
  délai `sync.service.gh173 U4` vu au sprint 1 ne s'est pas reproduit.
- e2e (`pnpm build:web`, ports 8950–8953) : `gh67-scope.spec.ts` 9/9 ; voisines `gh74-editing`,
  `gh74-suivi`, `gh93-params`, `gh70-query-column`, `gh65-campaigns` : vertes (31/32 au premier
  passage, l'échec était N7b — Entrée pressée avant le chargement de l'aperçu, test corrigé ;
  relance 9/9).
- `/code-review` (medium) sur le diff du worktree : constats corrigés (voir divergences ; Annuler
  désactivé pendant l'écriture ; focus rendu par les boutons de portée ; libellés pour 0 requête).
  Non retenu : un widget sur une requête **partagée** supprimée n'est pas signalé au partage (hors
  du périmètre de la spec, comportement antérieur).
- Non lancé : suite e2e complète (niveau 3, après le « Validé »), `test:e2e:desktop`.

## Comment tester manuellement

1. Suivi → dashboard privé *Campagnes* → **Partagé** : la confirmation liste 6 requêtes ; Annuler,
   puis Partager ; l'URL passe sur `DASHBOARD-NNNN`, les 6 widgets s'affichent comme avant.
2. Suivi → une requête privée → en-tête **Partagée** : confirmation, puis URL `QUERY-NNNN`.
3. Panneau, survol d'une requête : bouton de portée ; requête partagée utilisée par un widget →
   **Privée** : bloqué, widgets listés.
4. En anglais : mêmes écrans (libellés).
5. Desktop Electron : parcours 1 et 2.

## Merge de `main` (GH125, merge 72ac5e5) — 2026-11-07

Conflits :
- `apps/desktop/src/main/services/dashboards.service.ts` : import (`ScopeWidgetRef` de GH67 +
  `WidgetParamValues` de GH125) ; `renameInOrder` (GH125, déplaçait `suiviWidgetParamValues`) contre
  `moveDashboardUserState` (GH67) → gardé `moveDashboardUserState`, et `moveDashboardKeys` déplace
  désormais `suiviWidgetParamValues` (dashboard → widget → `name:kind`) au lieu de `suiviParamValues`
  (clé GH93 abandonnée par GH125, plus lue : non déplacée).
- `specs/SPEC-INDEX.md` : lignes SPEC-DASHBOARDS de GH125 reprises, ajouts GH67 réappliqués aux
  lignes §7 et §8–§10 (MAJ → GH67).

Ajustements : test N9 réécrit (valeurs de deux widgets conservées sous le nouvel id, valeurs d'un
autre dashboard intactes) ; `SPEC-DASHBOARDS.md` §7.0b et `specs/GH67.md` §3.9 mentionnent
`suiviWidgetParamValues`. Les confirmations ne parlent pas de barre de paramètres (vérifié dans les
libellés `suiviScope.*`).

Vérifications après le merge : `pnpm typecheck` 4/4 ; tests touchés (`suivi-scope`, `suivi-params`,
`suivi-store`) 71/71 ; `pnpm test` complet : desktop 1617/1621 — 4 échecs par dépassement de délai
(20–25 s) dans `sync.service.gh173`, `forge/repo-adoption.gh107`, `forge/repo-settings.gh108`
(fichiers non touchés par GH67 ni GH125), verts relancés seuls (63/63) ; `pnpm build:web` puis e2e
`gh67-scope`, `gh125-widget-params`, `gh93-params`, `gh74-editing`, `gh74-suivi`,
`gh70-query-column`, `gh65-campaigns` : 36/36 (ports 8950–8953).
