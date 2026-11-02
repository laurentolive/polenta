# GH229 — Scénarios de test

Spec `specs/GH229.md`, design `specs/GH229-design.md`. U = unitaire (vitest), E = e2e
(`apps/desktop/e2e-web/gh229-*.spec.ts`, démo), M = manuel.

## Nominal

| # | Scénario | Attendu | Type |
|---|---|---|---|
| N1 | Tableau des tests, clic sur un ID de la colonne « vérifie » | vue système Exigences, Tableau, ligne cible sélectionnée et contourée, élément sélectionné dans l'arbre ; Précédent → Tableau des tests | E |
| N2 | Document, clic sur un lien | Document positionné sur la cible | E |
| N3 | Fiche Édition d'un test, clic sur une puce de lien | fiche Édition de la cible | E |
| N4 | Ctrl+clic sur un ID (Tableau) | nouvel onglet sur la page cible ; onglet source : URL, sélection et historique inchangés | E |
| N5 | Survol 500 ms d'un ID | popup avec en-tête + titre ; aucun champ par défaut | E |
| N6 | Cocher Énoncé dans l'onglet Popup du ⚙️ | la popup affiche l'énoncé ; préférence relue après rechargement de la vue | E |
| N7 | `displayIdField: title` sur le type des exigences | liens = titre (infobulle ID Polenta), colonne ID inchangée | E |
| N8 | Campagne : clic sur l'ID d'un test | vue système, mode mémorisé, test sélectionné | E |
| N9 | Richtext « voir SYS-0001 » en lecture | `SYS-0001` lien + popup | E |

## Cas limites

| # | Scénario | Attendu | Type |
|---|---|---|---|
| L1 | `displayIdOf` : champ vide / espaces / nombre / absent | repli ID / repli / `String(n)` / ID | U |
| L2 | `displayIdFieldError` : champ inconnu, richtext, multi_enum, `title`, enum | erreur, erreur, erreur, ok, ok | U |
| L3 | `SchemaService.save` avec `displayIdField` invalide | `DISPLAY_ID_FIELD_INVALID`, rien n'est écrit | U |
| L4 | `splitElementRefs` : `SYS-0001A`, `xSYS-0001`, `SYS-9999` inexistant, `REQ-MC-SW-001`, ponctuation | pas de lien, pas de lien, pas de lien, lien entier, lien | U |
| L5 | markdown-it : ID dans code inline, bloc de code, lien Markdown | texte brut | U |
| L6 | ID introuvable dans une cellule de lien | texte simple, pas de popup | E |
| L7 | Survol < 500 ms puis sortie | pas de popup | E |
| L8 | Pointeur passe du lien à la popup | popup reste ouverte ; sortie des deux → fermée | E |
| L9 | Clic sur ID dans une cellule | pas de sélection de ligne ni édition ; Ctrl+clic n'ajoute pas à la sélection multiple | E |
| L10 | Cible masquée par le filtre texte | message « masqué par le filtre », filtre conservé | E |
| L11 | Lien dans la popup | navigation ; pas de popup imbriquée | M |
| L12 | Lien vers un objet d'un autre repo du workspace | bascule de repo, Précédent revient | M (démo mono-repo) |
| L13 | `objectPage` : `/components` vs `/product`, catégorie, mode | paramètres attendus | U |
| L14 | Éditeur de schéma : supprimer le champ choisi comme ID affiché | `displayIdField` retiré à l'enregistrement | U |

## Critères d'acceptation

Spec §8 : 1 → N1, 2 → N2, 3 → N3, 4 → N8, 5 → N5/L7/L8, 6 → N6, 7 → N7/L2/L3, 8 → N9/L4,
9 → L6, 10 → N1 (#236), 11 → N4 (#236), 12 → L9.
