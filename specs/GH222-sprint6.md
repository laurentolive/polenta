# GH222 — Ajout : « Prendre l'ancêtre » (retour de validation du 2026-10-29)

Spec : `specs/GH222.md` §6 (l'action « Prendre l'ancêtre », hors scope de GH37, est ajoutée).

## Comportement

Quand l'ancêtre commun est affiché dans la résolution de conflits, chaque bloc en conflit peut
reprendre la version de l'ancêtre :
- Raw : bouton « Prendre l'ancêtre » au-dessus du bloc dans le panneau de l'ancêtre et dans la
  sortie ;
- Rendu : dans la colonne de l'ancêtre et dans la carte de conflit de la sortie.

Un nœud absent de l'ancêtre (ajouté des deux côtés) est retiré de la sortie. Le bloc résolu est
marqué « ✓ Résolu : ancêtre » et se réinitialise comme les autres. Non proposé pour une position
d'arbre d'affichage (`pos:<id>`).

## Fichiers modifiés

- `packages/merge-core` : `MergeBlock.base` (fragment de l'ancêtre : entrée, éléments, hunk de
  texte, page `.drawio`), `resolveRegionWith` ;
- `packages/types` : `MergeFileDetail.blocks[].base` ;
- renderer : `blockLocator.ts` (résolu « ancêtre », panneau de l'ancêtre), `RawPane.tsx`,
  `FileResolver.tsx`, `treediff/TreeMerge.tsx`, i18n.

## Tests

- merge-core : 3 nouveaux (fragment de l'ancêtre, nœud absent de l'ancêtre, hunk de texte) ;
  `blockLocator.test.ts` : bloc résolu avec l'ancêtre, réinitialisation.
- e2e `gh222-raw.spec.ts` : « Prendre l'ancêtre » dans la sortie avec l'ancêtre affiché.
- Corrigé en e2e : afficher l'ancêtre ne reconstruisait pas les boutons de la sortie Raw.
