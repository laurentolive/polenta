# GH230 — Scénarios de test

## Unitaires (`viewAnchor.gh230.test.ts`)

- U1 `scrollCandidates` : nœud en tête, puis ancêtres du plus proche au plus haut, descendants,
  suivants, précédents en sens inverse ; chaque nœud une seule fois ; nœud inconnu → `[id]`.

## E2E (`e2e-web/gh230-view-switch.spec.ts`, projet démo)

- E1 Tableau sans sélection, défilé : l'élément en haut de la grille (premier affiché) est en haut du
  Document après la bascule, sans contour ; URL `view=word&top=<id>`, sans `item`.
- E2 Retour Document → Tableau : même élément en haut de la grille.
- E3 Précédent après E1 : Tableau, URL `top=<id>`, élément en haut ; Suivant : Document, idem.
- E4 Clic simple dans l'arbre sur un élément, défilement ailleurs, bascule : nouvelle vue avec
  contour sur l'élément, URL `item=<id>`.
- E5 Tableau, clic sur une ligne (sélection), bascule : Document avec contour sur cet élément.
- E6 Édition d'un élément → bouton Document : élément encadré, `item=<id>`.
- E7 Clic sur le bouton du mode actif : URL et historique inchangés.
- E8 Section cliquée dans l'arbre aussitôt après une bascule (ancrage `top` posé) : `top` retiré,
  la section en haut de la vue, sans retour à l'ancrage.

## Manuels

- M1 Référence dans un dossier replié dans la vue cible seulement (replis propres à chaque vue) :
  la vue cible montre le titre du dossier replié.
- M2 « Afficher les titres des dossiers » décoché dans la vue cible, référence = dossier ciblé dans
  l'arbre : la vue cible se positionne sur son premier élément.
- M3 Vue vide (filtre sans résultat) : bascule sans erreur.
