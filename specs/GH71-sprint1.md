# GH71 — Sprint 1 : types partagés et main

Design : `specs/GH71-design.md` §7 (sprint 1).

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `packages/types/src/campaign-progress.ts` (nouveau) + `index.ts` | `PREP_PREFIX`, `PROGRESS_READY`, `PROGRESS_RESULTS`, `prepKey`, `prepStatusOf`, `isProgressKey`, `progressSubject`, `entryProgress`, `progressRank`, `prepStatusOrder`, `compareProgressKeys` |
| `packages/types/src/dashboard.ts` | `CAMPAIGN_ENTRY_FIELDS` + `progress`, `progressRank`, `testStatus` ; `WidgetFieldMapping.preset` ; `RowTarget.campaign.progress` |
| `apps/desktop/src/main/services/query-engine.service.ts` | Colonnes d'avancement (`campaignEntryProgress`, schéma du repo de chaque test) ; `resolveRowTarget` : entrée non exécutée → `progress` (repli `status: 'pending'`), ligne de campagne avec `progress` valide → `progress` |
| `apps/desktop/src/main/services/dashboard-seed.service.ts` | Requête/widget « Avancement » sur `progress` + préréglage ; constantes GH65 conservées ; `upgradeCampaignsSeed` ; marqueur `done` avec `queries`, `dashboardId`, `upgrades` |
| `apps/desktop/src/renderer/components/dashboard/QueryBuilder.tsx` | `progressRank` masqué dans le builder |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | Libellés builder `campaignFields.progress` / `testStatus` (avancé du sprint 2 : colonnes visibles dans le builder dès ce sprint) |
| `apps/desktop/src/main/services/campaign-progress.test.ts` (nouveau) | P1–P8 |
| `apps/desktop/src/main/services/query-engine.progress.test.ts` (nouveau) | Q1–Q6, T1–T4 |
| `apps/desktop/src/main/services/dashboard-seed.progress.test.ts` (nouveau) | D1–D8 |
| `apps/desktop/src/main/services/query-engine.drilldown.test.ts` | GH65 2.1 (drill-down du seed sur `progress`) et 2.7 (`progress` au lieu de `status: 'pending'`) |

## Divergences par rapport au design

- **Marqueur de mise à niveau** : liste `upgrades` dans le marqueur `campaignsSeed` existant (store
  injectable, déjà utilisé par les tests) plutôt qu'une nouvelle clé `campaignsSeedUpgrades` du
  `.pref`. Même comportement.
- **Mise à niveau, condition sur le widget** : le widget doit aussi être de type `bar` (un widget
  changé en table ou en camembert est considéré comme personnalisé).
- **Titre de la requête du seed** : « Campagnes — avancement » / « Campaigns — progress » pour un
  seed neuf ; une requête mise à niveau garde son titre.

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 29 fichiers / 309 tests desktop + merge-core OK (dont 26 nouveaux).
- e2e web : **non lancés à ce sprint**. Le renderer ne connaît pas encore le paramètre `progress` :
  depuis la vue Suivi, une entrée non exécutée ouvre la campagne **sans filtre** jusqu'au sprint 2
  (l'e2e GH65 2.4/2.7 attend le filtre ; mise à jour prévue au sprint 2 avec `rowNavigation`).
- `/code-review` : rien sur le diff du sprint. Remarques sur GH68 (déjà mergé), à traiter à part :
  1. la page d'exécution réinitialise la saisie en cours si la copie de l'instance change pendant
     l'exécution (par ex. export Excel lancé par un autre utilisateur) ;
  2. après un export, une nouvelle resynchronisation (ouverture de l'exécution) avant l'import fait
     enregistrer les résultats du classeur contre une version plus récente ;
  3. la resynchronisation ne recalcule pas les paramètres (limite déjà documentée, GH68 §13).
  Le reste porte sur du code GH64/GH65 (performances du moteur de requêtes, seed multi-utilisateur).

## Mises à jour SPEC

Aucune (sprint final : sprint 2).

## Test manuel

Vue Suivi → nouvelle requête SQL :
`SELECT [campaignTitle], [progress], [progressRank], [testStatus], COUNT(*) AS [n] FROM [campaign_entries] GROUP BY [campaignTitle], [progress], [progressRank], [testStatus] ORDER BY [progressRank]`
— une campagne avec des tests brouillon / en revue / approuvés / exécutés donne `prep:draft`,
`prep:review`, `ready`, puis les résultats. Le widget « Avancement par campagne » d'un dashboard
Campagnes existant non modifié bascule sur `progress` à la réouverture de la vue Suivi (rendu des
couleurs et libellés : sprint 2).
