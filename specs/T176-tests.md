# T176 — Scénarios de test

Réf. : `specs/T176.md`, `specs/T176-design.md`.

Pas de test unitaire dans `apps/desktop` : vérifications **dans l'app** via le driver Playwright
(`.claude/skills/run-desktop`) — `eval` pour lire l'état DOM (élément actif, `selectionStart`, classes,
`getBoundingClientRect`) et `dispatchEvent` de `mousedown`/`click`/`dblclick` aux coordonnées voulues — plus
vérification visuelle (captures). Projet fixture : exigences avec un champ `text` multi-ligne (`- a\n- b`),
un champ `text` avec une référence de paramètre, un champ `richtext` (paragraphe + liste + tableau), un
`enum`, un `multi_enum`, un type de lien, des tests avec étapes, des dossiers.

## 1. Gestes (sprint 1)

| # | Action | Attendu | CA |
|---|--------|---------|----|
| G1 | Clic sur une cellule texte non sélectionnée | Contour de sélection, pas d'éditeur (`document.activeElement` ≠ textarea) | CA1 |
| G2 | 2d clic simple (> 500 ms après) sur la même cellule | Toujours pas d'éditeur | CA1 |
| G3 | Double-clic sur une cellule texte non sélectionnée | `textarea` actif | CA1 |
| G4 | Double-clic : cellules richtext, enum/statut, multi_enum, liens, étapes, nom d'élément | Éditeur / liste / popover / dépliage respectifs | CA1 |
| G5 | Double-clic sur le nom d'un dossier (ligne sans colonne `section`) | Renommage, la ligne ne se replie pas | CA1 |
| G6 | Double-clic sur champ système, `coverageStatus`, repo readonly | Sélection seulement | CA1 |
| G7 | Double-clic sur une référence `{nom}` dans une cellule texte / richtext | Éditeur du paramètre, pas d'édition de cellule | U14 |
| G8 | Double-clic sur un diagramme draw.io rendu | Édition de la cellule | U18 |
| G9 | Double-clic sur un mot d'une cellule | Aucun mot surligné (`getSelection().toString() === ''` avant montage de l'éditeur) | spec §2.1 |
| G10 | 3 lignes sélectionnées (Ctrl+clic), double-clic Statut de l'une, choisir une valeur | Sélection conservée, valeur appliquée aux 3 | CA2 |
| G11 | Clic simple, Shift+clic, Ctrl+clic sur des lignes | Sélection de lignes identique à avant | CA2 |

## 2. F2 (sprint 1)

| # | Action | Attendu | CA |
|---|--------|---------|----|
| F1 | Cellule texte sélectionnée, F2 | Éditeur, `selectionStart === value.length` | CA1 |
| F2 | Cellule richtext sélectionnée, F2 | Éditeur, curseur en fin | CA1 |
| F3 | Cellule Statut / multi_enum / liens / étapes sélectionnée, F2 | Liste / popover / dépliage | CA1 |
| F4 | Aucune cellule sélectionnée, ou cellule système, F2 | Rien | U17 |
| F5 | Focus dans le champ de filtre de colonne, F2 | Rien côté tableau | spec §2.1 |

## 3. Éditeur texte et curseur (sprint 1)

| # | Action | Attendu | CA |
|---|--------|---------|----|
| E1 | Double-clic entre 2 caractères d'une cellule texte mono-ligne | `selectionStart === selectionEnd` = index de ce caractère (±0) | CA4 |
| E2 | Double-clic sur la 2e ligne de `- a\n- b` | Éditeur sur 2 lignes (`textarea.value` contient `\n`), curseur sur la 2e ligne | CA4, CA5 |
| E3 | E2 puis Ctrl+Entrée sans modification | YAML inchangé (`git diff` vide) | CA5 |
| E4 | Entrée / Ctrl+Entrée / Échap / clic extérieur | Nouvelle ligne / valide / annule / valide | CA6 |
| E5 | Nom d'élément : Entrée | Valide (mono-ligne) | CA6 |
| E6 | Capture avant / après double-clic (hauteur max 10, cellule texte 2 lignes) | Même position du texte (diff d'images limité au contour et au curseur) ; `getBoundingClientRect` du 1er caractère identique | CA3 |
| E7 | Double-clic à droite du texte / sous la dernière ligne / cellule vide | Fin de la ligne la plus proche / fin / 0 | CA4 |
| E8 | Double-clic après une référence `{nom}` | Curseur juste après `{nom}` dans la valeur brute | CA4 |
| E9 | Hauteur max 1, double-clic sur un texte tronqué | Tout le texte visible, curseur au caractère cliqué | U13 |
| E10 | Double-clic dans un paragraphe / une liste / une cellule de tableau richtext | Curseur au point cliqué (`editor.state.selection.from` cohérent avec le texte cliqué) | CA4 |
| E11 | Richtext en bas d'écran (la cellule défile à l'entrée en édition) | Curseur toujours au point cliqué | CA4 |
| E12 | Édition en masse : 2 lignes sélectionnées, double-clic texte, modifier, Ctrl+Entrée | Valeur appliquée aux 2 ; Échap restaure chacune | CA2 |

## 4. Réactivité (sprint 2)

| # | Action | Attendu | CA |
|---|--------|---------|----|
| P1 | Profiler : clic sur une cellule d'une ligne déjà sélectionnée | Seules 2 cellules re-rendues ; < 50 ms | CA7 |
| P2 | Profiler : clic sur une cellule d'une autre ligne | Cellules des autres lignes non re-rendues (memo) ; < 50 ms | CA7 |
| P3 | Performance : double-clic → éditeur texte focalisé | < 100 ms | CA7 |
| P4 | Performance : double-clic → éditeur richtext focalisé | < 200 ms | CA7 |
| P5 | Sortie d'édition richtext | Seule la ligne concernée re-rendue | CA7 |

## 5. Non-régression

- R1 — Filtre global et par colonne, colonnes figées, hauteur max (T168/T170), rendu richtext paresseux (T169),
  drag & drop de lignes, menu contextuel, copier/couper/coller/suppr de lignes : inchangés.
- R2 — Vue Word : tooltip « Cliquer pour modifier » et gestes inchangés.
- R3 — `tsc` sans erreur.
