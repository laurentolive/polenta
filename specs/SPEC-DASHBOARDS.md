# SPEC-DASHBOARDS — Module Dashboards & Requêtes (vue Suivi)

> Référence parent : [SPEC.md](../SPEC.md) §2.7
> Dépend de : [SPEC-TECH-stack.md](SPEC-TECH-stack.md) §1.1/§2, [SPEC-TRACEABILITY.md](SPEC-TRACEABILITY.md), [SPEC-REQ-requirements.md](SPEC-REQ-requirements.md)
> Introduit par T77 (sprints 1–3) ; réécrit par GH74 (graphe de données JSON, scripts JS isolés, rendu Vega-Lite) ;
> paramètres choisis à l'affichage : GH93 (§5.1) ; colonnes calculées de la Vue Système : GH70 (§5.2)

---

## 1. Vue d'ensemble

Dashboards personnalisables construits sur des **scripts de données** : un script JavaScript lit le
**graphe de données** du projet (§2) et renvoie des lignes ; un **widget** transforme ces lignes
(transformation JS facultative) et les rend avec une **spec Vega-Lite**. Un client non technique
n'écrit pas de code : des **modèles** (§5) génèrent script, transformation et spec à partir d'un
formulaire. Une requête peut déclarer des **paramètres choisis à l'affichage** (§5.1) : le dashboard
affiche une barre de sélecteurs (ex. une campagne) et le script lit les valeurs dans `polenta.params`.

Trois entités, chacune privée ou partagée : **Requête** (`SavedQuery` — un script de données),
**Widget** (dans un Dashboard), **Dashboard**.

Onglet `ActivityBar` « Suivi » : panneau latéral (bandeau des mises à jour, sections Dashboards /
Requêtes, §8), vues `/query` (éditeur, résultat, sauvegarde, historique, export) et `/dashboard`.

Principe « données brutes » (SPEC-TECH-stack §1.1, GH79) : Polenta expose les faits (objets,
champs, liens, campagnes, exécutions, historiques) ; les **indicateurs de suivi** (maturité, étapes
d'avancement, état d'une campagne à une date…) sont calculés par les scripts et la **bibliothèque
projet** (`dashboards/lib/`, §4), contenu du repo du client.

---

## 2. Graphe de données (contrat v1)

Contrat : `packages/types/src/graph.ts` (`PolentaGraph`, `PolentaHost`, `GraphRow`) — ses JSDoc
sont la documentation de référence ; `polenta.d.ts` (copié dans `dashboards/lib/`) en est généré
(`scripts/generate-graph-dts.ts`, vérifié par `pnpm test`).

- **Contenu** : `repos` (repo ouvert + composants), `components` (nœuds locaux des schémas et repos
  composants), `schema` (types par (repo, `objectTypeRef`) avec champs, `validator`, statuts et
  `isApproval` ; types de liens ; `entryStatuses` ordre / gravité / libellés ; `campaignStatuses`),
  `requirements` et `tests` (champs, historique effectif GH77 avec entrées implicites,
  `needsRevalidation`, `coverageStatus` sur les exigences, dates et auteurs tirés de git),
  `links`, `campaigns` (entrées actives et retirées, copie figée `snapshot` réduite, `resyncable`),
  `runs` (toutes les exécutions). Pas d'étapes de test ni de pré- / postconditions.
- **`coverageStatus`** : `TraceabilityService.computeCoverage()` sur le graphe de liens agrégé de
  tous les repos du périmètre — identique à la matrice de traçabilité (SPEC-TRACEABILITY §2.2).
- **Hôte** (`polenta`, second argument, gelé) : `locale`, `timezone`, `timezoneOffsets` (le moteur
  n'a pas `Intl` : découpage par jour avec `lib/time.js`), `today`, `now`, `drill` (§6), `params`
  (valeurs des paramètres déclarés par la requête, `{}` sans paramètre — §5.1, GH93).
- **Versionnement** : `contractVersion` majeur ; un script peut déclarer `// @polenta contract 1` ;
  contrat plus récent que celui servi → erreur explicite.
- **Cache** (`GraphService`) : par (repo, workspace, langue, arbre du workspace) ; oublié par le
  watcher (`requirements/`, `tests/`, `test-runs/`, `links/`, `campaigns/`, `.polenta/`,
  `polenta-repo.yaml`, changement de ref) et **immédiatement** après tout canal IPC d'écriture du
  périmètre (`withGraphInvalidation`, `main/ipc/index.ts`) — le watcher attend la stabilisation des
  fichiers. Sans cache dans le serveur MCP.

---

> **GH195 (contrat v1, ajout)** — type de champ `link` : valeur `GraphLinkValue` `{ label?, url }` ou liste (`GraphFieldDef.multiple`) ; `GraphFieldDef.requiredWhen` exposé tel que déclaré. `polenta.d.ts` régénéré (manifeste v4).

> **GH196 (contrat v1, ajout)** — `GraphTestRun.fields`, `notes` (Markdown), `stepResults` (`GraphStepResult` : `order`, `result`, `comment`, `fields`) ; `GraphObjectType.runFields` / `stepFields`. `polenta.d.ts` régénéré (manifeste v5).

> **GH198 (contrat v1, ajout)** — collection `changesets` (`GraphChangeset` : base commune statut / champs / historique, `component`, `mode`, `toModify`, `impacted` avec statut d'impact et `source`, `origin`, `integratedIn`, `campaigns`) ; catégorie `changeset` dans `GraphObjectCategory` et les types. Fichiers `changesets/` dans le périmètre du cache (watcher, canaux `changes:*`). `polenta.d.ts` régénéré (manifeste v6).

> **GH199 (contrat v1, ajout)** — `GraphChangeset.range` (bornes d'un change sur l'existant) et `GraphChangeset.analysis` (instantané figé au statut terminal : lignes, racines, campagnes ; jamais recalculé par le graphe). `polenta.d.ts` régénéré (manifeste v7).

## 3. Exécution (bac à sable)

- **Script de données** : module ES, `export default function (data, polenta) { return rows }`,
  synchrone. **Transformation** de widget : `export default function (rows, polenta) { return rows }`.
- **Ligne** : objet plat de valeurs scalaires + `_ids` facultatif (identifiants des objets
  d'origine ; entrée de campagne `CAMP-xxxx/<entryId>`). L'agrégation se fait en JS, jamais dans la
  spec (`aggregate` perd `_ids` : avertissement dans l'éditeur et le MCP).
- **QuickJS** (wasm, `quickjs-emscripten-core`) dans un `worker_threads` par process (desktop,
  serveur web, MCP) : file d'attente, chien de garde (worker muet remplacé), contexte préparé
  (graphe et bibliothèque gelés) réutilisé, 2 contextes au plus par worker. Un script partagé par
  plusieurs widgets n'est exécuté qu'une fois par rafraîchissement (mêmes `drill` et mêmes valeurs de
  paramètres).
- **Isolation** : pas de globaux de l'hôte (`fetch`, `require`, `process`, timers, `console`…) ;
  imports limités à `lib/…`, `<composant>::lib/…` et aux chemins relatifs internes à un `lib/` ;
  données, exports de bibliothèque et intrinsèques gelés (un widget ne voit pas les modifications
  d'un autre).
- **Limites** : 2 s par exécution (script + transformation), 64 Mo de tas, mémoire wasm plafonnée
  à 128 Mo, pile 256 Ko.
- **Erreurs** : `{ kind, message, file, line, column }` (`syntax`, `import`, `runtime`, `timeout`,
  `memory`, `stack`, `rows` (sortie invalide), `contract`, `async`, `export`, `legacy-sql`, `format`
  (dont déclaration de paramètres invalide), `spec`, `params` (clé non déclarée, valeur hors format,
  paramètre obligatoire sans valeur)) affichées dans le widget (`message (fichier:ligne)`),
  jamais un graphe vide. Module `lib/…` introuvable : le message renvoie au bandeau (§8.1).

Canaux : `suivi:run` (script fourni, requête enregistrée, ou widget = requête + transformation ;
`drill`, `params` (valeurs), `parameters` (déclaration d'un script fourni) facultatifs),
`suivi:describe-ids`, `suivi:resolve-target`, `suivi:templates`, `suivi:render-template` (requête :
script + déclaration), `suivi:object-types`, `suivi:updates-list` / `-apply` / `-ignore`,
`dashboards:param-values-get` / `-set` (§5.1).

---

## 4. Bibliothèque projet (`dashboards/lib/`)

Modules JS importables par les scripts et transformations : `lib/<chemin>.js` (repo ouvert),
`<composant>::lib/<chemin>.js` (repo composant du workspace, nom de montage).

Contenu de départ livré (`apps/desktop/resources/dashboard-lib/`, `manifest.json` = versions et
empreintes de chaque fichier) :

| Module | Fonctions |
|---|---|
| `time.js` | `offsetAt`, `dayOf`, `dayEnd`, `dayRange` (jours locaux via `polenta.timezoneOffsets`) |
| `status.js` | `ENTRY_ORDER`, `ENTRY_SEVERITY`, `worst`, `typeIndex`, `isApproval`, `statusLabel`, `entryStatusLabel` |
| `history.js` | `valueAt(obj, champ, date)`, `timeline(objets, champ, options)` (GH77) |
| `campaign.js` | `campaignsTimeline` / `campaignTimeline` (état des entrées jour par jour, repli GH73 §6.2 marqué `approximate`, `polenta.drill`), `entryRuns`, `entryStep` / `stepRank` / `stepLabel` / `stepContext` (étapes d'avancement, ex-GH71), `lastResult(s)` (tous les runs), `lastEntryResult(s)` (v3, GH70 : entrée de campagne exécutée la plus récente, toutes campagnes, abandonnées comprises, runs hors campagne ignorés), `entryResultsByCampaign` (v4, GH126 : une ligne par (campagne, test ayant une entrée active), campagnes par `createdAt` puis ID, abandonnées comprises ; test itérant → pire statut `worst`, `statuses` de toutes les instances, `entryId` / `executedAt` / `executedBy` de l'instance qui porte ce statut (la plus récemment exécutée parmi elles, à défaut la première), nuls si ce statut est `pending`) |
| `maturity.js` | `maturity(data, exigence, ctx?, locale?)`, `maturityContext`, `isFilled`, `isEarsCompliant` : les 5 critères de maturité (§7.2) |
| `polenta.d.ts`, `../jsconfig.json` | types du contrat ; `tsc -p dashboards/jsconfig.json` vérifie scripts et bibliothèque |

Chaque fichier livré porte `// @polenta-lib <id> <version>`. Copie au premier accès (§7.1), mises à
jour proposées dans le bandeau (§8.1).

---

## 5. Modèles

Un modèle génère du code à partir d'un formulaire (`packages/types/src/suivi-templates.ts`, pur,
déterministe) :

- **Requête** : « Liste filtrée » (ex-builder : catégorie ou type d'objet, composant, conditions
  `= != > < contient dans`, ET / OU, regroupement → `count`), « Entrées de campagne » (une ligne par
  entrée ; filtres statut de campagne / campagnes / statut d'entrée ; option « Étape d'avancement »
  → colonnes `step`, `stepLabel`, `stepRank`, `stepColor` via `lib/campaign.js`), « Avancement dans
  le temps » (`campaignsTimeline` : une ligne par jour × statut d'entrée, pas jour / semaine).
  Options « … choisi(e) à l'affichage » (§5.1) : campagne (entrées, avancement), période (avancement),
  composant et type d'objet (liste filtrée).
- **Widget** (transformation + spec) : barres (groupées / empilées, ordre et couleur des séries par
  colonne), camembert, courbe, indicateur, table, matrice (pire statut par cellule), aire empilée
  temporelle (couche de marques quasi transparentes pour rendre chaque point cliquable, gestion de
  `polenta.drill`). Mesures : nombre, somme, min, max, valeurs distinctes, pire statut. Les colonnes
  proposées sont celles du résultat de la requête.
- **Requête « Dernier résultat de campagne (colonne) »** (`campaign-last-result`, GH70, sans
  paramètre de formulaire) : génère une colonne calculée (§5.2) « Dernier résultat » / « Last
  result » des cas de test, à partir de `lastEntryResults` (`lib/campaign.js`).
- **Requête « Résultat par campagne (colonnes) »** (`campaign-results`, GH126, sans paramètre) :
  colonne calculée **éclatée** (§5.2) « Résultat par campagne » / « Result by campaign » des cas de
  test, une sous-colonne par campagne, à partir de `entryResultsByCampaign` (`lib/campaign.js` v4) ;
  lignes `id`, `value` (statut, `pending` si non exécuté), `campaignId`, `campaignTitle`, `tooltip`
  (« `CAMP-xxxx` — titre · date · exécutant », « · non exécuté », « · PASS, FAIL » pour plusieurs
  instances), `_ids` ; déclaration proposée : `values: [PASS, FAIL, BLOCKED, INCOMPLETE, pending]`,
  `splitColumn: campaignId`, `splitLabelColumn: campaignTitle`.
- **Référence** stockée : `template: { id, version, params, hash }`, `hash` = SHA-256 du code
  généré normalisé (`hashableText`) — pour une requête, script **et** déclaration de paramètres s'il
  y en a (`queryCodeForHash`) : modifier la déclaration détache aussi la requête. Code différent → **personnalisé** : la popup n'affiche que le
  code, « Revenir au modèle » (confirmation) régénère depuis `params`. Objet sans modèle :
  personnalisé d'emblée.
- **Nouvelle version d'un modèle** : jamais appliquée sans action — proposée dans le bandeau pour les
  objets des seeds, signalée dans la popup pour les autres (régénéré à l'enregistrement).

### 5.1 Paramètres choisis à l'affichage (GH93)

Logique pure : `packages/types/src/suivi-params.ts` (main, MCP, renderer).

- **Déclaration** (`parameters` de la requête, dans `query.yaml` ou l'entrée du `.pref`, omise si
  vide ; générée par un modèle, éditée dans `/query` en mode Script ou par le MCP) : `name` (clé de
  `polenta.params`, lettre puis lettres / chiffres / `_`, unique), `kind`, `label` (`{ fr, en }` ou un
  texte), `values` (`enum`), `default`, `required`. Déclaration invalide refusée à l'enregistrement
  (`[PARAMS_INVALID]`) ; lue invalide (fichier modifié à la main) → `parametersError`, exécution
  refusée (`format`), jamais réécrite vide sans être remplacée.
- **Types et valeurs** : `campaign` (ID), `component` (nom), `objectType` (`objectTypeRef`), `enum`
  (valeur déclarée), `text` (≤ 1 000 caractères, espaces de bord retirés), `period`
  (`{ from, to }`, jours `AAAA-MM-JJ` facultatifs, `from ≤ to`) ; `null` = « Tous / Toutes ».
  Sélection simple.
- **Résolution** (main, `resolveRunParams`) : clé non déclarée → erreur `params` ; valeur fournie
  (même `null`) → normalisée ; absente → `default`, sinon `null` ; `required` sans valeur → erreur.
- **Barre du dashboard** (`ParamBar`, `useDashboardParams`) : un sélecteur par couple (`name`,
  `kind`), partagé par les requêtes qui le déclarent, dans l'ordre des widgets puis des déclarations
  (libellé de la première ; `enum` : union des valeurs, une valeur non déclarée par une requête ne lui
  est pas transmise). Pas de barre sans paramètre. Changer une valeur ne relance que les widgets
  concernés (valeurs dans la clé du résultat). Paramètre obligatoire sans valeur → widget « Choisir
  <libellé> », non exécuté. **Réinitialiser** → défauts des déclarations.
- **Valeur choisie** : par utilisateur et par dashboard dans le `.pref` (`suiviParamValues[dashboard]
  ["name:kind"]`, jamais commité, aussi sur une branche ou un dashboard en lecture seule) ; suit le
  dashboard au changement de portée, retirée à sa suppression. Pas de défaut propre au dashboard.
  Valeur devenue introuvable (campagne supprimée, composant / type retiré, valeur d'énumération
  retirée) → « Valeur introuvable : … », défaut appliqué, valeur conservée dans le `.pref`.
- **Vue `/query`** : barre des paramètres de la requête (défauts à l'ouverture, non mémorisée) ;
  exécution et export Excel avec ces valeurs ; déclaration éditable (`ParameterDeclEditor`) en mode
  Script, affichée en lecture seule pour un modèle ; enregistrement impossible tant qu'elle est
  invalide.
- **Modèles** : campagne choisie → ses seules entrées, filtres de statut / liste de campagnes du
  modèle ignorés (« Toutes » → filtres) ; période → bornes de `campaignsTimeline` ; composant / type
  choisi → remplace la valeur fixée (« Tous » → valeur fixée, sinon aucun filtre).

### 5.2 Colonnes calculées de la Vue Système (GH70)

Une **requête partagée** — écrite en Script **ou générée par un modèle** — peut déclarer `column`
dans `query.yaml` : elle devient une colonne
proposée dans le panneau ⚙️ de la Vue Système (SPEC-SYSTEM-VIEW §Configuration des champs) pour
les types qu'elle désigne. Mécanisme générique : Polenta ne sait rien de ce que calcule le script
(principe GH79).

```yaml
column:
  label: Dernier résultat                 # ou { fr, en }
  appliesTo: { categories: [test], objectTypes: [] }   # catégorie OU type précis <nœud>::<type>
  type: enum                              # type de champ (hors drawio) : rendu de la cellule
  values: [PASS, FAIL, BLOCKED, INCOMPLETE]   # enum / multi_enum seulement
  idColumn: testCaseId        # colonne du résultat : ID de l'élément (défaut id)
  valueColumn: status         # colonne du résultat : valeur (défaut value)
  tooltipColumn: campaignTitle  # colonne du résultat : infobulle (défaut tooltip)
  splitColumn: campaignId       # GH126 — colonne éclatée : une sous-colonne par valeur distincte
  splitLabelColumn: campaignTitle  # GH126 — libellé des sous-colonnes (défaut : la valeur)
```

- **Contrat de ligne** : une ligne par élément ; la colonne `idColumn` (défaut `id`) porte l'ID de
  l'exigence ou du test, `valueColumn` (défaut `value`) la valeur du champ (`null` = vide),
  `tooltipColumn` (défaut `tooltip`) l'infobulle (texte ou nombre), le premier `_ids` la cible
  ouverte au double-clic. Une requête existante (ex. « Entrées de campagne » : `testCaseId` →
  `status`) sert donc sans code. Première ligne d'un ID retenue (l'ordre, donc la règle, est celle
  du script), ID inconnu ignoré, valeur hors type affichée telle quelle ; colonne d'ID ou de valeur
  absente d'une ligne → erreur de la colonne (« colonne « X » manquante »).
- **Colonne éclatée (GH126)** : avec `splitColumn`, une ligne par (élément, sous-colonne) ; chaque
  valeur distincte non vide de `splitColumn` définit une sous-colonne de clé
  `query::<ID>::<valeur>` (`computedColumnKey` / `parseComputedColumnKey`), dans l'ordre de
  première apparition (le script décide) ; libellé = premier `splitLabelColumn` non vide de ses
  lignes, à défaut la valeur ; type, valeurs, infobulle et cible communs
  (`splitColumnValuesFromRows`). Ligne sans valeur de split → « colonne « X » manquante » ;
  plus de `MAX_SPLIT_COLUMNS` (50) valeurs → erreur de la colonne. `splitLabelColumn` sans
  `splitColumn` → déclaration invalide. Hors empreinte du modèle, comme le reste de `column`.
- **Validation** (`validateColumnDecl`, `packages/types/src/suivi-columns.ts`) : déclaration lue
  invalide → `columnError`, requête toujours exécutable, colonne non proposée ; la réécrire sans
  corriger est refusée (`[COLUMN_INVALID]`). Requête privée : colonne fournie refusée
  (`[COLUMN_PRIVATE]`), colonne seulement proposée par un modèle ignorée ; `.pref` qui en porte une
  → `columnError`. Passage partagé → privé : déclaration retirée (modèle conservé).
- **Indépendante du modèle** : la déclaration n'entre pas dans l'empreinte (`queryCodeForHash(script,
  parameters)`) ; la déclarer, la modifier ou la retirer ne détache pas la requête de son modèle. Un
  modèle peut **proposer** une déclaration (`QueryTemplate.column`, ex. `campaign-last-result`) :
  reprise à la création (sauf colonne fournie, et jamais en privé) et quand un **autre** modèle est
  appliqué ; réappliquer le même modèle garde la colonne actuelle, même retirée. Compatibilité :
  une empreinte calculée avec la colonne (sprints 1–2 de GH70) est reconnue, puis réécrite à la
  prochaine écriture.
- **Saisie** : section « Utiliser comme colonne dans la Vue Système » de la vue `/query`
  (`ColumnDeclEditor`), en mode Script comme en mode modèle (colonne proposée préremplie sur une
  requête non enregistrée, sans écraser une saisie) ; listes « Colonne identifiant / valeur /
  infobulle » alimentées par les colonnes du dernier résultat ; « Une colonne par valeur de » +
  « Libellé des colonnes » (GH126 ; défaut : première colonne du résultat qui n'est ni
  l'identifiant, ni la valeur, ni l'infobulle ; décocher retire les deux propriétés) ; désactivée sur une requête privée ;
  « Enregistrer sous… » en privé refusé si une colonne est saisie ; avertissement si `appliesTo` ne
  désigne aucun type.
- **Exécution** : `useComputedColumns` (renderer) lit les requêtes partagées du repo ouvert du
  projet, quel que soit le repo affiché dans la Vue Système ; une exécution `suivi:run` par colonne
  visible (onglet Tableau ou Document), clé `['widget-query-result', …]` (rafraîchie comme les
  widgets, §8.2). GH126 : une colonne éclatée est déployée dans le hook en sous-colonnes ordinaires
  (les vues n'en savent rien) ; une seule exécution pour toutes ses sous-colonnes, dès qu'une est
  visible ou que le panneau ⚙️ est ouvert (`discover`, pour les lister) ; seules les colonnes
  visibles sont fusionnées dans les objets ; pendant le chargement ou en erreur, les sous-colonnes
  visibles restent affichées (colonnes de substitution, d'après le dernier résultat valide de la
  session, sinon libellé = la valeur).

---

## 6. Rendu, drill-down, navigation

- **Vega-Lite** (`vega`, `vega-lite`, `vega-embed`, `vega-interpreter`, chunk paresseux),
  **sans `eval`** (`ast: true` + interpréteur), rendu SVG partout (écran et impression). Source de
  données nommée `"data": { "name": "rows" }`, alimentée par `view.data` ; `url` / `datasets`
  refusés.
- **Thème** : une valeur `"var(--jeton)"` de la spec est remplacée par la couleur du thème courant ;
  `config` (axes, légendes, fond, palette `chart-series-1…8`) dérivée des jetons ; changement de
  thème → recompilation.
- **Conventions de l'hôte** (`usermeta.polenta`) : `view: "kpi" | "table"` → rendu natif
  (lisible, sélectionnable ; `field`, `suffix`, `columns`) ; `seriesColors: { field, color, order? }`
  → échelle de couleur de `field` construite depuis les lignes (couleur = colonne `color`, jeton
  accepté ; ordre = colonne numérique `order`), pour des séries inconnues à l'écriture de la spec
  (étapes de préparation du projet).
- **Drill-down** : clic sur une marque → ligne d'origine du script (retrouvée par contenu : Vega
  dérive ses propres copies) ; `_ids` présents → popup « Détail » (ID, type, titre, statut ;
  `suivi:describe-ids`) ; sinon relance script + transformation avec `polenta.drill` = colonnes
  scalaires de la ligne → lignes avec `_ids` ; aucun → « Détail non disponible : le script ne fournit
  pas d'identifiants ». KPI : union des `_ids`. Table : ligne à un seul ID → ouverture directe. La
  relance utilise les valeurs de paramètres du widget cliqué.
- **Ouverture** (`suivi:resolve-target`) : exigence, test, campagne ; entrée de campagne →
  résultat d'exécution si exécutée, sinon page de campagne filtrée sur son **statut brut**
  (`status`). ID inconnu → « Objet introuvable ». Rien de cliquable dans l'aperçu ni en impression.
- **Exports** : Excel du résultat d'une requête (colonnes du script, `_ids` joints par « , »),
  docx du dashboard (une table des lignes de chaque widget, direct et par gabarit), PDF (impression,
  graphes SVG, prêt après rendu Vega). Dashboard paramétré : valeurs courantes de l'utilisateur,
  rappelées en tête (docx : paragraphes « Libellé : valeur », gabarit : `{#parameters}{label} :
  {value}{/parameters}` ; impression : barre en texte) ; widget en attente d'un paramètre
  obligatoire : « Aucune donnée. ».

---

## 7. Stockage, seeds, maturité

### 7.0 Format v1

| Entité | Partagé (repo) | Privé (`.{user}.pref`) |
|---|---|---|
| Requête | `queries/QUERY-NNNN/` : `query.yaml` (`id`, `title`, `formatVersion: 1`, `template?`, `parameters?` (GH93), `column?` (GH70, §5.2 ; `splitColumn` / `splitLabelColumn` GH126), `createdBy`, `createdAt`) + `script.js` | `savedQueries[]` (script inclus, jamais de `column`), ID `local-<ts>-<rand>` |
| Dashboard | `dashboards/DASHBOARD-NNNN/` : `dashboard.yaml` (widgets : `id`, `title`, `queryId`, `size`, `template?`) + `<widgetId>.js` (transformation) + `<widgetId>.vl.json` (spec) | `dashboards[]` (code des widgets inclus) |
| Historique de requêtes | — | `queryHistory` (texte du script) |
| Valeurs de la barre de paramètres (GH93) | — | `suiviParamValues` (dashboard → `name:kind` → valeur) |

IDs par `nextCounterId` (fichiers **et** dossiers `<PREFIX>-NNNN/`, pierres tombales GH20).
`state` (`customized`, `templateUpdate`, `readOnly`, `legacyFormat`) calculé à la lecture, jamais
écrit.

**Migrations à la lecture** : fichier d'avant GH74 (`QUERY-NNNN.yaml`, `DASHBOARD-NNNN.yaml`)
converti en mémoire (builder → « Liste filtrée », widgets → modèles), réécrit en dossier à la
prochaine écriture (une seule modification à publier). Requête **SQL** (ou builder utilisant une
colonne retirée : `progress*`, `testStatus`, `maturity*`) → lecture seule `legacy-sql` : SQL affiché,
non exécutable, à réécrire ou supprimer. `formatVersion` supérieure → lecture seule `newer-format`,
jamais réécrit. Écriture d'un objet en lecture seule → refus `SUIVI_READ_ONLY` (service, MCP).

### 7.0b Règles de dépendance et de scope

- Un widget ne peut être partagé que si sa requête l'est — UI (filtre du sélecteur) et service
  (`DashboardsService.setScope` / `addWidget` / `updateWidget`).
- Rétrogradation (partagé → privé) d'une requête bloquée si des widgets partagés en dépendent ;
  suppression d'une requête utilisée par un widget bloquée (dépendants affichés).
- Promotion (privé → partagé) libre ; l'id change, les widgets privés de l'utilisateur sont
  remappés ; la copie partagée est écrite avant le retrait de la privée.
- Limite connue : les dashboards privés d'un autre utilisateur ne sont pas visibles.

### 7.1 Seeds

Déclenchés par `dashboards:list` (`DashboardSeedService.ensureSeeded`, tentatives simultanées
partagées) :

- **Status** (partagé) : au premier accès si `dashboards/` ne contient aucun dashboard et n'a jamais
  été seedé (`dashboards/.seeded.yaml`, `seededAt` écrit après un seed complet, avec les ids
  créés) ; sauté sur une branche en lecture seule (`''`, `prj-*`). Deux barres empilées par
  composant (statut, `coverageStatus`) sur « Liste filtrée ».
- **Bibliothèque de départ** : au premier accès sur une branche inscriptible, si `dashboards/lib/`
  est absent, copie des fichiers livrés (à publier), notés dans `.seeded.yaml` (`library`, même si
  la copie est interrompue). Un fichier supprimé n'est jamais recréé ; un `dashboards/lib/` du
  projet n'est jamais écrasé (fichiers livrés absents proposés au bandeau).
- **Campagnes** (privé, par utilisateur, GH65) : marqueur à reprise `campaignsSeed` du `.pref`
  (`partial` / `done`, ids) ; pas de garde de branche. Widgets : **Avancement par campagne**
  (barres empilées sur l'étape `entryStep`, ordre canonique et couleurs `--chart-progress-*`),
  **% exécuté**, **% PASS** (indicateurs), **Exécutions par jour** (courbe), **Entrées en échec**
  (table), **Avancement dans le temps** (aire empilée des étapes d'avancement, campagnes en cours,
  pas journalier : `campaignsTimeline({ withStep })`, étape de préparation d'une entrée non exécutée
  = statut du test vivant à la fin du jour d'après son historique, à défaut son étape actuelle ;
  GH112). Libellés fr / en. Les six requêtes ont la campagne « choisie à l'affichage » (GH93) :
  un sélecteur **Campagne** commun, « Toutes » par défaut (filtres du seed). Seeds créés avant GH93 :
  non repris.
- **Seeds d'avant GH74** : requêtes reconnues à leur SQL **exact** d'origine (GH65, GH71) réécrites
  sous le même id, widgets restés au mapping d'origine réécrits ; objet modifié → laissé en
  `legacy-sql`. Requêtes partagées jamais réécrites sur une branche en lecture seule. Seed Campagnes
  existant sans « Avancement dans le temps » : widget **proposé** au bandeau.

### 7.2 Maturité (bibliothèque `maturity.js`)

Calculée par le projet (`maturity(data, exigence, ctx)` → `{ ok, missing }`, `ctx = maturityContext(data)`), règles d'origine
(T77, `CLAUDE.md` § Règles de cohérence) :

| # | Critère | Règle |
|---|---|---|
| 1 | Champs `required: true` remplis | non vide (texte sans HTML non blanc, tableau non vide) ; type introuvable → passant |
| 2 | Énoncé EARS | tout champ `validator: EARS` : commence par `WHEN`/`WHILE`/`WHERE`/`IF`/`THE` et contient `SHALL` |
| 3 | Critère d'acceptance mesurable | champ dont le nom ou le libellé contient « accept » : checklist `- [ ]` ou chiffre |
| 4 | Approuvée → vérifiée | statut `isApproval` ⇒ `coverageStatus ≠ not_covered` |
| 5 | Pas d'impact à vérifier | `needsRevalidation` absent |

`field-checks.util.ts` (main) garde `isFilled` / `isEarsCompliant` pour l'import en masse et la
résolution de conflits.

---

## 8. Panneau latéral

Sections « Dashboards » et « Requêtes » réorganisables par glisser-déposer
(`ReorderableSidebarSection`), filtre texte (titre + script ou SQL). Disposition GH14 : sections
empilées, repliables (`localStorage['polenta:suiviCollapsed']`), séparateur déplaçable
(`localStorage['polenta:suiviSplit']`), section dépliée automatiquement quand elle contient l'élément
actif. Badge « SQL » / « Lecture seule » sur un objet en lecture seule. Suppression d'une requête
depuis le panneau uniquement.

### 8.1 Bandeau des mises à jour

En tête du panneau, si des propositions existent : « Mises à jour disponibles (N) », repliable ;
une ligne par proposition (fichier ou widget, version actuelle → nouvelle ou « nouveau », résumé,
« à publier » pour une écriture du repo), cases à cocher, **Appliquer**, **Ignorer** (masque cette
version pour l'utilisateur : `suiviIgnoredUpdates` du `.pref`). Propositions
(`SuiviUpdatesService`) :
- `library` : fichier livré présent avec l'empreinte d'une version livrée **antérieure**, ou absent
  et jamais copié. Empreinte inconnue (modifié par le projet) ou supprimé après copie → jamais
  proposé ;
- `seed-widget` : widget ajouté au seed Campagnes depuis sa création ;
- `template` : objet d'un seed, non personnalisé, dont le modèle a une version plus récente.
Toutes vérifiées avant la première écriture (liste périmée → rien d'appliqué). Branche en lecture
seule : liste affichée sans « Appliquer », application refusée côté main.

### 8.2 Rafraîchissement

`useLiveFileSync` (renderer, alimenté par `RepoWatcherService`) invalide :
- `queries/**` → requêtes, résultats des widgets, bandeau ;
- `dashboards/**` → liste, dashboard ouvert, impression, bandeau ; `dashboards/lib/**` → résultats ;
- `.{user}.pref` → requêtes, dashboards, ordres ;
- résultats des widgets et popup de détail (`['widget-query-result']`, `['widget-drilldown']`) sur
  tout changement `requirements/`, `tests/`, `test-runs/`, `links/`, `campaigns/`, `queries/`,
  `dashboards/lib/` ou de ref, dans n'importe quel repo du workspace : un résultat saisi ailleurs ou
  récupéré par le pull automatique met à jour le dashboard ouvert.

---

## 9. Non-régression

Corpus de non-régression exécuté par `pnpm test` (`apps/desktop/src/main/services/suivi-corpus.test.ts`, références
`fixtures/suivi-corpus/*.json`, une ligne de résultat par ligne) : sur le projet de démonstration
généré (`scripts/demo-lave-linge/generate.mjs`), un projet minimal et un jeu gonflé ×50, chaque
widget des dashboards de la démo et des seeds est exécuté et comparé à sa référence ; mise à jour
volontaire par `vitest -u` (le diff montre l'effet d'une évolution du contrat, d'un modèle ou de la
bibliothèque). Budgets (contexte préparé) : avancement des campagnes < 200 ms sur la démo, < 1 s sur
×50. Équivalence avec l'ancien moteur SQL (étapes GH71, maturité T77, 12 cas de builder) figée dans
`fixtures/gh74-legacy-reference.json`.

---

## 10. Hors scope

- Via MCP : changement de scope privé ↔ partagé, ordre du panneau latéral, historique, seeds,
  bandeau — réservés à l'app.
- Redimensionnement libre des widgets ; partage d'un widget entre dashboards.
- Alertes / notifications sur seuils, requêtes planifiées.
- Colonnes calculées (GH70) : tri des colonnes de la Vue Excel, vue Édition et autres vues (Recherche,
  traçabilité, page campagne), colonnes éditables, colonnes personnelles (requêtes privées), paramètres
  choisis à l'affichage pour une colonne (valeurs toujours `null`), seed automatique de « Dernier résultat ».
- Politique CSP de l'application (#88) ; le rendu Vega est déjà compatible (pas d'`eval`).
- Paramètres (GH93) : sélection multiple, valeurs dépendantes entre sélecteurs, défaut propre au
  dashboard, paramètres dans l'URL, paramètres déclarés par un widget ; intégration d'un widget dans
  la page d'une campagne ; comparaison de campagnes sur un même graphique.
