# GH178 — Design : diff en mode Rendu

Spec : `specs/GH178.md`. Deux sprints (§6).

## 1. Vue d'ensemble

```
routes/version-diff.tsx ─┐                      ┌─ LineDiffView        (Raw, extrait de l'existant)
routes/diff.tsx (WD)  ───┼─► FileDiffView ──────┼─ ObjectDiffView      (Rendu exigence / test)
routes/diff.tsx (commit)─┘   (bascule, prefs)   └─ DrawioFileDiffView  (Rendu .drawio)
                                                        │
                    StaticRichTextViewer (+ `at`, + `diffAgainst`) ── staticDrawio (+ `at`)
                                                        │
             main : drawio:read / image:read (+ ref), schema:get-at, diffs (+ refs, absences)
```

Les deux routes ne gardent que la récupération des contenus et leur en-tête. Tout l'affichage du
diff passe dans `components/diff/`.

## 2. Main process et API

### 2.1 Lecture d'un fichier à une ref

`SyncService.readFileAt(repoPath, ref, filepath): Promise<Uint8Array | null>`
- `ref === null` : lecture disque (working tree), `null` si le fichier est absent.
- sinon : `git.resolveRef` si ce n'est pas un SHA, puis `git.readBlob({ oid, filepath })`. Renvoie
  `null` si le fichier est absent à cette ref.

Elle sert de base aux trois lectures ci-dessous. Le chemin est relatif au repo ; pour une lecture
disque, il est refusé s'il sort du repo (`path.relative` commençant par `..`), comme les handlers
existants.

### 2.2 Canaux

| Canal | Changement |
|---|---|
| `drawio:read(repoPath, relativePath, ref?)` | 3ᵉ argument optionnel. Absent ou `null` → disque (inchangé) ; sinon blob à la ref, puis `parseDrawioPages`. |
| `image:read(repoPath, relativePath, ref?)` | idem, base64 du blob. |
| `schema:get-at(repoPath, ref)` **nouveau** | `.polenta/schema.yaml` lu à la ref, `yaml.load` + `migrateRootRolesImplements` (même lecture que `readFromDisk`, sans cache disque). Pas de schéma à la ref → `null`. Cache mémoire par `repoPath@sha` (contenu immuable). |
| `sync:diff`, `sync:commit-diff`, `sync:diff-file-between` | la réponse gagne `oldRef: string \| null`, `newRef: string \| null` (SHA effectivement lus, `null` = working tree) et `oldMissing`, `newMissing` (fichier absent de ce côté). `oldContent` / `newContent` restent `''` dans ce cas : le Raw ne change pas. |

Les champs ajoutés au type de réponse sont optionnels pour l'appelant ; seul le nouveau code les lit.

Fichiers : `main/services/sync.service.ts`, `main/services/schema.service.ts`
(`getAt`), `main/ipc/index.ts`, `main/ipc/channels.ts` (si la liste y est tenue),
`web-server/channel-policy.ts` (`schema:get-at` → lecture, `ROOT_ARGS: [0]`),
`packages/api-client/src/{types,ipc-client}.ts`.

Client web : les canaux passent par le même registre. `channel-policy.test.ts` vérifie la table.

### 2.3 Refs par écran

| Écran | Avant | Après |
|---|---|---|
| `/version-diff` | `sha1` | `sha2` |
| `/diff` working tree | `HEAD` (SHA renvoyé) | `null` (disque) |
| `/diff` commit | parent du commit (SHA renvoyé, `null` → fichier absent pour un commit initial) | `commitSha` |

## 3. Renderer

### 3.1 `lib/lineDiff.ts` + `components/diff/LineDiffView.tsx`

`computeLineDiff` (aujourd'hui dupliqué dans les deux routes) et le tableau du diff Raw sont
déplacés tels quels. Le rendu reste identique (critère 2). Les compteurs `+n / −n` restent calculés
dans `FileDiffView` à partir de `computeLineDiff`.

### 3.2 `components/diff/FileDiffView.tsx`

```ts
interface FileDiffInput {
  repoPath: string
  filepath: string
  oldContent: string; newContent: string
  oldRef: string | null; newRef: string | null      // pour les lectures à la ref
  oldMissing?: boolean; newMissing?: boolean
}
```

- `renderKind(input)` : `'drawio'` si `.drawio` ; `'object'` si `.ya?ml` dont l'un des côtés parse
  en objet avec `objectTypeRef` résolu dans le schéma (§3.4) en catégorie `requirement` ou `test` ;
  sinon `null` (pas de bascule).
- Sous-en-tête : nom de fichier, `+n / −n`, bascule Raw / Rendu (segmented control, même style que
  la bascule de `FileResolver`), case « Masquer les inchangés » visible en Rendu seulement.
- Préférences : `lib/diffPrefs.ts` (`polenta:diffMode` = `'raw' | 'rendered'`, défaut `rendered` ;
  `polenta:diffHideUnchanged`, défaut `false`). Lecture et écriture `localStorage` sous `try/catch`,
  sur le modèle de `mergePrefs`.

### 3.3 `components/diff/ObjectDiffView.tsx` — alignement par grille

**Décision** : un seul conteneur défilant, une **grille CSS à deux colonnes** dont chaque rangée est
une unité (cellule Avant, cellule Après). L'alignement et le défilement synchronisé viennent du
DOM, sans mesure ni `scrollSync`.

*Alternative rejetée* : deux `RenderedObjectPane` côte à côte avec `useScrollSyncGroup`. Les
hauteurs d'unités diffèrent d'un côté à l'autre (texte plus long, diagramme), donc l'alignement
dériverait. Il faudrait aussi désactiver tout le code de conflit et d'édition, et
`RichTextViewer` (Tiptap) ne permet pas le marquage mot à mot du DOM.

Contenu :
1. Liste ordonnée des unités (`lib/objectUnits.ts`, partagé et testé) : `title`, `status`,
   `preconditions`*, `fields.<schéma>` dans l'ordre du schéma, `fields.<hors schéma>`, `steps`*,
   `postconditions`* (*test), puis les autres racines. On exclut `id`, `projectId`, `branchId`,
   `objectTypeRef` et `history`. Unités prises dans l'union des deux côtés.
2. Changement : `changedUnits(before, after)` de `@polenta/merge-core` (base = Avant). Une unité est
   absente d'un côté si `unitValue` vaut `undefined`.
3. Rangée : libellé de l'unité sur toute la largeur, puis deux cellules. Si l'unité est modifiée :
   fond `bg-status-danger-bg` à gauche et `bg-status-success-bg` à droite. Si elle est absente
   d'un côté : « — absent ».
4. « Masquer les inchangés » : les rangées inchangées consécutives sont repliées en une rangée
   « n champs inchangés » (bouton qui déplie le groupe).
5. En-têtes de colonnes collants : `Avant · <ref courte>` / `Après · <ref courte | working tree>`.
6. Fichier absent d'un côté : la colonne affiche « Fichier absent de cette version » une seule fois
   (en tête). Toutes les unités de l'autre côté sont marquées.
7. YAML illisible d'un côté : message « Rendu indisponible pour ce contenu — voir Raw » à la place de
   la grille.

Rendu d'une valeur (`components/diff/DiffValue.tsx`) :
- `richtext`, préconditions, postconditions → `StaticRichTextViewer` avec `at` et, si l'unité est
  modifiée, `diffAgainst` (§3.5).
- `text`, titre → `<p>` avec segments mot à mot (§3.5, version texte brut).
- `enum` / `multi_enum` → libellés `values` du schéma (`labels` s'il existe dans le type, sinon
  valeur brute) ; statut → `statuses[].label`.
- `steps` → `StepsDiff` (§3.6).
- autre (objet, liste, inconnu) → YAML brut (`yaml.dump`), comme `RawValue` de la résolution.

`RenderedObjectPane` n'est pas modifié. Les petites fonctions pures communes (`statusLabel`,
`toDrafts`) sont déplacées dans `lib/objectUnits.ts` et importées des deux côtés.

### 3.4 Type de l'objet (schéma Après)

`hooks/useSchemaAt(repoPath, ref)` : `ref === null` → `useProjectSchema` ; sinon
`api.schema.getAt`. Résolution de `objectTypeRef` (`getReqTypeDef` puis `getTestTypeDef`) dans cet
ordre : schéma Après, schéma Avant, schéma courant. Un type de composant (`<composant>::type`) se
résout ainsi dans le schéma courant, que `useProjectSchema` assemble.

### 3.5 Diff mot à mot — `lib/wordDiff.ts`

- `tokenize(text)` : mots (`\p{L}\p{N}_` et ponctuation interne `'-.`), espaces et ponctuation
  isolée, chacun comme jeton.
- `diffTokens(a, b)` : LCS sur les jetons, en `Uint32Array` comme `computeLineDiff`. Le préfixe et
  le suffixe communs sont retirés d'abord. Au-delà de 4 000 jetons restants d'un côté, on renvoie
  « tout modifié » (garde-fou : l'unité reste marquée, sans détail). Sortie : pour chaque côté,
  les index de jetons `removed` / `added`. Un espace seul entre deux mots changés est rattaché au
  changement, pour éviter le moucheté.
- **Texte brut** : `WordDiffText({ text, other, side })` rend des `<span>` avec
  `<del class="diff-del">` (Avant) ou `<ins class="diff-ins">` (Après).
- **Richtext** : `StaticRichTextViewer` gagne `diffAgainst?: { other: string; side: 'before' | 'after' }`.
  Après le rendu HTML, un effet :
  1. rend `other` avec le même markdown-it dans un `<template>` (DOM inerte : pas de chargement
     d'image ni de viewer) ;
  2. collecte, des deux côtés et dans le même parcours (TreeWalker, mêmes exclusions que
     `highlightTextNodes` : `.static-drawio`, `pre`/`code` inclus), les nœuds texte et leurs
     jetons ;
  3. calcule `diffTokens` et enveloppe les jetons changés de **son** côté dans
     `<del data-diff>` / `<ins data-diff>`, nœud texte par nœud texte (même découpage que
     `highlightTextNodes`).

  Le marquage est nettoyé et reposé quand `html` ou `other` change, comme pour `highlightRegex`.
  Les deux props peuvent coexister ; dans la vue de diff, seul `diffAgainst` est utilisé.
- Styles (`index.css`) : `.diff-del` = `bg-status-danger-bg` + `line-through` ; `.diff-ins` =
  `bg-status-success-bg` ; uniquement des jetons de thème, donc OK en mode sombre.

### 3.6 Étapes — `StepsDiff`

Alignement LCS sur la clé `action + '\u0000' + expectedResult`. Entre deux ancres égales, les
étapes restantes sont appariées par position (étape modifiée en place). Le surplus devient
ajout / retrait. Chaque rangée de la grille contient une étape par côté (ou vide). Une étape
appariée modifiée reçoit le diff mot à mot sur action et résultat attendu. Rendu de cellule :
`StaticRichTextViewer` si la valeur contient du markdown, comme `StepsTable` en lecture
(paragraphes), sinon texte.

### 3.7 Diagrammes et images à la version de la colonne

- `StaticRichTextViewer` gagne `at?: string | null`. **Absent** = comportement actuel (disque).
  `null` = disque aussi. Une ref → `api.image.read(repoPath, src, at)` et
  `renderStaticDrawio(el, repoPath, onDone, at)` → `api.drawio.read(repoPath, path, at)`.
- **Bloc modifié** (`lib/mediaDiff.ts`) : on extrait des deux markdowns la suite des blocs
  `drawio` / `image` (payload JSON des fences), alignés par LCS sur leur `path`. Un bloc est
  modifié si :
  - il est ajouté ou retiré ;
  - son payload diffère (`nodeId`, taille, rognage) ;
  - le contenu référencé diffère : pour un drawio, XML de la page ciblée (`resolveDrawioTarget`)
    lue aux deux refs ; pour une image, base64 aux deux refs.

  Le calcul est asynchrone (`useQuery` par paire de refs et de chemins, cache React Query).
  Résultat : un `Set` d'index de blocs modifiés par côté, passé au viewer
  (`changedMedia?: Set<number>`). Le viewer ajoute la classe `diff-media-del` / `diff-media-ins`
  (cadre `outline` 2 px aux couleurs danger / success) au n-ième placeholder `.static-drawio` /
  `img[data-static-img-src]`.
- Une unité richtext dont seul un diagramme référencé a changé est **marquée modifiée** même si sa
  valeur YAML est identique. `ObjectDiffView` fusionne pour cela `changedUnits` et les unités dont
  `changedMedia` n'est pas vide.

### 3.8 `components/diff/DrawioFileDiffView.tsx`

- Pages des deux côtés : `api.drawio.read(repoPath, filepath, oldRef)` / `(…, newRef)`. Côté
  absent → « Fichier absent de cette version ». `null` ou fichier illisible → « Rendu indisponible »
  dans cette colonne.
- Alignement par **nom de page** (puis par `id` en repli si les noms sont dupliqués). Même grille
  que §3.3 : une rangée par page, titre = nom de la page, page modifiée si son `xml` diffère.
- Rendu de chaque page : nouveau `renderDrawioPage(el, pages, pageIndex)` dans `staticDrawio.ts`.
  Il factorise la partie « monter le viewer sur un XML déjà lu » de `renderStaticDrawio`, sans
  relecture du fichier. Montage paresseux par IntersectionObserver, comme le viewer richtext, et
  même teardown (GH117).
- Masquer les inchangés : identique à §3.3.

### 3.9 Routes

- `version-diff.tsx` : garde la sélection (contexte `CompareRefs`) et passe la réponse de
  `diffFileBetween` à `FileDiffView`.
- `diff.tsx` : garde `ViewHeader` (titre, retour) et passe la réponse de `diff` ou de
  `commitDiff` à `FileDiffView`. Le compteur `+n / −n` quitte `subtitle` pour le sous-en-tête de
  `FileDiffView`, partagé par les trois écrans.

### 3.10 i18n

Clés `diffView.*` (fr, en) : `raw`, `rendered`, `hideUnchanged`, `unchangedCount`,
`before`, `after`, `workingTree`, `absentFile`, `absentUnit`, `renderUnavailable`, `page`.

## 4. Fichiers

| Fichier | Sprint | Changement |
|---|---|---|
| `main/services/sync.service.ts` | 1 | `readFileAt` ; `diff` / `commitDiff` / `diffFileBetween` renvoient refs + absences |
| `main/services/schema.service.ts` | 1 | `getAt(repoPath, ref)` |
| `main/ipc/index.ts` | 1 | `drawio:read` / `image:read` + `ref` ; `schema:get-at` |
| `web-server/channel-policy.ts` (+ test) | 1 | `schema:get-at` |
| `packages/api-client/src/{types,ipc-client}.ts` | 1 | signatures |
| `renderer/lib/lineDiff.ts`, `components/diff/LineDiffView.tsx` | 1 | extraction |
| `renderer/lib/diffPrefs.ts` | 1 | préférences |
| `renderer/lib/objectUnits.ts` (+ test) | 1 | liste et ordre des unités, libellés |
| `renderer/hooks/useSchemaAt.ts` | 1 | schéma à une ref |
| `renderer/components/diff/FileDiffView.tsx`, `ObjectDiffView.tsx`, `DiffValue.tsx` | 1 | Rendu objet |
| `renderer/lib/staticRichText.tsx`, `lib/staticDrawio.ts` | 1 (`at`), 2 (`diffAgainst`, `changedMedia`, `renderDrawioPage`) | |
| `renderer/routes/version-diff.tsx`, `routes/diff.tsx` | 1 | branchement |
| `renderer/lib/wordDiff.ts` (+ test) | 2 | diff mot à mot |
| `renderer/components/diff/StepsDiff.tsx`, `WordDiffText.tsx` | 2 | |
| `renderer/lib/mediaDiff.ts` (+ test) | 2 | blocs modifiés |
| `renderer/components/diff/DrawioFileDiffView.tsx` | 2 | Rendu `.drawio` |
| `renderer/index.css` | 2 | `.diff-del`, `.diff-ins`, `.diff-media-*` |
| `renderer/i18n/*` | 1–2 | `diffView.*` |
| `e2e-web/gh178-*.spec.ts` | 1–2 | §`GH178-tests.md` |

## 5. Décisions et alternatives rejetées

- **Grille unique** plutôt que deux panneaux synchronisés (§3.3).
- **Diff mot à mot maison** (LCS) plutôt que la dépendance `diff` (jsdiff). Le besoin tient en
  ~80 lignes, sur le modèle de `computeLineDiff`, et n'ajoute aucune dépendance ni licence.
- **Marquage sur le DOM rendu** plutôt que diff du markdown source : le diff du source marquerait des
  `**`, des `|` de tableau et des fences JSON illisibles. Le diff du texte rendu correspond à ce que
  l'utilisateur lit (spec §2.4). Un changement de mise en forme seule n'a donc pas de marque mot à
  mot, mais l'unité est marquée.
- **`StaticRichTextViewer`** plutôt que `RichTextViewer` (Tiptap) : DOM statique annotable, pas de
  coût d'éditeur, et la lecture à une ref s'y branche à un seul endroit.
- **Ref passée au main** plutôt que contenu lu par le renderer : le décodage `.drawio` (zlib) est
  côté main (`parseDrawioPages`), et le client web n'a pas d'accès disque.
- **Schéma à la ref, repli sur le schéma courant** : reconstruire le schéma assemblé d'un workspace
  multi-repo à une ref n'est pas nécessaire. Les types locaux viennent de `schema.yaml` à la ref, et
  les types de composants du schéma courant.

## 6. Découpage

**Sprint 1 — socle et Rendu objet**
- §2 entier (lectures à la ref, schéma à la ref, refs dans les réponses de diff).
- Extraction Raw (§3.1), `FileDiffView` + bascule + préférences (§3.2), `ObjectDiffView` (grille,
  unités, libellés, absent, Masquer les inchangés, Rendu indisponible) (§3.3–3.4).
- `StaticRichTextViewer` / `staticDrawio` avec `at` : chaque colonne affiche ses diagrammes et images.
- Les trois routes branchées.
- Pas encore de mot à mot (unité marquée en entier), ni de rendu `.drawio` seul (Raw), ni de
  cadre de bloc.

**Sprint 2 — finesse du diff et `.drawio`**
- `wordDiff` + marquage texte et richtext (§3.5), `StepsDiff` (§3.6).
- Blocs média modifiés et unités marquées par contenu référencé (§3.7).
- `DrawioFileDiffView` (§3.8).
- e2e restants, mises à jour SPEC (sprint final).
