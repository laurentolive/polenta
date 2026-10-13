# GH74 — Sprint 1 : moteur (graphe, bac à sable, bibliothèque de départ)

Périmètre (`specs/GH74-design.md` §9, sprint 1) : **additif**, aucune UI changée. Le moteur SQL reste
en place jusqu'au sprint 2.

## Fichiers

### Nouveaux

| Fichier | Rôle |
|---|---|
| `packages/types/src/graph.ts` | Contrat de données v1 (`PolentaGraph`, `PolentaHost`, `GraphRow`…) ; ses JSDoc sont la documentation du contrat |
| `packages/types/src/script.ts` | Types d'exécution (`ScriptError`, `ScriptRunResult`…), `validateRows`, `inferColumns`, `parseContractHeader`, `buildHost`, tables de fuseau (`timezoneOffsets`) |
| `apps/desktop/src/main/services/graph.service.ts` | `GraphService` : construction du graphe, cache invalidable, `describeIds`, `resolveTarget` |
| `…/script-limits.ts` | Limites par défaut et types du bac à sable, sans QuickJS (importables par le main) |
| `…/script-sandbox.ts` | QuickJS : module à mémoire wasm plafonnée, contexte préparé (graphe gelé, bibliothèque préchargée et gelée, contexte durci), exécution script / transformation, erreurs localisées |
| `…/script-worker.ts` | Point d'entrée `worker_threads` : contextes en LRU (2), éviction des contextes périmés d'un workspace, recréation du module après dépassement mémoire / pile |
| `…/script-engine.service.ts` | `ScriptEngineService` : worker, file FIFO, chien de garde, partage d'un script entre widgets, budget de temps script + transformation |
| `…/dashboard-library.service.ts` | `DashboardLibraryService` : modules `dashboards/lib/` du repo ouvert (`lib/…`) et des composants (`<comp>::lib/…`), manifeste et fichiers livrés, `contentHash` |
| `…/mcp-server/tools/suivi-script.tools.ts` | Outils MCP `get_data_contract`, `test_script`, `list_library`, `read_library_module`, `write_library_module` |
| `apps/desktop/resources/dashboard-lib/` | Bibliothèque de départ : `time.js`, `status.js`, `history.js`, `campaign.js`, `maturity.js`, `polenta.d.ts` (généré), `jsconfig.json`, `manifest.json` |
| `apps/desktop/scripts/generate-graph-dts.ts` | `graph.ts` → `polenta.d.ts` (`--check`) |
| `apps/desktop/scripts/dashboard-lib-manifest.ts` | Versions / empreintes livrées (`--bump`, `--check`) |
| `apps/desktop/scripts/script-worker-build.ts` | Bundle autonome du worker + copie du `.wasm` (plugin electron-vite, builds web et MCP) |
| Tests : `script-sandbox.test.ts`, `script-engine.test.ts`, `graph.service.test.ts`, `dashboard-lib.test.ts`, `dashboard-library.service.test.ts`, `graph-fixture.test-util.ts` | 66 tests GH74 |

### Modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/campaign.ts`, `index.ts` | `RUN_STATUS_SEVERITY` (déplacé du renderer), `RUN_STATUS_ORDER` ; exports `graph` / `script` |
| `renderer/lib/runStatus.ts` | réexporte `RUN_STATUS_SEVERITY` de `@polenta/types` |
| `main/services/campaigns.service.ts` | `isResyncable` exporté (indicateur `resyncable` du graphe) |
| `main/container.ts`, `main/ipc/index.ts` (type `Container`) | `graph`, `dashboardLibrary`, `scriptEngine` ; invalidation par le watcher (`requirements/`, `tests/`, `test-runs/`, `links/`, `campaigns/`, `.polenta/`, `polenta-repo.yaml`, `dashboards/lib/`, changement de ref) |
| `mcp-server/container.ts`, `mcp-server/index.ts` | mêmes services (graphe **sans cache**) ; enregistrement des outils |
| `main/services/suivi-validation.util.ts` | codes `SCRIPT_ERROR`, `LIBRARY_PATH_INVALID`, `LIBRARY_MODULE_NOT_FOUND` |
| `main/services/agents-md.template.ts` | AGENTS.md : nouveaux outils |
| `electron.vite.config.ts`, `scripts/build-mcp-server.ts`, `scripts/build-web-server.ts` | worker + `.wasm` à côté de chaque bundle ; bibliothèque de départ copiée à côté du MCP |
| `electron-builder.config.ts` | `asarUnpack` du worker et du `.wasm` ; `extraResources` `dashboard-lib` |
| `apps/desktop/package.json` | `quickjs-emscripten-core`, `@jitl/quickjs-wasmfile-release-sync` (0.32.0) |

## Comportement implémenté

- **Graphe** : repos, composants (nœuds locaux compris, libellés), schéma (types par
  (repo, ref), champs avec `validator`, statuts, `entryStatuses` ordre / gravité / libellés fr-en,
  `campaignStatuses`), exigences et tests (historique effectif GH77 avec entrées implicites,
  `needsRevalidation`, `coverageStatus` sur l'agrégat), liens, campagnes (entrées actives / retirées,
  `snapshot` réduit, `resyncable`), toutes les exécutions. Pas de `steps` / pré- / postconditions.
  Mis en cache par (repo, workspace, langue, date de l'arbre du workspace), invalidé par le watcher ;
  sans cache dans le serveur MCP.
- **Bac à sable** : globaux de l'hôte absents ; imports limités à `lib/…`, `<comp>::lib/…` et aux
  chemins relatifs internes à un `lib/` ; données, exports de bibliothèque, intrinsèques et objet
  global gelés ; limites 64 Mo / wasm 128 Mo / 2 s / pile 256 Ko ; erreurs `kind` + fichier + ligne
  (`script.js`, `<widgetId>.js`, `lib/…`), messages dédiés (async, export par défaut, sortie
  invalide, contrat > v1).
- **Moteur** : un worker par process (desktop, serveur web, MCP), hors du thread principal (vérifié :
  l'hôte reste réactif pendant une boucle infinie), chien de garde (worker muet remplacé),
  contexte préparé réutilisé, un script partagé par plusieurs widgets exécuté une fois.
- **Bibliothèque de départ** : `campaignsTimeline` / `campaignTimeline` (balayage unique, repli GH73
  §6.2 marqué `approximate`, drill-down par `polenta.drill`), `entryRuns`, `entryStep` / `stepRank` /
  `stepLabel` (ex-GH71), `lastResult(s)`, `valueAt` / `timeline`, `maturity` (ex-T77), `dayOf` /
  `dayEnd` / `dayRange`, `worst` / `typeIndex` / `isApproval`.
  **Équivalence vérifiée** avec l'ancien calcul (moteur SQL, mêmes données) : étapes GH71 et
  maturité T77 identiques (L1, L2).
- **MCP** : `get_data_contract`, `test_script`, `list_library`, `read_library_module`,
  `write_library_module` (dryRun par défaut, chemin contrôlé, branche en lecture seule refusée).
  Vérifié sur le serveur compilé, en stdio, sur le jeu de démo.

## Divergences par rapport au design

| Design | Implémenté | Raison |
|---|---|---|
| `PolentaHost` : `locale`, `timezone`, `today`, `contractVersion`, `drill` | + `now`, + `timezoneOffsets` | QuickJS n'a pas `Intl` et l'heure locale de `Date` est celle du serveur : le découpage par jour se fait avec la table des décalages fournie par l'hôte (`lib/time.js`). `now` : sorties reproductibles. Ajout au contrat v1 (documenté dans `graph.ts`) |
| Bibliothèque : `status`, `history`, `campaign`, `maturity` | + `time.js` | conséquence de la ligne précédente |
| `entryStep(data, campaign, entry)` | `entryStep(data, entry, ctx?)` | `resyncable` est déjà dans l'entrée ; `ctx` (index) évite de recalculer par entrée |
| Worker : 2ᵉ entrée electron-vite | bundle esbuild autonome (plugin `closeBundle`) | une entrée rollup partage ses chunks avec le main ; le worker doit être un seul fichier chargé hors asar. Le paquet wasm doit être résolu en CommonJS (`import.meta.url` indéfini sinon) |
| — | Modules de bibliothèque préchargés et gelés à la préparation | revue de code : un script pouvait modifier un export partagé par les exécutions suivantes (et entre utilisateurs sur le serveur web) |
| — | `lib/x.js` importé depuis `<comp>::lib/…` = bibliothèque du composant | revue de code : un composant doit fonctionner de la même façon ouvert seul ou depuis le produit |
| Types `DescribedObject` / `RowTarget` dans `dashboard.ts` | `DescribedObject` / `GraphTarget` dans `graph.service.ts` | `dashboard.ts` est réécrit au sprint 2 ; l'ancien `RowTarget` sert encore au moteur SQL |
| Noms du contrat | préfixe `Graph*` (`GraphCoverageStatus`, `GraphEntryStatus`, `GraphRow`…) ; alias courts `Row`, `EntryStatus`, `RunResult` dans `polenta.d.ts` | collisions avec des types existants de `@polenta/types` |

## Revue de code

`/code-review` (medium) sur le diff du sprint : 10 constats, tous corrigés et couverts par un test
quand c'était possible — exports de bibliothèque modifiables (préchargement + gel), budget de la
transformation qui décomptait la préparation (durée d'exécution renvoyée par le worker), contexte
périmé gardé en mémoire (éviction par workspace), import absolu depuis un composant, module en
erreur après interruption (préchargement à la préparation), arbre du workspace non suivi par les
caches (date de `tree.cache.yaml` + `polenta-repo.yaml`), erreur de lecture levée au lieu d'être
renvoyée, lectures git des campagnes en série, limites codées en dur dans le contrat MCP,
commentaires citant des tests inexistants.

## Tests

- `pnpm test` : 598 tests (dont 66 GH74), tous verts. `tsc --noEmit` sans erreur.
- Builds : `electron-vite build`, `build:mcp-server`, `build:web-server` — worker, `.wasm` (et
  bibliothèque pour le MCP) présents à côté de chaque bundle ; QuickJS absent du bundle main.
- Scénarios couverts (GH74-tests.md) : G1–G12, S1–S8, S10–S18 (S9 : réactivité de l'hôte mesurée),
  L1–L11, M1, M2, M7.
- e2e web (`test:e2e:web`) : 88 passés, 13 ignorés (aucune régression ; pas de scénario GH74 en e2e à ce sprint, sans UI).

## Comment tester manuellement

Rien n'est visible dans l'interface à ce sprint. Avec un client MCP (Claude Code) sur un projet :

1. `get_data_contract` → types du graphe et conventions.
2. `test_script` avec :
   ```js
   export default (data, polenta) => data.campaigns.map((c) => ({ id: c.id, statut: c.status, entrées: c.entries.length, _ids: [c.id] }))
   ```
   → une ligne par campagne.
3. `write_library_module` (`dryRun: false`) avec le contenu de `resources/dashboard-lib/time.js`
   et `campaign.js` / `status.js`, puis `test_script` :
   ```js
   import { campaignsTimeline } from 'lib/campaign.js'
   export default (data, polenta) => campaignsTimeline(data, { polenta }).filter((r) => r.count > 0)
   ```
   → état des campagnes jour par jour.
4. Un script `export default () => { for (;;) {} }` → erreur « Délai dépassé » en ~2 s.

**À vérifier au packaging** (non testé dans ce sprint) : chargement du worker depuis
`app.asar.unpacked` dans l'application installée.
