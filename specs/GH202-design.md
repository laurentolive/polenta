# GH202 — Design

Spec : `specs/GH202.md`. Un seul sprint : le socle, la saisie et la consultation se testent ensemble.

## Types (`packages/types`)

- **`tested-config.ts`** (nouveau) : `TestedConfigNode`, `TestedConfig` (racine, avec `component`),
  `TestedConfigChoice` (saisie), `TestedRepoOptions` (versions et dépendances proposées), `TestedDriftItem`.
  Fonctions pures : `applyChangesHistory`, `selectableVersions`, `testedChoiceFromConfig`,
  `testedDeviations`, `flattenTestedRepos`, `testedUndocumented`.
- **`TestRun.testedConfig`**, `ExecuteTestCaseDto.testedVersion`, `ImportedInstance.testedVersion`.
- **`ExecutionHistoryRow.testedDrift`** et `testedRepoPath`.
- **`graph.ts`** : `GraphTestedNode` défini sur place (le fichier source de `polenta.d.ts` reste autonome).

**Saisie unique** : `TestedConfigChoice = { version: string; components?: Record<chemin, string> }`. Une
valeur est un ID ou un label de version sélectionnable, sinon un texte libre. L'écran et le classeur passent
par la même résolution, et le main construit seul la copie (l'IPC n'est pas validée, le run est immuable).

**`expected: null`** : la composition ne prévoyait rien pour ce composant. Permet de distinguer un écart
d'un composant simplement non renseigné, et de comparer à l'état courant.

## Historique des changements

`HistoryService.stampVersionChanges`, appelée par `VersionsService.stamp` : toutes les écritures de version y
passent. La clé `changes` n'est pas un champ de `fields` : elle reste hors de `trackedKeys`, et la fusion
git GH77 l'unit déjà comme toute clé de `history`. Si la dernière entrée ne correspond plus à la liste
(YAML modifié à la main), `changesAt` est omis du run plutôt que de désigner une entrée fausse.

## Service `TestedConfigService` (`main/services/tested-config.service.ts`)

- `options` : arbre des versions proposées.
- `context` : options et pré-remplissage d'une campagne (IPC `tested-config:context`).
- `resolve` : choix → `TestedConfig`, ou refus `TESTED_VERSION_REQUIRED`.
- `drift` : comparaison à l'état courant (IPC `tested-config:drift`, et lignes de la grille).

Injecté dans `TestsService` par setter (`setTestedConfig`), comme `VersionsService.setImpactSources` : il lit
les runs par `TestsService`. Absent dans le serveur MCP, qui n'écrit pas d'exécution. Le contrôle ne vise
qu'une exécution de campagne (`campaignEntry`) ; l'import a son propre contrôle (`tested_version_missing`).

`VersionsService` expose `dependenciesOf` et `repoPathNamed`, construits sur l'arbre logique existant.

## Classeur

Format v4 : colonnes `tested:` (version) et `tested:<chemin>`, listées dans la carte `columns`. Pas de
colonne si le repo n'a pas de version sélectionnable. La signature d'instance n'ajoute ces valeurs que si elles
existent, pour qu'un classeur v3 reste reconnu « non modifié ». `export` et `preview` reçoivent `workspaceDir`.

## Renderer

- `components/executions/TestedVersionPicker.tsx` : saisie de l'écran d'exécution.
- `components/executions/TestedConfigView.tsx` : lecture seule (run) et `driftText`.
- `executionColumns.ts` / `ExecutionHistoryGrid.tsx` : colonnes `testedVersion`, `testedStructure`,
  `testedCommit`, `testedDeviations`.

## Alternatives rejetées

- **Copie de la liste dans le run** : abandonnée en spec (Q3).
- **Historique en delta** : casserait la règle « la valeur courante est la dernière entrée ».
- **Passer une structure typée de l'écran au main** : le classeur n'a que du texte ; une seule résolution évite
  deux chemins d'écriture.
