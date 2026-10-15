# GH74 — Sprint 2 : modèles, format v1, bascule du moteur

Périmètre (`specs/GH74-design.md` §9, sprint 2) : retrait du moteur SQL. La vue Suivi passe aux
scripts de données (bac à sable du sprint 1), aux modèles et au rendu Vega-Lite. Renderer
**minimal** : fonctionnel, l'expérience d'édition complète est au sprint 3.

## Fichiers

### Nouveaux

| Fichier | Rôle |
|---|---|
| `packages/types/src/suivi-templates.ts` | Modèles : 3 de requête (`filtered-list`, `campaign-entries`, `campaign-timeline`), 7 de widget (`bar`, `pie`, `line`, `kpi`, `table`, `matrix`, `stacked-area`) ; génération de code, `contentHash`, catalogue (`describeTemplates`) |
| `packages/types/src/suivi-format.ts` | Format v1 (`StoredQuery` / `StoredDashboard`) et migrations à la lecture : builder → `filtered-list`, SQL → `legacy-sql`, widgets historiques → modèles, `formatVersion` > 1 → `newer-format` |
| `main/services/suivi-store.util.ts` | Stockage commun requêtes / dashboards : dossiers v1, `.pref`, `state` (lecture seule, personnalisé), application des modèles, pierres tombales |
| `main/services/suivi.service.ts` | `SuiviService` : `run` (script, requête ou widget + transformation), `describeIds`, `resolveTarget`, catalogue, `renderTemplate`, types d'objet |
| `mcp-server/spec-compile.ts`, `vega-compile.ts` | Validation des specs Vega-Lite dans le MCP (bundle ESM séparé `vega-compile.mjs`) |
| `renderer/hooks/useScriptRun.ts`, `useSuiviCatalog.ts` | Exécution script / widget (cache React Query, invalidé par le watcher), catalogue des modèles |
| `renderer/components/dashboard/VegaView.tsx`, `vegaTheme.ts` | Rendu Vega-Lite (`ast` + interpréteur, compatible CSP, rendu SVG), `var(--token)` résolus depuis le thème |
| `renderer/components/dashboard/CodeEditor.tsx`, `TemplateForm.tsx` | Éditeur JS / JSON (CodeMirror), formulaire générique des paramètres d'un modèle |
| `renderer/components/dashboard/widgets/WidgetRenderer.tsx` | Réécrit : Vega + vues natives KPI / table (`usermeta.polenta.view`) |
| `main/services/fixtures/gh74-legacy-reference.json` | Sorties figées de l'ancien moteur (tests d'équivalence conservés après son retrait) |
| `main/services/suivi-store.test.ts` | 21 tests : stockage v1, migrations, lecture seule, changement de portée, mise à niveau des seeds d'avant GH74 |

### Supprimés

`query-engine.service.ts` et ses tests, `QueryBuilder`, `SqlEditor`, widgets recharts
(`Bar/Kpi/Line/Pie/Table/MatrixWidget`, `matrix.ts`, `drilldown.ts`, `chartColors.ts`),
`useQueryResult`, tests matrice / preset de `suivi-validation`, `dashboard-seed.progress.test.ts`.
Dépendances `alasql`, `recharts`. `maturity.util.ts` → `field-checks.util.ts` (`isFilled`,
`isEarsCompliant` seulement).

### Modifiés (principaux)

| Fichier | Changement |
|---|---|
| `packages/types/src/dashboard.ts` | `SavedQuery { script, template?, legacySql?, state }`, `Widget { transform?, spec, template?, state }`, `QueryResult`, `DescribedObject`, `RowTarget` (dont `campaign-entry`) |
| `saved-queries.service.ts`, `dashboards.service.ts` | Format v1 ; `getWidget` ne lit qu'un widget ; garde lecture seule à l'écriture ; `setScope` écrit la copie avant de retirer l'original |
| `dashboard-seed.service.ts` | Seeds Status / Campagnes construits par modèles ; **mise à niveau des seeds SQL d'avant GH74** (voir divergences) |
| `ipc/index.ts`, `channel-policy.ts`, `api-client` | `suivi:run`, `suivi:describe-ids`, `suivi:resolve-target`, `suivi:templates`, `suivi:render-template`, `suivi:object-types` ; retirés : `queries:execute`, `queries:drill-down`, `queries:resolve-row-target`, `queries:builder-to-sql` |
| `mcp-server/tools/queries.tools.ts`, `dashboards.tools.ts`, `suivi-common.ts` | Réécrits : script ou modèle, aperçu par le bac à sable, validation de spec, lecture seule respectée |
| `ipc/index.ts` (`withGraphInvalidation`) | Oubli immédiat du graphe après un channel d'écriture (exigences, tests, campagnes, schéma, sync…) : le watcher n'oublie qu'après stabilisation (≥ 300 ms), un `suivi:run` juste après une écriture voyait l'état précédent (trouvé par l'e2e GH65 1.1) |
| `id-counter.util.ts` | IDs déduits aussi des dossiers `<PREFIX>-NNNN/`, `deleteFolderWithTombstone` |
| `DashboardGrid`, `DrillDownModal`, `ResultTable`, `WidgetConfigModal`, `routes/query.tsx`, `routes/dashboard.tsx`, `print.dashboard.tsx` | Passage aux scripts / Vega, drill-down par `_ids`, bandeaux lecture seule, affichage `legacySql` |
| `export/query-result.xlsx.ts`, `template-data-campaign.ts` | Colonne `_ids` ; type de widget = id du modèle ou `custom` |

## Comportement implémenté

- **Stockage** :
  - `queries/QUERY-NNNN/{query.yaml, script.js}` ;
  - `dashboards/DASHBOARD-NNNN/{dashboard.yaml, <wid>.js, <wid>.vl.json}` ;
  - objets privés dans `.{user}.pref`.
  - Les anciens fichiers (`QUERY-NNNN.yaml`, `DASHBOARD-NNNN.yaml`) sont convertis à la lecture et remplacés par leur dossier à la prochaine écriture.
- **Lecture seule** :
  - une requête SQL passe en `legacy-sql` : son SQL est affiché, elle n'est pas exécutable, elle est à réécrire en script ou à supprimer ;
  - un builder qui utilise une colonne retirée par GH74 (`progress`, `maturity*`…) passe aussi en `legacy-sql` ;
  - `formatVersion` > 1 passe en `newer-format` ;
  - toute écriture sur un objet en lecture seule est refusée (`SUIVI_READ_ONLY`).
- **Modèles** : le code est généré à partir des paramètres et le `contentHash` du code généré est mémorisé. Si le code ne correspond plus à cette empreinte, le widget est `customized` : il est détaché du modèle et son code n'est plus régénéré.
- **Rendu** : Vega-Lite (rendu SVG) ; KPI et table sont rendus nativement.
- **Drill-down** : un clic ouvre les objets du `_ids` de la donnée cliquée. Si la donnée n'a pas de `_ids`, le script est relancé avec `polenta.drill` égal aux colonnes scalaires de la ligne cliquée (hors bornes d'empilement Vega). Une entrée de campagne ouvre son résultat d'exécution, ou la campagne filtrée par son statut.
- **MCP** :
  - les outils requêtes / widgets acceptent un script ou un modèle ;
  - chaque enregistrement passe d'abord par un aperçu dans le bac à sable ;
  - les specs Vega-Lite sont validées par compilation.
- **Équivalence avec l'ancien moteur** :
  - vérifiée par les références figées (`entryStep`, `maturity`) ;
  - les 12 cas de builder convertis en `filtered-list` donnent les mêmes lignes (T2).

## Divergences par rapport au design

| Design | Implémenté | Raison |
|---|---|---|
| Réécriture des seeds existants : sprint 3 | **Avancée au sprint 2** (`upgradeLegacySeeds`) | Sans elle, les dashboards Status / Campagnes des projets existants resteraient inutilisables (SQL) entre les sprints 2 et 3. Seul le SQL **exact** d'un seed est reconnu ; seuls les widgets restés intacts sont réécrits ; les requêtes partagées ne sont jamais réécrites sur une branche en lecture seule |
| Rendu Vega : canvas | SVG partout | Libellés accessibles (`aria-label` par marque) ciblables par les e2e ; impression identique à l'écran |
| Matrice : en-têtes cliquables (GH69 N11/N12) | Non cliquables | Les en-têtes sont des axes Vega ; les cellules gardent le drill-down |
| Transformation de la matrice | Sans import de bibliothèque, gravité en ligne | Le modèle doit fonctionner dans un projet sans `dashboards/lib/` |
| KPI ratio : `_ids` | `_ids` = lignes satisfaisant le numérateur | Le drill-down de « % exécuté » liste les entrées exécutées (GH65 2.4) |
| e2e GH71 W1/W2/N1 (étapes du widget du seed) | `test.skip` jusqu'au sprint 3 | Le widget du seed affiche les statuts bruts des entrées ; les étapes reviennent au sprint 3 via `lib/campaign.js` (`entryStep`) |

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 552 tests desktop et 38 tests merge-core, tous verts.
  - Un run intermédiaire a eu un échec isolé de `oidc.test.ts` S3-1/S3-2 (passe seul 14/14, non lié à GH74, sensible à la charge).
- `/code-review` : 10 constats, tous corrigés :
  - clé de cache périmée ;
  - impression en attente infinie ;
  - ordre de `setScope` ;
  - seeds d'avant GH74 ;
  - colonnes de drill-down trop larges ;
  - builder utilisant des colonnes retirées ;
  - lecture seule ignorée par le MCP ;
  - lectures quadratiques ;
  - modèle perdu au changement d'onglet ;
  - duplication.
- e2e web : specs adaptées à GH74 :
  - `gh65-navigation` réécrite : barres Vega, `drilldown-objects`, requête SQL en lecture seule ;
  - `gh69-matrix` réécrite pour le modèle « Matrice » ;
  - `gh65-campaigns` 1.1/1.7, `gh73` 3.11 et `parity` P-2 adaptées (`suivi:run`, formulaire de modèle) ;
  - `gh71` W1 désactivée (`test.skip`).
  - Run complet : **84 passés, 14 ignorés, 0 échec**.

## Reste pour les sprints suivants

- **Projet de démo (`demo-lave-linge`, hors de ce repo)** : ses dashboards (« Pilotage LL800 »,
  « Composants & traçabilité ») reposent sur des requêtes SQL utilisateur, pas sur des seeds. Elles
  apparaissent maintenant comme « Requête SQL non prise en charge ». Il faut les réécrire dans le
  repo de démo (scripts ou modèles), au plus tard pour le corpus du sprint 4.
- Sprint 3 :
  - expérience d'édition complète (aperçu, retour au modèle, historique, xlsx) ;
  - seed de la bibliothèque et widget « Avancement dans le temps » ;
  - bandeau des mises à jour ;
  - statuts bruts sur la page campagne, retrait de `campaign-progress.ts` / `campaignProgress.ts` / `progressPresentation.ts` ;
  - export docx.
