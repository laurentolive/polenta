# GH399 — Design : lien et popup d'une exécution

Spec : `specs/GH399.md`. Chemins relatifs à `apps/desktop/src/`.

## 1. Principe

L'exécution devient une **catégorie de l'index des liens** (`ElementNavContext`), à côté des objets,
campagnes, versions et validations. Une fois l'exécution indexée, la mécanique de GH229 s'applique
d'office, sans code dédié :
- `ElementLink` (gestes, survol, Ctrl+clic) ;
- les ID reconnus dans les richtext (markdown-it, Tiptap, `ElementRefText`) ;
- la délégation au conteneur ;
- la popup unique.

Il reste trois points propres à la catégorie : sa navigation (`follow`), le corps de sa popup, et
la source de l'index.

## 2. Main : lecture

- `ExecutionHistoryTarget` gagne `{ runId: string }` (`packages/types/src/execution-history.ts`).
  - `ExecutionHistoryService.history` lit l'ID du test dans l'ID d'exécution :
    `runId.replace(/-run-\d+$/, '')`.
  - Il garde la seule ligne `key === runId`, sans les entrées en attente.
  - Ce qui suit est réutilisé tel quel : `runRow` (campagne, entrée, marqueurs), écart de version
    GH202, `runFieldDefs`.
- Nouveau canal **`executions:run-ids`** `(repoPath) → RunRef[]`, avec
  `RunRef = { id: string; testCaseId: string }`.
  - Il lit l'index en mémoire (`testsIndex.getRunsMap`), en lecture seule.
  - Il est exposé au web (`WEB_EXPOSED`, `ROOT_ARGS [0]`) et dans le client API
    (`executions.runIds`).

**Alternative rejetée** : un canal `executions:get` dédié. Il dupliquerait l'assemblage de la ligne
(campagne, entrée, marqueurs) que `history` fait déjà.

## 3. Index (`contexts/ElementNavContext.tsx`)

- Nouveau type `NavCategory = ObjectCategory | 'run'`. `ElementRef.category` devient un
  `NavCategory`. `ElementRef` gagne `testId?` (exécution : son test).
- Source de l'index : une requête par repo du workspace, `['element-nav', 'runs', repoPath]` →
  `api.executions.runIds`.
- Entrée d'index d'une exécution :
  - `title` et `objectTypeRef` sont ceux du test, lus dans `ws.objects` ; sans le test (test
    supprimé), l'exécution n'est pas indexée ;
  - `status` est vide ;
  - `repoPath` est le repo des `test-runs`.
- `useLiveFileSync` : `refreshElementNav()` aussi sur `test-runs/` (rafale de 300 ms), en plus de
  l'invalidation actuelle de `execution-history`.

## 4. Navigation

- Nouveau helper `runPage(row)` dans `lib/executionsRoute.ts`, partagé par la grille, la vue
  Validation et `follow`. Il rend :
  - `/campaign/$id/execute/$entry` si la campagne est ouverte ;
  - `/campaign/$id/run/$entry` si elle est close ;
  - `null` si l'exécution n'est pas ouvrable (isolée, entrée retirée, essai remplacé, campagne
    introuvable). Même règle que `canOpenRow`, qui y est déplacée.
- `follow(id)` pour une exécution est **asynchrone** :
  1. `queryClient.fetchQuery(['execution-run', repoPath, id, workspaceDir])`, la même requête que
     la popup, donc déjà en cache après un survol ;
  2. `runPage(rows[0])` ;
  3. si la page est `null` : rien ;
  4. sinon, comme les autres cibles : nouvel onglet, navigation, ou rien sur la page déjà affichée.

## 5. Popup (`components/element/ElementPreviewPopup.tsx`)

- `PreviewBody` délègue une cible `run` à `RunPreviewBody`, dans
  `components/executions/RunPreview.tsx`.
- Données : `useQuery(['execution-run', repoPath, id, workspaceDir])`, `staleTime` 5 s.
- Colonnes : `buildExecutionColumns` (#400) sur l'historique d'une ligne.
- Champs : préférence `runPopup` du type du test (`ElementRef.objectTypeRef`), lue comme
  `usePopupFields`. `notes` et `steps` sont ignorés.
- En-tête :
  - pastille de couleur des tests et ID de l'exécution ;
  - test (`ElementLink`, sans popup imbriquée grâce à `InPreviewContext`) ;
  - verdict, date, testeur ;
  - cellule Campagne et cellule Entrée (badges), par les `render` des colonnes ;
  - repo, s'il diffère de la racine.
- États : squelette pendant le chargement, « introuvable » si la ligne est absente.

## 6. Emplacements

| # | Fichier | Changement |
|---|---|---|
| 1 | `components/executions/executionColumnDefs.tsx`, colonne `entry` | Une ligne `run` (hors impression) devient un `ElementLink id={run.id}`, avec pour texte l'ID d'entrée, ou l'ID de l'exécution en grisé quand elle est isolée. Les badges restent hors du lien, et `elementId: row => row.run?.id` est ajouté. La navigation passe par `nav.follow`. Le bouton `open` et `gestures.open` disparaissent ; `openVersion` reste. |
| 2 | `components/validation/ValidationRuns.tsx` | La date d'une exécution dépliée devient `ElementLink id={row.run.id}`. `canOpen` et `openRun` sont retirés, car `follow` applique la même règle. |
| 3 | `components/system/EditView.tsx` | `originRuns` devient une liste d'`ElementLink`, séparés par des virgules. Un ID absent de l'index reste du texte, comme dans `ElementLink`. |
| 4 | `components/campaign/CampaignEntriesGrid.tsx`, colonne `status` | Si `runId` est renseigné, la pastille est enveloppée dans `ElementLink id={runId}`, et `elementId: r => r.run.runId` est ajouté. |
| 5 | Richtext, `ElementRefText` | Rien à changer : l'index fait foi. |

`ExecutionHistoryGrid` garde `useExecutionGestures` pour `openVersion` seulement ; il est renommé
en conséquence.

## 7. Écart d'index du repo du test (constat de la spec)

`tests.service.ts` (lignes 284-285) écrit l'exécution dans `targetRepo`, puis appelle
`upsertRun(repoPath)`. Quand le test appartient à un autre repo, l'exécution entre dans l'index du
repo appelant et pas dans celui du repo du test, jusqu'à la prochaine reconstruction. GH269 interdit
ce cas pour les campagnes ; une exécution isolée d'un test de composant lancée depuis le produit y
reste exposée. Le cas est **hors scope**, une issue est ouverte (§ Issue).

## 8. Tests

Voir `specs/GH399-tests.md`. Un seul sprint.
