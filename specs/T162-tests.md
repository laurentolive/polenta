# T162 — Scénarios de test

Tests manuels (pas de suite auto sur ces composants). Projet d'exemple avec un type
d'élément dont l'arbre contient au moins : 2 dossiers de 1er niveau, un sous-dossier, des
éléments à la racine et dans les dossiers, un dossier collapsé, un dossier vide.

## Golden path

### G1 — Case présente et cochée par défaut
1. Ouvrir la Vue Système, un type non-campagne, vue Tableau.
2. Ouvrir ⚙️.
3. **Attendu** : onglet « Tableau » actif, une case **« Afficher les titres des dossiers »**
   au-dessus de la liste des champs, **cochée**.
4. Basculer sur l'onglet « Document » → même case, cochée, état indépendant.

### G2 — Masquer les titres en vue Tableau
1. ⚙️ → onglet Tableau → décocher la case. Fermer ⚙️.
2. **Attendu** :
   - Plus aucune ligne de groupe (dossier) dans le tableau.
   - Tous les éléments de l'arbre sont listés, y compris ceux d'un **dossier collapsé** et
     d'un **sous-dossier**, dans l'ordre de parcours de l'arbre.
   - La colonne « Section » (si visible) affiche toujours `1`, `1.1`, `2`, `2.1`…
   - Le dossier vide ne produit aucune ligne.

### G3 — Indépendance Tableau / Document
1. Titres masqués en Tableau (G2). Passer en vue Document (icône).
2. **Attendu** : la vue Document affiche **toujours** ses titres de section H1–H6.
3. ⚙️ → onglet Document → décocher. **Attendu** : sections retirées, cartes à la suite,
   préfixe numéroté conservé sur chaque carte.
4. Repasser en Tableau : toujours masqué. Recocher en Document : titres Tableau inchangés.

### G4 — Persistance par type / vue / utilisateur
1. Masquer les titres en Tableau pour le type A.
2. Changer de type (combobox) pour le type B → **titres affichés** (défaut, non impacté).
3. Revenir au type A → **titres toujours masqués**.
4. Fermer puis rouvrir le projet → réglage conservé pour le type A.
5. Inspecter `.{githubaccount}.pref` → `fieldVisibility["<node>::<typeA>"].showFoldersExcel === false`.

### G5 — Réinitialiser par défaut
1. Type A, titres masqués en Tableau + quelques colonnes modifiées.
2. ⚙️ → onglet Tableau → « Réinitialiser ».
3. **Attendu** : colonnes revenues au défaut **et** case recochée **et** titres réaffichés.
4. L'onglet Document n'est pas affecté.

### G6 — Drag & drop intra-dossier (Tableau, titres masqués)
1. Type A, titres masqués, aucun filtre actif.
2. Glisser un élément situé dans le dossier X au-dessus d'un autre élément **du même dossier X**.
3. **Attendu** : ligne indicatrice affichée, dépôt accepté, l'ordre change ; « Enregistrer »
   apparaît ; après enregistrement + réaffichage des titres, l'élément est bien à sa nouvelle
   place dans X.

## Cas limites

### L1 — Drag inter-dossiers refusé (titres masqués)
1. Titres masqués. Glisser un élément du dossier X vers un élément du dossier Y.
2. **Attendu** : aucune ligne indicatrice pendant le survol des lignes de Y ; au relâché,
   aucun déplacement, l'arbre est inchangé, pas d'erreur console.
3. Réafficher les titres → le déplacement X→Y redevient possible (drop before/after ou inside).

### L2 — Filtre global actif + titres masqués (Tableau)
1. Titres masqués. Saisir un filtre dans la barre latérale qui matche quelques éléments
   répartis dans plusieurs dossiers.
2. **Attendu** : seule la liste plate des éléments correspondants s'affiche, **aucune** ligne
   de dossier ; le DnD est désactivé (filtre actif, comportement existant).

### L3 — Filtre par colonne (T51) + titres masqués
1. Titres masqués. Ouvrir le filtre d'une colonne, saisir un terme.
2. **Attendu** : liste plate filtrée, pas de ligne de dossier ; combinaison ET avec le filtre
   global respectée.

### L4 — Arbre sans dossier
1. Type dont l'arbre n'a que des éléments à la racine.
2. Basculer la case (cochée/décochée) → **aucune différence visible** (rien à masquer).

### L5 — Rétrocompatibilité pref existante
1. Éditer manuellement `.{user}.pref` : garder un `fieldVisibility["<node>::<type>"]` avec
   seulement `{ excel: [...], word: [...], edit: [...] }` (sans `showFolders*`).
2. Ouvrir le projet sur ce type.
3. **Attendu** : titres **affichés** dans les deux vues, case cochée, aucun crash, la config
   de colonnes existante est bien respectée.

### L6 — Changement de type pendant que ⚙️ est ouvert
1. ⚙️ ouvert, onglet Tableau. Changer de type via le combobox.
2. **Attendu** : la case reflète le réglage du nouveau type (pas de valeur figée de l'ancien).

### L7 — Type campagne
1. Sélectionner un type de catégorie `campaign`.
2. **Attendu** : bouton ⚙️ absent (inchangé) ; pas de régression.

### L8 — Bascule à chaud sans changer de type
1. Vue Tableau affichée, titres visibles, un dossier collapsé.
2. Décocher la case → la liste s'aplatit immédiatement, l'élément du dossier collapsé
   apparaît. Recocher → le dossier réapparaît **toujours collapsé** (l'état collapse n'a pas
   été perdu, juste ignoré pendant le masquage).

## Non-régression

### R1 — Titres affichés = comportement d'avant
Case cochée (défaut) : lignes de groupe Excel collapsables, sections Word H1–H6, chevrons,
split colonne « section » du `GroupRow`, DnD inter-dossiers, renommage inline de dossier —
tout identique à avant T162.

### R2 — Export inchangé
Lancer l'export PDF / Word / Excel : les titres/sections y figurent toujours (le réglage
écran n'impacte pas l'export). `print.requirements.tsx` / `print.tests.tsx` lisent
`prefs?.word` — pas de crash avec le nouveau champ dans l'objet.

### R3 — Config des colonnes toujours fonctionnelle
Cocher/décocher des colonnes, réordonner par DnD d'en-tête, figer des volets : inchangé, et
le fait de changer une colonne ne remet pas les titres à l'état par défaut (les 5 champs du
payload sont tous renvoyés à chaque `setFieldVisibility`).

### R4 — Typecheck / lint
`cd apps/desktop && npx tsc --noEmit -p tsconfig.json` : zéro erreur nouvelle.

## Critères d'acceptation vérifiables

| # | Scénario |
|---|---|
| 1 | G1 |
| 2 | G2 |
| 3 | G3 |
| 4 | G2 (colonne section) + G3 (préfixe Word) |
| 5 | G4 |
| 6 | G5 |
| 7 | G6 + L1 |
| 8 | L2 + L3 |
| 9 | L5 |
| 10 | R4 |
