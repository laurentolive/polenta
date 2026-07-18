# T42 — Scénarios de test

## Sprint 1 — Insertion, collage, rendu

### Golden path

1. Dans un champ richtext en édition, cliquer le bouton toolbar "Insérer un
   tableau", survoler la grille pour sélectionner 3×3, cliquer → un tableau
   de 3 lignes (dont la 1ère est la ligne d'en-tête) × 3 colonnes apparaît,
   curseur dans la première cellule (le nombre survolé dans la grille est le
   nombre total de lignes, en-tête incluse — convention Word/Google Docs).
2. Taper du texte dans plusieurs cellules, y compris avec du gras/italique →
   le formatage inline s'applique normalement dans les cellules.
3. Quitter le champ (blur) puis y revenir → le tableau et son contenu sont
   restitués à l'identique (round-trip Markdown).
4. Sélectionner une plage de cellules dans Excel (ex. 3×2 avec en-têtes),
   copier, coller dans un champ richtext vide → un tableau structuré
   3 colonnes × 2 lignes apparaît avec le contenu texte des cellules Excel,
   **pas une image**.
5. Le même champ richtext ouvert dans `RichTextViewer.tsx` (lecture seule,
   ex. vue Word) affiche le tableau correctement formaté, sans toolbar ni
   possibilité d'édition.

### Cas limites

- Coller depuis Excel une cellule contenant une formule (ex. `=SOMME(A1:A3)`)
  → seule la valeur affichée/calculée est collée dans la cellule du tableau,
  jamais la formule brute.
- Coller depuis Excel une plage avec des cellules fusionnées → pas de crash,
  pas de perte silencieuse de contenu ; comportement de dégradation observé
  et documenté (répétition de la valeur ou aplatissement, cf. `T42-design.md`
  Décision 1 de `T42.md`).
- Coller un contenu HTML riche accompagné d'une image dans le presse-papiers
  mais **sans** tableau (ex. copie depuis une page web avec juste du texte
  formaté + une image) → toujours géré correctement après le correctif
  `handlePaste` (pas de régression sur le collage HTML existant).
- Coller uniquement une image (capture d'écran sans HTML associé) → comportement
  inchangé, l'image bitmap est bien insérée (pas de régression sur le
  fallback image existant).
- Basculer en mode Raw (markdown brut) sur un champ contenant un tableau →
  le Markdown affiché est du GFM standard lisible (`| a | b |` + séparateur).
  Revenir en mode édité (hors Raw) → le tableau est correctement reparsé (cf.
  Décision 8 du design — sinon documenter la limite exacte si un plugin
  markdown-it s'avère nécessaire et non ajouté).
- Insérer un tableau alors que le curseur est en fin de document / en tout
  début de document → insertion sans erreur, comportement standard TipTap.
- Insérer un tableau dans une liste ou une citation (`blockquote`) → pas de
  crash ; comportement accepté tel que fourni nativement par
  `@tiptap/extension-table` (non spécifiquement testé au-delà de "ne plante
  pas").

## Sprint 2 — Menu contextuel d'édition

### Golden path

6. Clic droit sur une cellule d'un tableau existant (au moins 2 lignes et 2
   colonnes) → un menu contextuel s'ouvre au point du clic, avec : Ajouter
   une ligne au-dessus, Ajouter une ligne en dessous, Supprimer la ligne,
   Ajouter une colonne à gauche, Ajouter une colonne à droite, Supprimer la
   colonne, Supprimer le tableau.
7. Cliquer "Ajouter une ligne en dessous" sur la 2e cellule d'une ligne
   intermédiaire → une nouvelle ligne vide apparaît immédiatement après la
   ligne cliquée (pas à la fin du tableau).
8. Cliquer "Ajouter une colonne à gauche" sur la cellule du milieu → une
   nouvelle colonne vide apparaît immédiatement avant la colonne cliquée.
9. Cliquer "Supprimer la ligne" sur une ligne de données → la ligne disparaît,
   le reste du tableau se réorganise correctement.
10. Cliquer "Supprimer la colonne" → la colonne disparaît proprement, y
    compris la cellule d'en-tête correspondante.
11. Cliquer "Supprimer le tableau" → le tableau entier est retiré du document.
12. Fermer le menu par clic extérieur, puis par `Échap` → les deux méthodes
    ferment le menu sans effectuer d'action.
13. Undo (`Ctrl+Z`) après chacune des actions ci-dessus → annule correctement
    l'action sur le tableau, cohérent avec la pile d'historique standard de
    l'éditeur.

### Cas limites

- Tableau réduit à une seule ligne de données (en plus de l'en-tête) → clic
  droit sur cette ligne : "Supprimer la ligne" est désactivée si elle
  correspondrait à un tableau sans aucune ligne de données restante (état
  invalide), cohérent avec le comportement natif `can()` de
  `@tiptap/extension-table`.
- Tableau réduit à une seule colonne → "Supprimer la colonne" désactivée dans
  les mêmes conditions.
- Clic droit très proche du bord d'une cellule (limite avec la cellule
  voisine) → la position résolue (`posAtCoords` + sélection explicite) cible
  la cellule correcte, pas une cellule adjacente par erreur d'arrondi.
- Clic droit sur une cellule d'en-tête (`th`) plutôt qu'une cellule normale
  (`td`) → le menu s'ouvre également et propose les mêmes actions pertinentes
  (ajout ligne/colonne), sans crash.
- Clic droit en dehors de tout tableau (paragraphe normal) → aucun menu
  tableau ne s'ouvre (le menu contextuel natif du navigateur/Electron
  s'applique, ou aucun menu selon le comportement existant hors tableau —
  pas de régression sur le clic droit hors tableau).
- Menu contextuel tableau ouvert puis clic droit ailleurs dans un autre
  tableau (ou une autre cellule du même tableau) avant fermeture → le premier
  menu se ferme et le second s'ouvre à la nouvelle position, pas de
  superposition de deux menus.

## Critères d'acceptation globaux

Reprendre la liste de `T42.md` § Critères d'acceptation — chaque case cochée
après exécution manuelle des scénarios ci-dessus.
