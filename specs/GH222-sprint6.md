# GH222 — Ajouts du retour de validation du 2026-10-29

Spec : `specs/GH222.md` §6 — « Prendre l'ancêtre » (hors scope de GH37, ajouté), « Changer
d'avis », « Annuler / Rétablir ».

## « Prendre l'ancêtre »

Quand l'ancêtre commun est affiché dans la résolution de conflits, chaque bloc en conflit peut
reprendre la version de l'ancêtre :
- Raw : bouton « Prendre l'ancêtre » au-dessus du bloc dans le panneau de l'ancêtre et dans la
  sortie ;
- Rendu : dans la colonne de l'ancêtre et dans la carte de conflit de la sortie.

Un nœud absent de l'ancêtre (ajouté des deux côtés) est retiré de la sortie. Le bloc résolu est
marqué « ✓ Résolu : ancêtre » et se réinitialise comme les autres. Non proposé pour une position
d'arbre d'affichage (`pos:<id>`).

## Changer d'avis

Un bloc résolu propose les autres choix à côté de « Réinitialiser » (sortie Raw et Rendu) ; le
panneau de chaque côté non retenu garde son action (« ← Prendre gauche » à gauche…). Le nouveau
choix remet la région du bloc puis la résout (`choose` dans `FileResolver`).

## Annuler / Rétablir

Historique de la sortie du fichier (`outputHistory.ts`), commun à Raw et Rendu : Ctrl+Z, Ctrl+Y,
Ctrl+Maj+Z, et boutons ↶ ↷ dans la barre d'outils. Chaque choix est une étape ; une frappe
continue dans l'éditeur Raw ou dans un même champ du Rendu (moins d'1 s d'écart) en fait une.
L'éditeur Raw n'a plus son propre historique CodeMirror : ses touches passent par celui-ci. Le
raccourci est pris au niveau du document quand le focus est dans l'éditeur de résolution ou nulle
part (après un clic sur un choix dont le bouton disparaît), sans atteindre le Ctrl+Z de la vue
Système. Une valeur changée de l'extérieur ne remplace plus que la partie modifiée du texte Raw
(curseur et défilement conservés).

## Fichiers modifiés

- `packages/merge-core` : `MergeBlock.base` (fragment de l'ancêtre : entrée, éléments, hunk de
  texte, page `.drawio`), `resolveRegionWith` ;
- `packages/types` : `MergeFileDetail.blocks[].base` ;
- renderer : `blockLocator.ts` (résolu « ancêtre », panneau de l'ancêtre, `choices`),
  `outputHistory.ts`, `RawPane.tsx`, `FileResolver.tsx`, `treediff/TreeMerge.tsx`, i18n.

## Tests

- merge-core : 3 nouveaux (fragment de l'ancêtre, nœud absent de l'ancêtre, hunk de texte) ;
  `blockLocator.test.ts` : bloc résolu avec l'ancêtre, changer d'avis ; `outputHistory.test.ts`.
- e2e `gh222-raw.spec.ts` : « Prendre l'ancêtre » dans la sortie ; changer d'avis depuis la
  sortie et le panneau de gauche, Ctrl+Z / Ctrl+Y hors et dans l'éditeur, bouton Rétablir.
- e2e `gh222-tree-merge.spec.ts` (R1) : changer d'avis en Rendu, Ctrl+Z.
- Corrigé en e2e : afficher l'ancêtre ne reconstruisait pas les boutons de la sortie Raw.
