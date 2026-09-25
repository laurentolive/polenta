# T171 — Sprint 2 : affichage et insertion des références de paramètres

Réf. : `specs/T171.md` §3–§5, §9 (insertion), §10 (exports exigences et tests) ;
`specs/T171-design.md` §4 ; `specs/T171-tests.md` (Sprint 2). Travail sur `main`.

## Fichiers modifiés

**Types partagés (`packages/types`)**
- `parameter-refs.ts`
  - La grammaire tolère `\_`. Le sérialiseur Markdown de l'éditeur échappe un `_` qui n'est pas
    entouré de lettres, par exemple `{_x}` → `{\_x}`. `unescapeRefPart` normalise ces clés.
  - `maskMarkdownCode` et `parseMarkdownParamRefs` : une référence écrite dans du code Markdown
    (inline ou bloc) n'est ni comptée ni substituée, comme à l'écran.
  - `substituteMarkdownParamRefs` : substitution qui ignore le code.
  - Les fonctions d'extraction (`extractTestParamRefs`, `extractFieldParamRefs`) ignorent
    désormais le code. Cela touche aussi les usages et compteurs du sprint 1.
- `parameter.ts` — `RepoParameters.components` : composants visibles depuis le repo (nom de
  montage → repoPath).

**Main**
- `services/parameters.service.ts` — `list` renvoie `components`.

**Renderer — résolution**
- `contexts/ParamRefContext.tsx` (nouveau)
  - `useParamResolver(repoPath, workspaceDir)` : résolution des références sans contexte React
    (`resolve`, `substitute`, `ready`). Il utilise la même clé de requête que la vue Paramètres,
    donc il est invalidé par ses écritures.
  - `ParamRefProvider` et `useParamRefs()` : résolution pour les rendus, dialogue d'édition et
    sélecteur d'insertion partagés.
- Provider monté dans `SystemView` (Excel, Word, Édition), `routes/search.tsx` (liste et
  édition), `routes/req.$reqId.tsx` et `routes/test.$testId.tsx`.

**Renderer — rendus**
- `lib/markdownParamRefs.ts` (nouveau) : règle markdown-it placée après `text_join`, qui ne
  touche donc ni le code inline ni les blocs de code. Branchée dans `lib/staticRichText.tsx`, qui
  gère aussi le double-clic et laisse le clic simple sur une référence sans effet sur le champ.
- `tiptap/ParamRefDecoration.ts` (nouveau) : décorations ProseMirror, sans nouveau nœud (le
  Markdown stocké reste `{nom}`).
  - En édition : `{nom}` stylé, avec la valeur au survol.
  - En lecture seule : la source est masquée et un widget affiche la valeur.
  - Le double-clic ouvre le paramètre ; la saisie de `{` ouvre le sélecteur.
  - Branchée dans `components/RichTextField.tsx`, qui recalcule les décorations quand les bases
    changent ou qu'on passe de la lecture à l'édition, sans déclencher de sauvegarde.
- `components/parameters/ParamRefText.tsx` (nouveau) : rendu des champs texte simples
  (`text`/`textarea`) des exigences. Utilisé dans `WordView.InlineField`,
  `ExcelView.InlineCell` et `SearchResultsDoc`.
- `index.css` : classes `param-ref`, `param-ref--unresolved` (barrée, couleur d'alerte) et
  `param-ref-source`.

**Renderer — insertion**
- `components/parameters/ParamPicker.tsx` (nouveau) : sélecteur avec recherche sur le nom, la
  valeur, l'unité et le repo, et navigation au clavier. « Créer un paramètre » ouvre le dialogue
  de création puis insère la référence.
- `components/parameters/ParamInsertButton.tsx` (nouveau) : bouton `{x}` dans la barre d'outils
  partagée (`RichTextToolbar`) et dans la barre intégrée de `RichTextField`.
- `ParameterEditDialog` : `onSaved(marked, name)`, pour insérer la référence après une création.

**Exports**
- `lib/exportColumns.ts` — `substituteExportParams(rows, typeDef, substitute)`.
  - Exigences : champs text, textarea et richtext. Tests : preconditions et postconditions.
  - Le code et les références non résolues restent littéraux.
- `SystemView` (payloads docx / xlsx), `routes/print.requirements.tsx`, `routes/print.tests.tsx`
  (PDF).
  - Les paramètres d'impression transmettent `workspaceDir`, pour que les références
    inter-composants soient résolues.
  - L'impression attend que les bases soient chargées.

**i18n** : `parameters.unresolved`, `parameters.picker.*`.

## Divergences par rapport au design

1. **Clic sur une référence** : un clic simple sur une référence n'édite pas le champ ou la
   cellule ; il faut cliquer à côté. Sans cela, le premier clic du double-clic passait le champ
   en édition (trouvé par `/code-review`). En contrepartie, sélectionner une cellule Excel en
   cliquant pile sur une référence ne marche pas.
2. **Pas d'autocomplétion filtrée pendant la frappe** : la saisie de `{` ouvre le même sélecteur
   que le bouton, avec son propre champ de recherche. `@tiptap/suggestion` n'est pas installé.
3. **Grammaire tolérante à `\_` et code ignoré** : ajouts non prévus au design, nécessaires pour
   que l'affichage, les exports et le décompte côté serveur restent cohérents.
4. **Champs personnalisés des tests** : ils ne sont pas rendus avec les valeurs, conformément à
   la spec §3 qui ne les scanne pas.
5. **Détail des étapes** : les exports de tests ne contiennent que le nombre d'étapes, pas leur
   texte. Il n'y a donc rien à substituer de ce côté.

## Vérifications

- `tsc --noEmit` : 0 erreur sur `apps/desktop`, `apps/api` et `apps/web`.
- Script de service du sprint 1 : 25/25 (sans régression après le changement de grammaire).
- Script grammaire et markdown-it : OK, plus des vérifications du masquage du code et de `\_`.
- **App lancée** (build electron-vite + Playwright, projet jetable avec une exigence approuvée,
  une en brouillon et un test approuvé) :
  - Vue Excel et vue Word : `450 W` stylé, avec le nom et la description au survol.
    `{inconnu}` et `{vide}` sont barrés. `` `{puissance_turbo}` `` en code reste littéral.
    Un champ texte (`Objectif`) affiche `>= 450 W`. (S2.1, S2.4, S2.7, S2.16)
  - Double-clic dans Word puis dans une cellule Excel : le dialogue du paramètre s'ouvre avec
    « Utilisé par (2) ». (S2.2)
  - Éditeur d'une exigence en brouillon : `{puissance_turbo}` stylé, valeur au survol. Taper
    `{` ouvre le sélecteur, Entrée insère `{puissance_turbo}`. Le fichier enregistré contient
    `{puissance_turbo}` sans échappement. (S2.8, S2.12)
  - Test approuvé, vue Word : l'étape verrouillée affiche « Puissance >= 450 W ». (S2.9)
- `/code-review` : 2 remarques, toutes deux corrigées.
  1. Double-clic impossible dans les champs éditables (cf. divergence 1).
  2. Les exports substituaient aussi dans le code et dans les champs non textuels. C'est
     désormais limité aux champs texte, hors code, avec la même règle côté serveur.
- **Non vérifié dans l'app** : bouton `{x}` de la barre d'outils, « Créer un paramètre » depuis
  le sélecteur (S2.11, S2.13), référence vers un autre composant et dialogue en lecture seule
  (S2.3, S2.6), changement de branche (S2.14), fichiers exportés docx / xlsx / pdf (S2.15).

## Tester manuellement

1. Dans Paramètres, créer `puissance_turbo` = 450 W.
2. Dans une exigence en brouillon, taper `{` dans l'énoncé → choisir `puissance_turbo`. Le texte
   affiche `{puissance_turbo}` stylé, avec 450 W au survol.
3. Revenir en vue Word ou Excel : « 450 W » est stylé. Double-cliquer dessus → le dialogue du
   paramètre s'ouvre. Passer la valeur à 400 → toutes les vues affichent « 400 W ».
4. Écrire `{inconnu}` → affiché barré. Double-clic → proposition de créer `inconnu`.
5. Bouton `{x}` de la barre d'outils → sélecteur → « Créer un paramètre » → la référence est
   insérée.
6. Exporter en Excel, Word et PDF : mêmes valeurs qu'à l'écran. `` `{x}` `` en code reste
   littéral.
