# GH178 — Sprint 2 : diff mot à mot, étapes, médias, `.drawio`

Spec : `specs/GH178.md` · Design : `specs/GH178-design.md` §6 « Sprint 2 » · Tests :
`specs/GH178-tests.md` · Sprint précédent : `specs/GH178-sprint1.md`.

## Fichiers modifiés

**Renderer**
- `lib/wordDiff.ts` (nouveau) : `tokenize`, `diffTokens` (LCS, préfixe et suffixe communs,
  garde-fou `MAX_DIFF_TOKENS` = 2 000), `wordSegments` (texte brut), `applyWordDiff` /
  `clearWordDiff` (marquage du DOM rendu).
- `lib/align.ts` (nouveau) : `alignByKey` (LCS de clés, appariement positionnel optionnel),
  `alignSteps`, `pageKeys`.
- `lib/mediaDiff.ts` (nouveau) : `mediaBlocks` (fences drawio / image dans l'ordre du rendu),
  `alignMedia`, `changedMedia`.
- `components/diff/useMediaDiff.ts` (nouveau) : lecture du contenu référencé aux deux versions
  (React Query), blocs encadrés par unité richtext.
- `components/diff/StepsDiff.tsx` (nouveau) : étapes alignées, une rangée par étape, mot à mot sur
  action et résultat attendu.
- `components/diff/DrawioFileDiffView.tsx` (nouveau) : Rendu d'un fichier `.drawio` page par page.
- `components/diff/DiffValue.tsx` : `WordDiffText` (titre, champ `text`, propriété texte),
  `RichText` (`diffAgainst`, `changedMedia`) ; le tableau d'étapes du sprint 1 est retiré
  (remplacé par `StepsDiff`).
- `components/diff/ObjectDiffView.tsx` : unités richtext modifiées aussi par leurs médias,
  `StepsDiff` pour l'unité `steps`, valeur de l'autre colonne passée pour le mot à mot.
- `components/diff/FileDiffView.tsx` : bascule pour les `.drawio`, `DrawioFileDiffView`.
- `lib/staticRichText.tsx` : props `diffAgainst` et `changedMedia`.
- `index.css` : `.diff-del`, `.diff-ins`, `.diff-media-del`, `.diff-media-ins` (jetons de thème).
- `i18n/locales/{fr,en}.json` : `diffView.stepNumber`, `page`, `absentPage`, `unchangedPages_*`.

**Tests**
- `renderer/lib/wordDiff.test.ts` : tokenisation, mot à mot, rattachement des espaces, garde-fou,
  `alignByKey`, `alignSteps`, `mediaBlocks` / `changedMedia`, `pageKeys`, fence `null`.
- `e2e-web/gh178-diff-detail.spec.ts` : G4 (mot à mot richtext), G5 (étapes), G8 (fichier
  `.drawio`), G9 (diagramme référencé modifié, YAML identique).

**SPEC** : voir § Mises à jour SPEC.

## Comportement implémenté

- **Mot à mot** : dans un titre, un champ `text` ou un richtext modifié, seuls les mots changés sont
  barrés (colonne Avant) ou surlignés (colonne Après). Le richtext est comparé sur son rendu, pas sur
  le markdown. Un changement de mise en forme seule marque l'unité sans marque de mot.
- **Étapes** : une étape insérée ou supprimée occupe sa propre rangée, et les suivantes ne sont pas
  marquées. Une étape modifiée en place est appariée et reçoit le mot à mot.
- **Médias** : un diagramme ou une image d'un richtext est encadré (rouge / vert) quand il est
  ajouté, retiré ou que sa référence change, ou quand le contenu référencé (page ciblée, image)
  diffère entre les deux versions. L'unité est alors marquée même si son YAML est identique.
- **Fichier `.drawio`** : bascule Raw / Rendu. Le Rendu affiche les pages des deux versions,
  alignées par nom ; page modifiée ou ajoutée encadrée ; « Masquer les inchangés » replie les pages
  identiques ; « Rendu indisponible » pour un côté illisible.

## Divergences par rapport au design

- **Rendu d'une page `.drawio`** : on réutilise `renderStaticDrawio` avec `nodeId` = id de la page,
  sans factoriser un `renderDrawioPage`. Chaque page relit donc le fichier, ce qui est acceptable
  pour un diff (signalé par la revue, non corrigé).
- **Garde-fou du mot à mot** : 2 000 jetons au lieu de 4 000 (table LCS ≤ 16 Mo par colonne).
- **Étape « modifiée »** : jugée sur l'action et le résultat attendu, seuls affichés. Un changement de
  `notes` seul n'est pas marqué dans le Rendu, mais reste visible en Raw.
- **Médias des étapes** : non comparés (la spec ne vise que les richtext des champs, préconditions et
  postconditions).
- **Montage des pages `.drawio`** : immédiat, sans IntersectionObserver (quelques pages par fichier).

## Revue de code (`/code-review`)

Corrigés :
- une fence dont le JSON vaut `null` ne fait plus planter la vue ;
- `pageKeys` applique la même règle aux deux côtés (une page conservée reste appariée quand l'autre
  côté avait un doublon de nom) ;
- garde-fou abaissé à 2 000 jetons ;
- les images littérales (`data:`, `http(s)://`) ne sont plus lues dans le repo ;
- les étapes sont jugées sur ce qui est affiché ;
- le dépliage des pages repliées est mémorisé par clé de page, pas par index ;
- le code mort (tableau d'étapes du sprint 1) est retiré.

Écartés :
- médias dans les étapes (hors spec) ;
- un changement portant uniquement sur des espaces marque l'unité sans marque de mot (rare,
  visible en Raw) ;
- la relecture du `.drawio` par page (coût modéré, voir Divergences).

## Tests automatiques

- `pnpm typecheck` : OK.
- `pnpm test` : OK (desktop 72 fichiers / 805 tests, merge-core 38) avant les corrections de revue ;
  après corrections (renderer seul touché), tests `src/renderer/lib` relancés : 56/56.
- e2e `gh178-diff-rendered.spec.ts` + `gh178-diff-detail.spec.ts` : 11/11.
- Hors ticket, inchangé depuis le sprint 1 : `gh136-status-label` GH136-1 échoue aussi sur `main`
  (option vide ajoutée par GH165).

## Mises à jour SPEC

| Fichier | Section | Modification |
|---|---|---|
| `SPEC-TECH-stack.md` | §2 (ligne merge-core) | Diff mot à mot maison, sans dépendance ajoutée. |
| `SPEC-TECH-stack.md` | §6.5 (nouvelle) | Vues de diff en mode Rendu : lecture à une ref (`readFileAt`, refs des réponses de diff, `drawio:read` / `image:read` + ref, `schema:get-at`), grille, mot à mot sur le DOM rendu, étapes, médias, `.drawio`. |
| `SPEC-ELECTRON-DESKTOP.md` | §19.3 | Ligne `/diff` complétée (`repoPath`, `commitSha`, Raw / Rendu) ; ligne `/version-diff` ajoutée. |
| `SPEC-ELECTRON-DESKTOP.md` | §19.8b | Paragraphe « Vues de diff (GH178) ». |
| `SPEC-REQ-requirements.md` | §3.2a | `StaticRichTextViewer` : `at`, `diffAgainst`, `changedMedia`. |
| `SPEC-FORKS-BRANCHES-BASELINES.md` | §5.6 | Comparaison fichier par fichier en mode Rendu. |
| `SPEC-INDEX.md` | lignes ci-dessus | Description, mots-clés, MAJ → GH178. |

## Tester manuellement (desktop)

1. Exigence dont l'énoncé change d'un mot entre deux commits : vue graphe → commit → fichier. En
   Rendu, seul ce mot est barré à gauche et surligné à droite.
2. Test : insérer une étape au milieu et modifier l'action d'une autre, commiter. L'étape insérée est
   seule sur sa rangée (verte), les suivantes ne sont pas marquées, et l'étape modifiée montre le mot
   changé.
3. Modifier une page d'un `.drawio` dans draw.io et ajouter une page, commiter, ouvrir le `.drawio`
   dans le diff : chaque colonne montre ses pages, la page modifiée et la page ajoutée sont
   encadrées. « Masquer les inchangés » replie les autres.
4. Exigence qui référence ce diagramme (bloc draw.io dans un richtext) : ouvrir son fichier dans le
   diff de ce commit. Chaque colonne montre la page à sa version, le bloc est encadré et l'unité
   marquée.
5. Thème sombre : marques et cadres lisibles.
