# T176 — Sprint 1 : gestes (double-clic / F2), éditeur texte iso-typographique, curseur au point cliqué

Réf. : `specs/T176.md`, `specs/T176-design.md`, `specs/T176-tests.md`. Travail sur `main`.

## Fichiers modifiés

- `renderer/components/system/excelCellStore.ts` (**nouveau**) — store de la cellule sélectionnée
  (`useSyncExternalStore`), registre d'éditeurs (F2), `useCellGestures` (clic = sélection, double-clic =
  ouverture, pas de sélection de mot native), `refocusGrid`.
- `renderer/components/system/excelCaret.ts` (**nouveau**) — `rawOffsetAtPoint` (`caretRangeFromPoint`,
  références de paramètres comptées sous leur forme brute).
- `renderer/components/system/ExcelTextEditor.tsx` (**nouveau**) — `<textarea>` iso-typographique,
  `field-sizing: content`, touches Entrée / Ctrl+Entrée / Échap / blur.
- `renderer/components/system/ExcelView.tsx` — `NameCell`, `InlineCell`, `RichtextCell`, `FolderNameText`,
  `GroupRow` passés aux gestes T176 ; `LinkCell` et `StepsCell` extraites du rendu de ligne ; `selectedCell`
  remplacé par le store (`ExcelCellStoreContext`) ; F2 dans `handleKeyDown` ; `handleRowSelect` sans effet
  quand la sélection ne change pas ; conteneur marqué `data-excel-grid`.
- `renderer/components/RichTextField.tsx` — prop `initialCaret` (`posAtCoords` au montage).
- `renderer/components/parameters/ParamRefText.tsx` — `data-param-raw`.
- `renderer/i18n/locales/fr.json`, `en.json` — `system.excelView.doubleClickToEdit`.

## Comportement implémenté

- Clic simple = sélection (cellule + ligne) uniquement ; double-clic = édition / liste / popover / dépliage
  pour toutes les cellules éditables (texte, nom, richtext, enum/statut, multi_enum, liens, étapes, nom de
  dossier) ; F2 = idem sur la cellule sélectionnée, curseur en fin. Cellules non éditables : sélectionnables.
- Éditeur texte multi-ligne pour les champs `text` / `textarea` (retours à la ligne conservés), mono-ligne
  pour le nom, les nombres, dates, etc. ; valider sans modification n'écrit rien.
- Même position du texte en lecture et en édition (le `<td>` garde ses classes de lecture + contour).
- Curseur au caractère cliqué (texte, nom, dossier, richtext).
- Après validation / annulation au clavier, le focus revient au tableau (F2 / Échap immédiatement
  réutilisables).

## Divergences par rapport au design

- `refocusGrid` + attribut `data-excel-grid` : ajoutés suite à `/code-review` (le focus tombait sur `body`
  au démontage de l'éditeur, rendant F2 / Échap inopérants sans nouveau clic). Appliqué aussi à la liste
  enum et à la cellule richtext.
- `data-cell-dblclick-ignore` sur le chevron d'un dossier (quand il est dans la cellule du nom) : le
  double-clic sur le chevron replie la ligne comme avant, au lieu de lancer le renommage (`/code-review`).
- Éditeur mono-ligne quand la colonne n'a pas de définition de champ (ex. `status` sans statuts définis) —
  le design prévoyait multi-ligne par défaut (`/code-review`).
- Cellules non éditables (champs système…) désormais **sélectionnables** au clic (contour), conformément à la
  spec (« sélection seulement »), alors qu'elles ne réagissaient pas avant.

## Vérifications

- `tsc` : propre.
- `/code-review` : 3 bugs (voir divergences), corrigés.
- App (build + driver Playwright, projet fixture : champ `text` multi-ligne, richtext avec liste, enum,
  multi_enum, dossier) :
  - G1/G2 : clic puis 2d clic simple → sélection, pas d'éditeur.
  - G3/E1/E2 : double-clic sur « second point » (2e ligne) → `textarea`, valeur `- premier point important\n- second point`, `selectionStart = selectionEnd = 31` (attendu 31), aucun mot surligné (G9).
  - E6 : captures avant / après identiques hors contour (texte immobile).
  - E3 : Ctrl+Entrée sans modification → aucun fichier modifié (`git status` vide).
  - E4 : Entrée insère `\n` ; Échap restaure la valeur.
  - E10 : double-clic dans « item deux » (liste richtext) → curseur dans « item deux » à l'offset 5 (attendu 5).
  - F1 : F2 sur « Mode Eco » → curseur en fin (8/8) ; F2 : F2 sur richtext → fin du contenu.
  - G4 : double-clic Statut → `<select>` ouvert.
  - G5 : double-clic sur le nom du dossier → renommage, curseur à 3, dossier non replié.
  - Focus rendu au tableau après Échap / Ctrl+Entrée (texte et richtext).
- Non vérifiés dans l'app : multi_enum, liens, étapes au double-clic (même mécanisme `useCellGestures`), G7
  (référence de paramètre), G10/E12 (édition en masse), E9 (hauteur max 1), E11 (richtext en bas d'écran),
  chevron de dossier dans la cellule du nom (fixture avec colonne d'action).

## Tester manuellement

1. Vue Excel d'un type avec un champ `text` contenant une liste `- a` / `- b` : clic → contour seulement ;
   double-clic sur la 2e ligne → édition sur 2 lignes, curseur à l'endroit cliqué, texte immobile.
2. Entrée ajoute une ligne, Ctrl+Entrée valide, Échap annule, clic ailleurs valide ; valider sans rien changer
   ne modifie pas le fichier.
3. Double-clic dans un richtext (paragraphe, liste, tableau) → curseur au point cliqué.
4. Sélectionner une cellule puis F2 → édition, curseur en fin ; F2 sur Statut → liste.
5. Double-clic Statut / multi_enum / liens / étapes / nom d'élément / nom de dossier.
6. Sélection multiple (Ctrl+clic), double-clic Statut d'une des lignes → valeur appliquée à toutes.
7. Double-clic sur une référence `{nom}` → éditeur du paramètre.

## Sprint 2

Réactivité (mesures profiler, actions stables, `React.memo`), puis mise à jour SPEC + SPEC-INDEX.
