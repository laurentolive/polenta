# GH65 — Sprint 1 : données et temps réel

Spec : [GH65.md](GH65.md) · Design : [GH65-design.md](GH65-design.md) · Tests : [GH65-tests.md](GH65-tests.md)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/dashboard.ts` | `CAMPAIGN_ENTRY_FIELDS`, `CampaignEntryField`, `CAMPAIGN_FIELD_PREFIX` (partagés main / renderer) |
| `packages/types/src/schema.ts` | `ProjectPreferences.autoPullIntervalMinutes` |
| `packages/api-client/src/{ipc-client,types}.ts` | `dashboards.list(repoPath, username, locale?)` |
| `apps/desktop/src/main/services/query-engine.service.ts` | table `campaign_entries`, allowlist builder des types `campaign`, lecture tolérante des campagnes, construction du dataset mutualisée entre appels simultanés |
| `apps/desktop/src/main/services/schema-lookup.util.ts` | réexport des colonnes de campagne |
| `apps/desktop/src/main/services/saved-queries.service.ts` | purge de l'historique : allowlist propre aux types de campagne |
| `apps/desktop/src/main/services/dashboard-seed.service.ts` | seed « Campagnes » privé, à reprise, non bloquant, libellés fr/en |
| `apps/desktop/src/main/container.ts`, `mcp-server/container.ts` | `CampaignsService` injecté dans le moteur de requêtes |
| `apps/desktop/src/main/ipc/index.ts` | `dashboards:list` reçoit `locale` |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts` | `run_query` cite `campaign_entries` |
| `apps/desktop/src/renderer/hooks/useLiveFileSync.ts` | invalidation de `widget-query-result` sur tout changement de données / de ref, dans n'importe quel repo |
| `apps/desktop/src/renderer/hooks/useAutoPull.ts`, `renderer/lib/autoPullInterval.ts` | intervalle lu dans le schéma du repo racine, minuteur réarmé au changement |
| `apps/desktop/src/renderer/routes/preferences.tsx` | réglage « Intervalle de récupération automatique » |
| `apps/desktop/src/renderer/components/dashboard/QueryBuilder.tsx` | types de campagne proposés « (entrées) », colonnes de campagne |
| `apps/desktop/src/renderer/components/sidebar/DashboardPanel.tsx`, `routes/dashboard.tsx` | langue transmise à `dashboards:list` |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | libellés |
| Tests | `query-engine.campaigns.test.ts` (14), `dashboard-seed.campaigns.test.ts` (8), `autoPullInterval.test.ts` (2), `e2e-web/gh65-campaigns.spec.ts` (3) |

## Comportement implémenté

- **`campaign_entries`** : une ligne par entrée de campagne (dernier état), toutes campagnes du
  workspace. Colonnes de la spec + `objectTypeRef` (doublon de `campaignObjectTypeRef`, pour le
  builder) ; champs perso préfixés `campaign_`. Une campagne YAML illisible est ignorée (avertissement
  journalisé) au lieu de faire échouer toutes les requêtes.
- **Builder** : un type `campaign` du schéma apparaît « <type> (entrées) ». Non proposées dans le
  builder (restent en SQL) : `executed` (booléen, incomparable avec la saisie texte du builder —
  `status ≠ pending` suffit), `objectTypeRef`, `campaignObjectTypeRef`, `runId`.
- **Dashboard « Campagnes »** : 5 widgets (avancement empilé, % exécuté, % PASS, exécutions par jour,
  entrées en échec), requêtes SQL. **Privé, par utilisateur** (voir divergences). Les KPI rendent
  zéro ligne (état vide) quand il n'y a rien à mesurer.
- **Temps réel** : tout résultat de widget est invalidé sur un changement `requirements/`, `tests/`,
  `links/`, `campaigns/` ou de ref, quel que soit le repo — couvre l'avance rapide du pull auto, une
  saisie locale et les repos composants. Les widgets qui se rafraîchissent ensemble partagent une
  seule construction du dataset.
- **Intervalle de pull** : `preferences.autoPullIntervalMinutes` (entier 1–60, défaut 5) ; clé omise
  du `schema.yaml` à la valeur par défaut ; message « hors ligne » avec la valeur effective.

## Divergences par rapport au design

1. **Seed « Campagnes » privé** au lieu de partagé (revue de code + décision utilisateur) : un seed
   partagé automatique sur un projet existant aurait été créé par chaque membre de l'équipe sur son
   clone (doublons, conflits add/add sur `queries/` et `dashboards/`) et ses fichiers non publiés
   auraient rendu le repo « sale », bloquant le pull automatique. Dashboard et requêtes vivent dans
   le `.{user}.pref` (ignoré par git), le marqueur aussi (clé `campaignsSeed`). Pour le partager :
   passer les 5 requêtes en partagé puis le dashboard (règle SPEC-DASHBOARDS §3.1). Spec, design et
   scénarios mis à jour en conséquence.
2. Échec du seed **non bloquant** (journalisé) — `dashboards:list` aboutit toujours.
3. `executed` retiré du builder (voir ci-dessus).
4. Construction du dataset mutualisée (`inFlightDatasets`) — ajout de revue, rien n'est mis en cache
   après résolution.

Points de revue **non retenus** : `executedDay` en UTC (décision validée en design) ; coût d'un
rafraîchissement par saisie (atténué par la mutualisation ; pas d'index des campagnes tant que non
mesuré lent).

## Mises à jour SPEC

Aucune (sprint non final — prévues au sprint 2).

## Vérifications

- `pnpm typecheck` : 0 erreur. Pas de tâche lint configurée.
- `pnpm test` : desktop 196/196, merge-core 34/34.
- `pnpm test:e2e:web` : 31 passés, 13 ignorés (suites déploiement), dont `gh65-campaigns` 3/3.

## Tester manuellement

1. Ouvrir un projet avec des campagnes, onglet **Suivi** : un dashboard **Campagnes** (cadenas,
   privé) apparaît ; `git status` du repo inchangé.
2. Ouvrir le dashboard, exécuter un test d'une campagne en cours dans un autre onglet : les widgets se
   mettent à jour sans action.
3. Vue Requêtes, builder : choisir « <type de campagne> (entrées) », grouper par « Statut de
   l'entrée ».
4. SQL : `SELECT * FROM campaign_entries`.
5. **Préférences projet** : intervalle à 1 min, enregistrer → `schema.yaml` contient
   `autoPullIntervalMinutes: 1`. Sur deux postes : B saisit un résultat et publie ; au plus 1 min
   plus tard, le dashboard de A (sans modification en cours) est à jour (scénarios 1.11–1.14).
6. Partage : passer les 5 requêtes « Campagnes… » en partagé, puis le dashboard.
