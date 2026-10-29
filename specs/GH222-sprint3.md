# GH222 — Sprint 3 : vue générique en diff

Spec : `specs/GH222.md` §4.1, §4.2 · Design : `specs/GH222-design.md` §5.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `components/treediff/TreeDiffView.tsx` | **nouveau** — colonne Structure (arbre compact, filets de niveau, indentation plafonnée à 6 niveaux, largeur réglable et mémorisée), une rangée par nœud, valeurs alignées (grille CSS unique), absences hachurées, résumé d'un nœud replié, « Masquer les inchangés », déplacements, navigation `F7` et règle de vue d'ensemble, médias des richtexts lus à leur version |
| `components/treediff/presentation.ts` | **nouveau** — présentation générique, et présentation d'un objet typé (libellés et ordre du schéma, nœuds masqués, étapes « Étape N », rendu des statuts / enums / richtexts, `multi_enum` en une valeur) |
| `components/diff/FileDiffView.tsx` | Rendu pour **tout fichier YAML** (vue générique) ; objet typé → présentation typée ; appariement des listes comme au merge (liens, paramètres, objets) |
| `components/diff/ObjectDiffView.tsx`, `StepsDiff.tsx` | **retirés** (remplacés par la vue générique) |
| `components/diff/DiffValue.tsx`, `lib/objectUnits.ts`, `lib/align.ts` | ne gardent que ce que la vue générique utilise (rendu richtext / mot à mot, libellés de statut et d'enum, alignement des pages `.drawio`) |
| `lib/diffPrefs.ts` | largeur de la colonne Structure |
| `packages/merge-core/src/diff-tree.ts`, `object.ts` | index des éléments d'une liste alignée (`indexes`, numéros d'étape) ; un horodatage YAML (`Date`) est un scalaire |
| `i18n/locales/{fr,en}.json` | libellés `treediff.*` |
| `e2e-web/gh222-tree-diff.spec.ts` | **nouveau** — T1–T4, T9–T11 ; `gh178-*` adaptés (rangées d'étapes), `gh222-raw` (bascule Raw explicite : un YAML a désormais un Rendu) |

## Comportement implémenté

- Tout YAML (liens, paramètres, schéma, arbres, requêtes, dashboards, YAML quelconque, y compris
  liste ou scalaire à la racine) s'affiche en Rendu dans la vue générique.
- La profondeur n'est portée que par la colonne Structure ; les valeurs commencent à la même
  position X. Nœuds modifiés dépliés, inchangés repliés (« n éléments, k modifié(s) »).
- Exigences et tests : même vue ; libellés du schéma (« Énoncé », « Priorité »…), statuts et
  enums par libellé, richtexts rendus avec mot à mot et médias à leur version, une rangée par étape
  avec Action / Résultat attendu / Notes. Ancres `data-unit` (`title`, `fields.<nom>`) conservées.
- Arbre d'affichage : un nœud déplacé apparaît à ses deux places (« déplacé vers / depuis »).

## Divergences par rapport au design

- `.drawio` : `DrawioFileDiffView` (une rangée par page, GH178) est conservé tel quel ; la colonne
  Structure n'y est pas ajoutée — les pages sont le seul niveau.
- Pas de `position: sticky` sur la colonne Structure : la grille tient dans la largeur, sans
  défilement horizontal.

## Revue de code

`/code-review` (medium) : 10 constats, corrigés — numéros d'étape d'une liste inchangée ou
ajoutée, horodatage YAML vu comme un mapping vide (`isPlainObject` exclut désormais `Date`, ce qui
vaut aussi pour le merge), Rendu indisponible pour un YAML liste / scalaire / vide, valeur
conteneur affichée en YAML (changement de type), `multi_enum` en liste affiché par libellés,
appariement des listes comme au merge, surlignage de navigation remis à zéro, info-bulle de la
Structure fidèle aux libellés, ensemble « modifié » unique, glisser de redimensionnement nettoyé.

## Tests

- merge-core : 74 (2 nouveaux) ; renderer : 198.
- e2e : `gh222-tree-diff` (7), `gh178-*` (11), `gh222-raw` (6), `gh145`.

## Comment tester manuellement

Panneau Version → comparer deux versions → ouvrir `links/links.yaml`, `.polenta/schema.yaml`, une
exigence, un test : colonne Structure à gauche, valeurs alignées, nœuds modifiés dépliés, `F7`.
Élargir la colonne Structure et rouvrir un fichier : la largeur est conservée.
