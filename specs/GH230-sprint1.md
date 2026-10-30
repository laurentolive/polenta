# GH230 — Sprint 1 : conserver l'élément affiché au changement de type de vue

## Fichiers modifiés

- `apps/desktop/src/renderer/components/system/viewAnchor.ts` (nouveau) — lecture du DOM de la vue
  (`viewScroller`, `selectedRowNode`, `firstVisibleNode`) et ordre de repli `scrollCandidates`.
- `apps/desktop/src/renderer/hooks/useScrollToNode.ts` — options `root` (repli), `block`, `behavior`, `ready`.
- `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` — paramètre `top`, `anchorNodeId`,
  `switchView` (REPLACE de la page quittée puis PUSH de la nouvelle).
- `apps/desktop/src/renderer/components/system/SystemView.tsx` — boutons de mode → `switchView`.
- `apps/desktop/src/renderer/components/system/ExcelView.tsx`, `WordView.tsx` — prop `anchorNodeId`,
  `data-view-scroll`, `data-selected` (lignes du Tableau), défilement après rendu complet des lignes.
- `apps/desktop/src/renderer/routes/product.tsx`, `routes/components.tsx` — `top` dans `validateSearch`.
- Tests : `components/system/viewAnchor.gh230.test.ts` (U1), `e2e-web/gh230-view-switch.spec.ts` (E1–E7).

## Comportement implémenté

Conforme à `specs/GH230.md` : référence = ligne sélectionnée du Tableau > cible goto > élément
édité (contour, `item`) ; sinon premier élément affiché, aligné en haut sans contour (`top`).
Précédent / Suivant ramènent à la position (la page quittée reçoit son `top`). Élément non rendu
dans la vue cible : nœud rendu le plus proche (aussi pour le goto d'un clic dans l'arbre).

## Divergences par rapport au design

- Bouton du mode actif : sans effet seulement si le mode est déjà dans l'URL (`view`) ; sans
  `view` (mode par défaut), le clic précise la page comme avant — le scénario GH228 E1 en dépend.
- Revue de code : la bascule est abandonnée si une autre URL est rendue avant le REPLACE ; pas
  d'ancrage pendant la bascule (la vue quittée ne se recale pas) ; dossier déjà ciblé : pas de
  nouveau goto.

## Mises à jour SPEC

- `SPEC-SYSTEM-VIEW.md` §Panel / Sélection (goto T164) : repli sur le nœud rendu le plus proche au
  lieu du no-op.
- `SPEC-SYSTEM-VIEW.md` §Persistance : paramètre `top` dans le tableau ; paragraphe « GH230 — bascule
  Tableau ↔ Document sur le même élément ».
- `SPEC-INDEX.md` : lignes SPEC-SYSTEM-VIEW §global et §Configuration des champs… → GH230.

## Tester manuellement

Projet démo lave-linge, Exigences, fenêtre assez basse pour que le Tableau défile.
1. Tableau défilé à mi-hauteur, bouton Document : le même élément est en haut, sans contour ;
   Précédent : retour au Tableau sur cet élément.
2. Dossier replié dans le Document seulement (replis propres à chaque vue), élément de ce dossier
   en haut du Tableau → Document : le titre du dossier replié est affiché (M1).
3. « Afficher les titres des dossiers » décoché en Document, clic sur un dossier dans l'arbre,
   bascule : le Document se positionne sur son premier élément (M2).
4. Filtre sans résultat, bascule : pas d'erreur (M3).
