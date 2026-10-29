# GH222 — Design technique

Spec : `specs/GH222.md`. Ce document fixe les modules, les interfaces et le découpage en sprints.

## 1. État des lieux (code existant)

| Domaine | Fichiers | Limite constatée |
|---|---|---|
| Merge 3 voies | `packages/merge-core/src/object.ts` (unités d'objet), `keyed.ts` (liens, paramètres), `text.ts` (`diff3` ligne à ligne), `markers.ts`, `units.ts` | trois algorithmes ; tout YAML autre qu'objet / liens / paramètres passe en `diff3` ligne à ligne |
| Session de résolution | `apps/desktop/src/main/services/merge-resolution.service.ts` | un fichier n'est listé que si `mergeFile(...).blocks.length > 0` : un moteur plus fin réduit **directement** les faux conflits |
| Merge, UI | `components/merge/FileResolver.tsx`, `RawPane.tsx` (CodeMirror 6), `RenderedObjectPane.tsx`, `scrollSync.ts` | Rendu limité aux exigences / tests ; surlignage ligne entière seulement ; actions seulement dans la sortie |
| Diff, UI | `components/diff/FileDiffView.tsx`, `LineDiffView.tsx`, `ObjectDiffView.tsx`, `DiffValue.tsx`, `StepsDiff.tsx`, `DrawioFileDiffView.tsx` ; `lib/lineDiff.ts`, `objectUnits.ts`, `align.ts`, `wordDiff.ts`, `mediaDiff.ts` | `computeLineDiff` **tronque à 2 000 lignes** par côté (LCS O(n·m)) ; diff Raw sans surlignage intra-ligne ; fonds `status-*-bg` à 15 % en sombre |

Écriture des fichiers YAML par l'app : toujours `yaml.dump(…, { lineWidth: 120 })`, sauf le
stockage Suivi (`suivi-store.util.ts` : `{ lineWidth: -1, noRefs: true }`).

## 2. Moteur YAML générique (`@polenta/merge-core`)

### 2.1 Nouveaux modules

```
packages/merge-core/src/
  path.ts        chemins de nœuds : segments, clé de bloc, échappement
  structure.ts   descriptions de structure (§2.3) + heuristiques d'identité
  diff-tree.ts   diffTree(before, after, desc) → DiffNode (2 voies)
  merge-tree.ts  mergeTree(base, left, right, desc) → MergeNode + sortie YAML à régions
  list.ts        alignement de listes : par identité, par diff3 / LCS sur éléments canoniques
  flat-tree.ts   arbres d'affichage (.polenta/trees) : aplatissement id → (parent, rang)
  drawio.ts      pages d'un .drawio : découpage, diff et merge par page
  output.ts      sortie : dump avec emplacements, régions à toute profondeur, updateOutputAt
```

`object.ts` et `keyed.ts` deviennent des **descriptions** (§2.3) au-dessus du moteur ;
`mergeObject` / `mergeKeyed` restent exportés (même signature) en façade, pour les tests et les
appelants existants.

### 2.2 Types

```ts
type Segment = { key: string } | { item: string }        // clé de mapping | élément identifié
type NodePath = Segment[]

type DiffState = 'unchanged' | 'added' | 'removed' | 'modified' | 'moved'
type MergeState = DiffState | 'auto-left' | 'auto-right' | 'both-same' | 'conflict' | 'resolved'

interface DiffNode {
  path: NodePath
  label: string                 // clé, valeur d'identité, ou index
  kind: 'map' | 'list' | 'scalar' | 'text' | 'range'   // text = chaîne multiligne ; range = plage d'éléments diff3
  state: DiffState
  before?: unknown; after?: unknown
  children?: DiffNode[]          // ordre d'affichage : Après, puis éléments seulement Avant
  changedCount: number           // descendants modifiés (résumé d'un nœud replié)
}

interface MergeNode extends Omit<DiffNode, 'state' | 'before' | 'after' | 'children'> {
  state: MergeState
  base?: unknown; left?: unknown; right?: unknown
  blockKey?: string              // présent si le nœud est une unité de bloc (conflit ou repris)
  children?: MergeNode[]
}
```

`FileKind` gagne `'yaml'` (YAML générique) et `'drawio'`. `FileMerge` gagne `tree?: MergeNode`
(racine) ; `blocks` et `auto` gardent leur forme (`key` = clé de bloc).

### 2.3 Descriptions de structure

```ts
interface StructureDesc {
  kind: FileKind
  /** Identité des listes par motif de chemin (`*` = un segment) ; défaut : heuristique §2.4. */
  lists?: Record<string, { by: string } | { by: 'value' } | { lcs: true; ignore?: string[]; renumber?: string }>
  /** Chemins atomiques : un nœud ainsi désigné est un bloc entier (pas de récursion). */
  atomic?: string[]
  /** Règles de réconciliation sans conflit (version max, needsRevalidation OU, history union). */
  reconcile?: Record<string, (b, l, r) => unknown | NO_RECONCILE>
  /** Clé de bloc à partir du chemin (compatibilité GH37). */
  blockKey?: (path: NodePath) => string
  hidden?: string[]              // nœuds masqués en Rendu (id, projectId, branchId, objectTypeRef, history)
  sortKeys?: string[]            // mappings écrits triés (parameters)
  flatTree?: { childrenKey: string; idKey: string }   // .polenta/trees
}

function structureFor(path: string | undefined, sides: unknown[]): StructureDesc
```

| Description | Reconnaissance | Points clés |
|---|---|---|
| `object` | mapping avec `id` et `objectTypeRef` (inchangé) | `atomic: ['*', 'fields.*']` sauf `steps` ; `steps` : `lcs`, `ignore: ['order']`, `renumber: 'order'`, une étape = bloc ; `runs` (campagne) : `by: 'entryId'`, `removedRuns` : `by: 'entryId'`, `testCaseIds` : `by: 'value'`, une entrée = bloc atomique ; `reconcile` version / needsRevalidation / history ; clés `title`, `fields.<nom>`, `steps~<n>`, `runs~<entryId>` |
| `links` | `links/links.yaml` (inchangé) | liste `links` par `id`, un lien = bloc ; clé `link:<id>` |
| `parameters` | `parameters/parameters.yaml` | un paramètre = bloc, clés triées ; clé `param:<nom>` |
| `flatTree` | `.polenta/trees/**` | aplatissement id → { parent, rang, autres propriétés } (§2.6) |
| `yaml` | tout autre `.yaml` / `.yml` dont chaque côté est **canonique** (§2.5) | heuristiques §2.4 ; clé = pointeur (§2.7) |
| `drawio` | `.drawio` | §2.8 |
| `text` | le reste, ou YAML non canonique | `diff3` ligne à ligne (inchangé) |

### 2.4 Heuristiques d'identité (YAML générique)

Pour une liste présente sur au moins un côté :
1. tous les éléments sont des mappings et une même clé parmi `id`, `entryId`, `name`, `key` a une
   valeur scalaire **unique** sur chaque côté → identité par cette clé ;
2. tous les éléments sont des scalaires uniques sur chaque côté → identité par valeur ;
3. sinon → alignement `diff3` (merge) / LCS (diff) sur la forme canonique des éléments
   (`JSON.stringify` à clés triées). Une plage en conflit est un bloc `range`.

Ordre d'une liste identifiée : celui de droite, puis les éléments seulement à gauche à la place
qu'ils ont à gauche (après leur prédécesseur commun). Deux ordres différents des mêmes éléments
modifiés des deux côtés → bloc d'ordre `<chemin>~order` (choix gauche / droite).

### 2.5 YAML non canonique → texte

Le merge structurel réécrit le fichier par `yaml.dump`. Pour ne **jamais perdre de commentaire ni
de mise en forme** d'un YAML écrit à la main, `yaml` n'est retenu que si chaque côté présent vérifie
`yaml.dump(yaml.load(s), opts) === s` pour l'un des deux styles de l'app
(`{ lineWidth: 120 }` ou `{ lineWidth: -1, noRefs: true }`), le même pour tous les côtés ; la sortie
est écrite dans ce style. Sinon : `text`. Objets, liens et paramètres gardent leur comportement
actuel (toujours structurels).

L'**affichage** (diff, panneaux du haut en merge) reste structurel pour tout YAML lisible, même non
canonique : seule la fusion bascule en texte.

### 2.6 Arbres d'affichage

`.polenta/trees/**` : nœuds `{ id, kind, objectId?, children }` imbriqués. Aplatis en
`id → { parent, index, kind, objectId }`, fusionnés par `id` :
- propriétés et parent fusionnés comme des unités ; parent différent des deux côtés → bloc
  `pos:<id>` (choix gauche / droite) ;
- rang : ordre des frères de droite, éléments de gauche insérés après leur prédécesseur ;
- arbre reconstruit à la sortie. Un cycle (A sous B à gauche, B sous A à droite) est un conflit
  `pos` sur les deux nœuds.

Diff 2 voies : un nœud dont le parent change est `moved` et apparaît à ses deux places (Avant :
ancienne place, Après : nouvelle), avec un lien croisé.

### 2.7 Clés de bloc et chemins

- Objets, liens, paramètres : clés GH37 inchangées (`title`, `fields.statement`, `link:<id>`,
  `param:<nom>`) — brouillons, ancres de défilement et validations continuent de fonctionner.
  Nouvelles : `steps~<n>` (étape, n = index dans la sortie), `runs~<entryId>`, `<chemin>~order`.
- YAML générique : pointeur JSON (RFC 6901) avec segment d'élément identifié `@<valeur>`
  (`/nodes/@root/objectTypes/@exigence-systeme/statuses`) ; `~0` `~1` et `]` échappé en `~2`
  (le marqueur `[clé]` ne doit pas contenir `]`).
- `markers.ts` : inchangé (la clé est déjà une chaîne libre sans `]`).

### 2.8 `.drawio`

`<mxfile>` → pages `<diagram id name>…</diagram>` (contenu compressé ou non, comparé tel quel
après normalisation des espaces de fin). Identité : `id`, sinon `name`. Diff : page
`added/removed/modified`. Merge : page modifiée des deux côtés → bloc `page:<id>` ; la sortie est
le XML avec la région de marqueurs autour de l'élément `<diagram>` entier (une région retirée laisse
un XML valide). Attributs de `<mxfile>` : ceux de droite.

### 2.9 Sortie YAML à régions (toute profondeur)

Généralisation de la technique actuelle (`PLACEHOLDER` puis remplacement de ligne) :
- bloc valeur de mapping → ligne `<indent><clé>: __POLENTA_MERGE_n__` ;
- bloc élément ou plage de liste → ligne `<indent>- __POLENTA_MERGE_n__` ;
- fragment = dump du ou des éléments au même retrait. Un fragment absent (supprimé d'un côté) est
  vide, comme aujourd'hui.

`updateOutputAt(text, path, value)` remplace `updateObjectOutput` (même mécanique : régions
remplacées par des clés de substitution au bon retrait, chargement, modification au chemin, dump,
régions réinsérées). `updateObjectOutput` reste en façade.

### 2.10 Diff 2 voies et diff de texte

- `diffTree` réutilise `list.ts` (LCS par identité ou sur éléments canoniques).
- Diff ligne et caractère : **`@codemirror/merge`** (MIT, même auteur que CodeMirror déjà
  utilisé) : fonction `diff()` (Myers, linéaire en pratique) pour le surlignage intra-ligne, et
  `MergeView` / `unifiedMergeView` pour le Raw des vues de diff. `computeLineDiff` (plafond
  2 000 lignes) est retiré. Version fixée à une publication de plus de deux semaines.
- `wordDiff.ts` (mot à mot du Rendu) inchangé.

## 3. Session de résolution (main)

- `merge-resolution.service.ts` : aucun changement de flux. `detectKind` → `structureFor`. Liste
  des fichiers en conflit, finalisation et renumérotation passent par `mergeFile` : le gain de
  finesse est automatique.
- Validation : `kind: 'yaml'` → YAML valide et mapping (`notObject`) ; `kind: 'drawio'` → XML
  `<mxfile>` bien formé (nouveau code `invalidDrawio`).
- ~~`MergeFileDetail` gagne `tree?: MergeNode`~~ — abandonné au sprint 1 : `@polenta/merge-core`
  est partagé avec le renderer, qui recalcule `diffTree` / `mergeFile` à partir de
  `base` / `left` / `right` déjà présents dans le détail. `MergeNode` n'existe pas.
- Finalisation : `canonicalOutput(kind, texte, côtés)` réécrit une sortie YAML au format de l'app
  **seulement si nécessaire** (ligne `-` seule ou balise `!!seq` laissées par une région imbriquée,
  `order` des étapes à renuméroter) ; sinon le texte de l'utilisateur est gardé tel quel.
- `MergeFileEntry` gagne `counts?: { conflicts: number; auto: number }` pour la liste des fichiers.

## 4. Mise en évidence (renderer)

### 4.1 Jetons `diff-*`

`index.css` (clair et sombre) + `tailwind.config` :

| Jeton | Usage |
|---|---|
| `--diff-line-del` / `--diff-line-ins` | fond de ligne / de bloc |
| `--diff-char-del` / `--diff-char-ins` | caractères (plus soutenu) |
| `--diff-conflict` / `--diff-conflict-bg` | bordure / fond de conflit |
| `--diff-resolved`, `--diff-auto-left`, `--diff-auto-right` | barres latérales |
| `--diff-hatch` | zones hachurées (`repeating-linear-gradient`) |

Valeurs sombres opaques (pas d'opacité 15 % sur le fond) ; contraste vérifié : texte ≥ 4,5:1 sur
chaque fond ; fond de ligne distinct du fond de page (≥ 1,3:1 de luminance relative).

### 4.2 Composants communs (`components/diffkit/`)

| Composant / module | Rôle |
|---|---|
| `OverviewRuler.tsx` | bande verticale le long d'un conteneur défilant : marques `{ top, height, tone }` en proportion de la hauteur totale ; clic → défilement |
| `useChangeNavigation.ts` | liste ordonnée des changements (ou conflits non résolus), index courant, `next/prev`, raccourcis `F7` / `Maj+F7` / `Alt+↓` / `Alt+↑`, mise en relief du courant |
| `NavBar.tsx` | boutons précédent / suivant + compteur « 3 / 12 » |
| `Hatch` (classe `diff-hatch`) | zone d'absence alignée |
| `rawDiff.ts` | extension CodeMirror : décorations ligne + caractère à partir de `diff()` (panneaux de merge vs ancêtre) |
| `diffPrefs.ts` | + `layout: 'side' | 'inline'`, `treeWidth` |

### 4.3 Raw

- Vues de diff : `RawDiffView.tsx` = `MergeView` (côte à côte) ou `unifiedMergeView` (en ligne),
  lecture seule, `highlightChanges: true`, `gutter: true`, `collapseUnchanged: { margin: 3,
  minSize: 4 }`, espaces d'alignement stylés `diff-hatch`, navigation par `goToNextChunk` /
  `goToPreviousChunk`, règle de vue d'ensemble alimentée par les chunks. Remplace `LineDiffView`.
- Résolution de conflits (`RawPane`) : panneaux gauche / droite décorés par `rawDiff.ts` (diff
  ligne + caractère contre l'ancêtre) ; widget d'actions au-dessus de chaque bloc **dans chaque
  panneau** (gauche : Prendre gauche ; droite : Prendre droite ; sortie : gauche | droite | les
  deux | réinitialiser) ; marques de gouttière ; règle de vue d'ensemble ; navigation des conflits.
  Le bloc d'un panneau du haut est localisé par l'ancre de son unité (`unitAnchors`) ou, pour un
  hunk texte, par la position du fragment.
- « Prendre les deux » : `resolveRegionBoth(text, key)` (merge-core) — concatène les fragments
  quand le bloc est une liste / plage (éléments de gauche puis de droite) ou un texte ; proposé
  seulement si `canTakeBoth(block)`.
- « Réinitialiser » : réécrit la région initiale du bloc (fragment de `detail.blocks`) à la place
  de la valeur résolue ; repérage de la valeur résolue par chemin (`updateOutputAt`).

## 5. Vue générique Rendu (renderer, `components/treediff/`)

### 5.1 Structure

```
TreeDiffLayout            grille : colonne Structure | panneaux (N colonnes) ; une rangée par nœud visible
 ├─ StructureColumn       arbre compact (12 px/niveau, plafond 6 niveaux, troncature, marques d'état)
 ├─ RowCell               cellule d'un panneau pour un nœud : valeur, absence hachurée, résumé replié
 └─ ValueRenderer         rendu d'une valeur : générique ou typé (§5.2)
TreeDiffView              diff : 2 panneaux, à partir de diffTree
TreeMergeView             merge : haut (gauche | [ancêtre] | droite) + sortie, 2 TreeDiffLayout synchronisés
```

- Une **seule grille CSS** par groupe (`grid-template-columns: var(--tree-w) repeat(N, 1fr)`) :
  l'alignement des rangées est garanti par la grille, sans mesure JS. La colonne Structure est
  `position: sticky; left: 0`.
- Le défilement vertical du haut et de la sortie (merge) est synchronisé par chemin de nœud
  (`scrollSync.ts`, ancre = `data-path`).
- État de repli partagé (`Set<pathKey>`) entre colonnes et groupes.
- Rangées visibles : nœuds modifiés et leurs ancêtres dépliés par défaut ; les autres repliés. Le
  nombre de rangées reste borné par le nombre de changements ; pas de virtualisation au départ
  (critère 14 mesuré par un test e2e sur 5 000 lignes).

### 5.2 Rendu des valeurs

| Nœud | Générique | Objet typé |
|---|---|---|
| scalaire | texte, mot à mot si modifié (`WordDiffText`) | `status` / `enum` / `multi_enum` par libellé du schéma (`statusLabel`, `scalarLabel`) |
| texte multiligne | `<pre>` mot à mot | `richtext` → `StaticRichTextViewer` (`at`, `diffAgainst`, `changedMedia`) |
| map / list | rangée parent (bande vide ou résumé) | `steps` → un nœud par étape (`alignSteps`), enfants Action / Résultat attendu / Notes |
| libellé (colonne Structure) | clé / identité | libellé du schéma (`diffUnits` → `nodeLabel`) |

`objectUnits.ts` devient `objectLabels.ts` (libellés, ordre d'affichage des clés d'un objet,
nœuds masqués) ; `ObjectDiffView`, `StepsDiff`, `RenderedObjectPane`, `ConflictCard` sont retirés.
`DiffValue` est réduit au rendu d'une valeur (utilisé par `ValueRenderer`).

### 5.3 Édition de la sortie (merge)

- Scalaire générique : champ texte en place ; la valeur garde son type YAML si elle se relit
  identique (`42` reste nombre), sinon chaîne.
- Objet typé : widgets de l'éditeur (`DynamicField`, `StepsTable` pour une étape) comme aujourd'hui.
- Toute édition → `updateOutputAt(text, path, value)` ; le texte reste la source de vérité.

### 5.4 `.drawio`

`DrawioFileDiffView` reçoit la colonne Structure (une rangée par page) et la navigation ; en merge,
`TreeMergeView` affiche les pages avec choix gauche / droite par page (bloc `page:<id>`).

## 6. Fichiers touchés

- `packages/merge-core/src/*` (nouveaux modules §2.1 ; `index.ts`, `types.ts`, `object.ts`,
  `keyed.ts`, `units.ts` en façade) + tests.
- `packages/types/src/merge-resolution.ts` (`MergeFileKind`, `tree`, `counts`, code de validation).
- `apps/desktop/src/main/services/merge-resolution.service.ts` (kinds, validation, détail).
- `apps/desktop/package.json` (`@codemirror/merge`), `pnpm-lock.yaml`.
- `apps/desktop/src/renderer/index.css`, `tailwind.config.*` (jetons).
- `apps/desktop/src/renderer/components/diffkit/*`, `components/treediff/*` (nouveaux).
- `components/diff/*`, `components/merge/*`, `lib/lineDiff.ts` (retiré), `lib/objectUnits.ts`,
  `lib/diffPrefs.ts`, `components/merge/scrollSync.ts`.
- Panneau Version / liste de résolution : lettres d'état et compteurs (§5.6 spec).
- i18n FR / EN (`i18n/locales/*`).
- e2e : `gh178-*` adaptés aux nouveaux sélecteurs ; nouveaux `gh222-*`.

## 7. Décisions et alternatives rejetées

- **Un moteur paramétré par descriptions** plutôt qu'un merge par type : une seule récursion, les
  cas spéciaux deviennent des données. Rejeté : enrichir `object.ts` / `keyed.ts` au cas par cas.
- **Heuristiques d'identité + surcharges** plutôt qu'une déclaration exhaustive de chaque fichier :
  tout YAML nouveau est couvert sans code.
- **Repli texte pour le YAML non canonique** : la fusion structurelle ne doit jamais effacer un
  commentaire. Rejeté : préserver les commentaires via une bibliothèque YAML « CST » (`yaml` npm) —
  plus lourd, et l'app réécrit déjà ces fichiers sans commentaires.
- **`@codemirror/merge`** pour le Raw : apporte l'algorithme de diff (sans plafond 2 000 lignes),
  surlignage intra-ligne, gouttière, régions repliées, navigation, côte à côte et en ligne.
  Rejeté : écrire un Myers maison + toutes ces vues. Pas de 3 voies dans cette bibliothèque : les
  panneaux de merge restent notre `RawPane` décoré avec sa fonction `diff()`.
- **Grille CSS unique** pour l'alignement arbre / panneaux plutôt que des colonnes défilant
  séparément et synchronisées par mesure : alignement exact, rien à recalculer au redimensionnement.
- **Pas de fusion intra-texte** (spec §3.2).

## 8. Découpage en sprints

| Sprint | Périmètre | Livrable vérifiable |
|---|---|---|
| **1 — Moteur** | §2 et §3 : modules merge-core, descriptions, heuristiques, YAML canonique, arbres aplatis, `.drawio` par page, régions à toute profondeur, `updateOutputAt`, `resolveRegionBoth` ; service (kinds, validation, `tree`, `counts`) | tests unitaires merge-core (existants verts + nouveaux) ; un conflit `schema.yaml` sur deux éléments différents n'est plus listé |
| **2 — Mise en évidence** | §4 : jetons, `@codemirror/merge` (Raw des vues de diff), `rawDiff.ts` (Raw du merge), règle de vue d'ensemble, navigation, actions dans tous les panneaux, gauche / droite / les deux / réinitialiser, liste de fichiers | e2e `gh222-raw-*` ; vues Rendu existantes inchangées |
| **3 — Vue générique : diff** | §5.1, §5.2 en diff : `TreeDiffLayout`, `StructureColumn`, `TreeDiffView`, rendu typé, `.drawio` ; retrait `ObjectDiffView` / `StepsDiff` | e2e `gh178-*` adaptés, `gh222-tree-diff-*` |
| **4 — Vue générique : merge** | §5 en merge : `TreeMergeView`, édition en place, actions en ligne, pages `.drawio` ; retrait `RenderedObjectPane` ; mises à jour SPEC | e2e `gh222-tree-merge-*` ; validation finale |
| **5 — Édition depuis le diff** | §9 : enregistrement d'un fichier du working tree depuis `/diff`, Raw éditable (rétablir un bloc), Rendu éditable (modifier, rétablir, ajouter) | e2e `gh222-diff-edit` ; re-validation |

## 9. Édition depuis la vue de diff (spec §12, sprint 5)

- **Main** : `DiffEditService.saveWorkingFile(repoPath, filepath, text, baseline, workspaceDir?)`
  (`diff-edit.service.ts`), canal `diff:save-working-file` (ajouté à `GRAPH_WRITE_CHANNELS` et à la
  liste blanche du client web, argument repo `[0]`). Résultat `{ ok: true }` ou
  `{ ok: false, reason: 'changed' | 'invalid' | 'unsupported' | 'outside', message?, keys? }` :
  - chemin hors du repo → `outside` ; contenu du disque ≠ `baseline` (le texte chargé) → `changed` ;
  - exigence / test (type résolu, catégorie `requirement` / `test`) : validations du merge (YAML,
    `id` = nom de fichier, type, statut connus) puis **service de l'objet** —
    `requirements.update({ title, fields }, removeNullFields)` + `requirements.transition` si le
    statut change ; `tests.update({ title, status, preconditions, equipment, steps,
    postconditions, fields })`. Les clés gérées par l'app (`history`, `version`,
    `needsRevalidation`, dates) sont ignorées ; une autre clé racine modifiée → `unsupported`
    (avec la liste) : à faire depuis l'éditeur de l'objet ;
  - autre fichier : YAML valide exigé pour un `.yaml`, puis écriture du texte.
- **Renderer** : `FileDiffView` porte le **brouillon** (texte du côté Après) quand le diff est une
  modification locale d'un fichier présent et texte ; bouton « Enregistrer » / `Ctrl+S`,
  `useRegisterTabDirty`, « Recharger » sur `changed`. Le diff (Raw et Rendu) est calculé contre ce
  brouillon.
  - Raw : `MergeView` avec le côté B éditable et `revertControls: 'a-to-b'` (« ← Rétablir » entre
    les colonnes) ; en ligne : `mergeControls` limité à « Rétablir » (rejet du bloc).
  - Rendu : `TreeDiffView` reçoit `edit` (texte, `onChange`) : valeurs éditables côté Après
    (mêmes widgets que la sortie du merge), « ← Rétablir » sur une rangée modifiée / ajoutée /
    retirée, « + Ajouter » sous une liste (copie du dernier élément ou élément vide) et sous un
    mapping (clé saisie). Les modifications passent par `lib/yamlEdit.ts` (chargement, modification
    au chemin de la rangée — éléments retrouvés comme `outputAt` —, réécriture dans le style du
    fichier).
