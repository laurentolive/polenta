# GH222 — Scénarios de test

Spec : `specs/GH222.md` · Design : `specs/GH222-design.md`.
**U** = unitaire (vitest, `merge-core` ou renderer), **E** = e2e client web (`e2e-web/gh222-*.spec.ts`),
**M** = manuel.

## 1. Moteur (sprint 1)

| # | Scénario | Attendu | Type |
|---|---|---|---|
| M1 | Tous les tests `merge-core` existants (U1–U20, F1–F4) | verts, sans modification des attentes | U |
| M2 | `schema.yaml` : statut ajouté à `exigence-systeme` à gauche, libellé de `priority` changé à droite | 0 bloc ; sortie = les deux changements | U |
| M3 | `schema.yaml` : même libellé de champ changé différemment | 1 bloc, clé pointeur `/nodes/@root/objectTypes/@…/fields/@priority/label` | U |
| M4 | YAML générique : liste de mappings avec `id` uniques, éléments ajoutés des deux côtés | union, ordre droite puis gauche après son prédécesseur | U |
| M5 | Liste de scalaires uniques (`testCaseIds`) : ajout différent de chaque côté | union, pas de bloc | U |
| M6 | Liste sans identité : éléments différents modifiés aux deux bouts | fusion `diff3` sans bloc | U |
| M7 | Liste sans identité : même élément modifié différemment | un bloc `range` ; fragments = éléments `- …` au bon retrait ; région retirée → YAML valide | U |
| M8 | Test : étape insérée en position 2 à gauche, étape 4 modifiée à droite | pas de bloc ; `order` renuméroté 1..n | U |
| M9 | Test : même étape modifiée différemment | bloc `steps~<n>` ; les autres étapes fusionnées | U |
| M10 | Campagne : runs ajoutés sur des entrées différentes | union, pas de bloc | U |
| M11 | Campagne : même run (`entryId`) modifié différemment | un bloc `runs~<entryId>` seul | U |
| M12 | Arbre d'affichage : déplacements de deux nœuds différents | pas de bloc, arbre reconstruit | U |
| M13 | Arbre : même nœud déplacé sous deux parents différents | bloc `pos:<id>` ; aucun doublon possible quel que soit le choix | U |
| M14 | Arbre : cycle (A sous B à gauche, B sous A à droite) | bloc `pos` ; sortie résolue sans cycle | U |
| M15 | YAML non canonique (commentaire `#` d'un côté) | kind `text`, `diff3` ligne à ligne, commentaires conservés | U |
| M16 | Fichier Suivi écrit en `lineWidth: -1` | structurel ; sortie au même style (octet pour octet sur la partie non modifiée) | U |
| M17 | `.drawio` : pages différentes modifiées | pas de bloc | U |
| M18 | `.drawio` : même page modifiée | bloc `page:<id>` ; région autour de `<diagram>` entier ; résolue → XML valide | U |
| M19 | Ordre différent des mêmes éléments identifiés des deux côtés | bloc `<chemin>~order` | U |
| M20 | Supprimé d'un côté, modifié de l'autre (nœud profond) | bloc avec fragment vide du côté supprimé | U |
| M21 | `updateOutputAt` sur un chemin profond avec deux régions ouvertes ailleurs | régions intactes, valeur modifiée, dump canonique | U |
| M22 | `resolveRegionBoth` sur une plage de liste / un texte | éléments gauche puis droite / textes concaténés ; refusé pour un scalaire | U |
| M23 | `diffTree` : ajouté / supprimé / modifié / déplacé, `changedCount` des parents | conforme | U |
| M24 | Clé de bloc avec `/`, `~`, `]` dans une identité | échappée (`~1`, `~0`, `~2`) ; marqueurs relus | U |
| M25 | Session : merge de deux branches où seul `schema.yaml` diffère sur des éléments distincts | aucun fichier en conflit, merge direct | U (service) |

## 2. Mise en évidence (sprint 2)

| # | Scénario | Attendu | Type |
|---|---|---|---|
| H1 | Diff Raw d'une exigence (`priority: high` → `low`) en thème sombre | 1 ligne rouge, 1 verte ; seuls `high` / `low` en surlignage caractère | E |
| H2 | Diff Raw d'un fichier de 5 000 lignes, 5 changements | toutes les lignes (pas de troncature) ; 5 marques sur la règle ; régions inchangées repliées ; premier rendu < 1 s | E |
| H3 | `F7` / `Maj+F7` / boutons dans un diff | parcourt les 5 changements, compteur « n / 5 », bloc courant en relief | E |
| H4 | Clic sur une marque de la règle de vue d'ensemble | le changement est en vue | E |
| H5 | Bascule Côte à côte / En ligne | mémorisée après rechargement | E |
| H6 | Absence d'un côté (lignes ajoutées) | zone hachurée alignée en face | E |
| H7 | Merge Raw : panneaux gauche / droite | ce que chaque côté a changé vs ancêtre surligné (ligne + caractère), ancêtre masqué ou non | E |
| H8 | Merge Raw : « Prendre gauche » dans le panneau gauche | la sortie reçoit le fragment gauche ; compteur de conflits −1 | E |
| H9 | Merge Raw : « Prendre les deux » sur une liste / « Réinitialiser » | union dans la sortie / région restaurée | E |
| H10 | `F7` en merge au dernier conflit d'un fichier | propose le fichier suivant à résoudre | E |
| H11 | Liste des fichiers (panneau Version, résolution) | lettre d'état colorée, `+n −m`, conflits restants | E |
| H12 | Contraste des jetons `diff-*` (clair / sombre) | ≥ 4,5:1 texte / fond ; fond de ligne ≠ fond de page | U (calcul sur les valeurs CSS) |

## 3. Vue générique — diff (sprint 3)

| # | Scénario | Attendu | Type |
|---|---|---|---|
| T1 | Diff Rendu d'un `links.yaml` | colonne Structure (liens par `id`), valeurs à la même position X ; lien modifié déplié, autres repliés | E |
| T2 | Diff Rendu d'un dashboard (YAML générique), widget modifié | seul ce widget déplié ; `title` mot à mot | E |
| T3 | Profondeur 8 (YAML générique) | arbre dans 180 px sans défilement horizontal ; indentation plafonnée à 6 niveaux ; X des valeurs identique à la profondeur 1 | E |
| T4 | Redimensionner la colonne Structure, recharger | largeur conservée ; minimum 120 px | E |
| T5 | Exigence : énoncé reformulé (GH178 cas 1) | libellé « Énoncé » dans la Structure ; « 500 ms » barré, « 300 ms » surligné | E |
| T6 | Test : étape insérée (GH178 cas 3) | nœud « Étape 2 » ajouté, hachures en face ; étapes suivantes non marquées | E |
| T7 | Diagramme référencé modifié (GH178 cas 4) | médias à leur version, encadrés | E |
| T8 | Fichier `.drawio` | une rangée par page dans la Structure ; page modifiée encadrée | E |
| T9 | Arbre d'affichage : objet déplacé | nœud aux deux places, « déplacé de / vers » | E |
| T10 | Nœud replié avec descendants modifiés | marque agrégée ; résumé « n éléments, k modifiés » dans les panneaux | E |
| T11 | YAML invalide d'un côté | « Rendu indisponible — voir Raw » ; Raw fonctionne | E |
| T12 | Tests `gh178-*` existants | verts (sélecteurs adaptés seulement) | E |

## 4. Vue générique — merge (sprint 4)

| # | Scénario | Attendu | Type |
|---|---|---|---|
| R1 | Conflit `links.yaml` (spec cas 1) en Rendu | colonne Structure dans le haut et dans la sortie, mêmes nœuds ; « Prendre droite » dans le panneau droit résout | E |
| R2 | Conflit sur un champ scalaire d'un YAML générique | édition en place dans la sortie ; Raw reflète la valeur | E |
| R3 | Exigence en conflit sur `statement` | widgets de l'éditeur dans la sortie ; Raw ↔ Rendu synchronisés | E |
| R4 | Replier un nœud dans le haut | replié aussi dans la sortie ; défilement synchronisé | E |
| R5 | Bloc repris automatiquement | barre latérale de couleur du côté ; forçable vers l'autre côté → « résolu (édité) » | E |
| R6 | `.drawio` en conflit sur une page | choix gauche / droite par page ; Merger actif ensuite | E |
| R7 | Campagne en conflit sur un run | rendu typé (statuts par libellé) ; choix par run | E |
| R8 | Finaliser après résolution en Rendu de fichiers YAML génériques | commit de merge ; contenu = sorties validées | E |
| R9 | Merge GH37 existants (`gh37-*` si présents, sinon scénarios GH37-tests) | inchangés | E / M |
| R10 | FR / EN, clair / sombre, client web | libellés traduits, jetons appliqués | M |
