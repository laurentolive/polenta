# T169 — Scénarios de test

Tests manuels dans l'application (pas de runner de tests unitaires côté renderer). Données : le
projet `PL/Product`, type Exigences (281 items, 3 champs richtext), et un objet de test
contenant du gras, une liste, un titre, un tableau, une image et un diagramme draw.io.
Vérification statique : `pnpm --filter desktop typecheck` sans erreur nouvelle.

## Nominal — lecture

| # | Scénario | Attendu |
|---|---|---|
| S1 | Vue Excel, hauteur max 10, ouvrir le type | Les cellules richtext visibles sont rendues mises en forme : pas de `**`, `#`, `- ` ni de JSON ` ```drawio `/` ```image `. L'image et le diagramme sont affichés. |
| S2 | Cellule dont le contenu dépasse 10 lignes | Hauteur = 10 lignes, bas estompé. |
| S3 | Cellule courte (1-2 lignes) | Hauteur du contenu seulement, sans estompage. |
| S4 | Hauteur max 1 | Rendu identique à T168 : 1re ligne en texte brut + `¶`. |
| S5 | Passer de 1 à 10 avec le slider, sans défiler | Les cellules visibles passent en rendu mis en forme sans défilement. |

## Nominal — rendu limité aux lignes visibles

| # | Scénario | Attendu |
|---|---|---|
| S6 | Ouvrir PL/Product Exigences et inspecter une ligne bien en dessous du pli (DevTools) | Sa cellule richtext contient encore le texte brut (pas de `.static-drawio` ni de balises `<strong>` rendues). L'ouverture n'est pas plus lente qu'avant de façon perceptible. |
| S7 | Tirer la barre de défilement du haut en bas d'un seul geste, puis relâcher | Pendant le geste, le texte reste brut. ~150 ms après l'arrêt, seules les lignes à l'écran passent en rendu mis en forme. Les lignes du milieu (traversées) restent brutes (DevTools). La 1re ligne visible ne saute pas lors du passage au rendu. |
| S8 | Défilement molette continu | Aucun rendu pendant la rotation, rendu à l'arrêt. |
| S9 | Remonter sur des lignes déjà rendues | Elles restent rendues (pas de re-rendu brut → mis en forme). |
| S10 | Appliquer un filtre qui ramène des lignes lointaines à l'écran (sans défilement) | Ces lignes sont rendues immédiatement. |
| S11 | Déplier un dossier replié (lignes de groupe affichées) | Les nouvelles lignes visibles sont rendues. |

## Nominal — édition en place

| # | Scénario | Attendu |
|---|---|---|
| E1 | Clic sur une cellule richtext, puis second clic | 1er clic : sélection de la cellule. 2e clic : éditeur Tiptap dans la cellule, curseur en fin, **aucune popup flottante**. |
| E2 | Taper de nombreuses lignes | La cellule et la ligne grandissent au-delà de la hauteur max, sans barre de défilement interne. Les autres cellules de la ligne gardent leur hauteur max. |
| E3 | Mettre du texte en gras via la toolbar partagée | Le gras est appliqué dans la cellule et l'édition reste ouverte. |
| E4 | `Ctrl+Entrée` | L'édition est quittée, la cellule revient au rendu mis en forme limité à N lignes et la valeur est persistée (vérifier en Vue Word / dans le YAML). |
| E5 | Clic sur une autre ligne | L'édition est validée et quittée. |
| E6 | Taper, puis `Échap` | La valeur d'origine est restaurée et l'édition quittée. |
| E7 | Insérer une image (sélecteur de fichier natif) | Le dialogue s'ouvre sans quitter l'édition et l'image est insérée dans la cellule. |
| E8 | Insérer un diagramme draw.io via la toolbar | Même comportement : l'édition reste ouverte. |
| E9 | Dans un tableau richtext, clic droit → menu contextuel, choisir « ajouter une ligne » | L'action est appliquée et l'**édition reste ouverte** (le menu est un portail). |
| E10 | Cellule richtext éditée tout en bas de l'écran | À l'entrée en édition, le tableau défile pour montrer le haut de l'éditeur. |
| E11 | Hauteur max 1, éditer une cellule richtext | L'édition se fait dans la cellule agrandie. En sortie, retour au rendu mono-ligne + `¶`. |
| E12 | Éditer une cellule A, puis cliquer (2 clics) sur une cellule richtext B | A est validée, B passe en édition. Il n'y a qu'un éditeur à la fois. |

## Cas limites

| # | Scénario | Attendu |
|---|---|---|
| L1 | Multi-sélection de 3 lignes, édition du richtext de l'une | La valeur tapée s'applique aux 3 lignes (T149). |
| L2 | Même chose puis `Échap` | Chacune des 3 lignes retrouve **sa propre** valeur d'origine. |
| L3 | Sélectionner du texte à la souris dans l'éditeur (glisser) | Le texte est sélectionné, aucun drag de ligne ne démarre. |
| L4 | `Suppr` / `Ctrl+C` / `Ctrl+V` pendant l'édition | Les touches agissent sur le texte, pas sur les lignes du tableau (pas de suppression ni de copie d'élément). |
| L5 | Colonnes figées, cellule richtext figée en édition, puis défilement horizontal | La partie figée et la partie défilante restent alignées en hauteur pendant et après l'édition. |
| L6 | Richtext vide | Lecture : `—` en italique. Édition : éditeur vide. |
| L7 | Bloc ` ```drawio ` au contenu non-JSON | Bloc omis en lecture, sans erreur console. |
| L8 | Filtre de colonne « contient SHALL » actif, éditer une cellule correspondante et effacer « SHALL » | L'éditeur reste ouvert et la ligne reste affichée. En sortie d'édition, la ligne disparaît du tableau filtré. |
| L8b | Pendant l'édition, replier le dossier parent de la ligne éditée (arbre) | L'édition est fermée sans erreur et la valeur saisie est conservée. |
| L9 | Mode Raw de la toolbar pendant l'édition | Un textarea apparaît dans la cellule et la bascule retour resynchronise l'éditeur. |
| L10 | Thème sombre, ligne sélectionnée, survol | L'estompage reste correct (masque indépendant du fond). |
| L11 | Champ richtext en lecture seule (`onInlineEdit` absent) | Rendu mis en forme, pas d'entrée en édition au clic. |

## Non-régression

| # | Scénario | Attendu |
|---|---|---|
| R1 | Édition des champs texte, enum, multi_enum et lien | Comportement inchangé (input/select et popovers multi_enum/lien). |
| R2 | Colonnes `steps` et `coverageStatus`, lignes de dossier | Apparence et comportement inchangés. |
| R3 | Goto depuis l'arbre (T164) sur une ligne lointaine | Scroll et contour corrects. La ligne cible est rendue une fois le défilement programmatique terminé. |
| R4 | DnD de lignes hors édition | Fonctionne comme avant. |
| R5 | Vue Word et Vue Recherche | Rendu richtext inchangé (variante `default`). |
