# GH224 — Scénarios de test

| # | Scénario | Attendu | Auto |
|---|----------|---------|------|
| 1 | Colonne Couverture visible dans la vue tableau | icône « Filtrer cette colonne » dans l'en-tête | e2e GH224-1 |
| 2 | Filtre `non` | seule l'exigence « Non couvert » reste | e2e GH224-1 |
| 3 | Filtre `couvert` (contient) | « Couvert » et « Non couvert » restent | e2e GH224-1 |
| 4 | Regex `^couvert` | seule « Couvert » reste ; icône en couleur active | e2e GH224-1 |
| 5 | `Échap` | filtre vidé, toutes les lignes reviennent | e2e GH224-1 |
| 6 | Filtre `valid` sur une exigence au statut « Validé » (test passé en campagne) | seule celle-ci reste | manuel |
| 7 | Combinaison avec le filtre global / un filtre sur une autre colonne | ET | manuel (mécanisme T51 inchangé) |
| 8 | Colonne `Étapes` (vue tableau d'un type test) | toujours sans icône de filtre | manuel |
