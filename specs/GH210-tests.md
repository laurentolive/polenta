# GH210 — Scénarios de test

Auto = test unitaire (`reflections.gh210.test.ts`, repo git temporaire) ou e2e web (`e2e-web/gh210-reflections.spec.ts`) ;
Manuel = à vérifier dans l'application.

## Calcul

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| R1 | Exigence jamais incluse dans une version released | aucun reflet | Auto |
| R2 | Incluse dans 1.0 released, inchangée | design 1.0 | Auto |
| R3 | Modifiée après la release | pas de design ; validation inchangée | Auto |
| R4 | Validation de 1.0 signée, décision `conforme` | validation « Conforme », version 1.0 | Auto |
| R5 | Validation de 1.1 signée ensuite, `derogation` | validation de 1.1 | Auto |
| R6 | Validation de 1.1 annulée | retour à celle de 1.0 | Auto |
| R7 | Validation encore ouverte sur 1.2 | ignorée | Auto |
| R8 | Exigence sans entrée dans la validation retenue | pas de reflet de validation | Auto |
| R9 | Signature dans un ordre différent des livraisons (1.1 signée avant 1.0) | celle de 1.1 retenue | Auto |
| R10 | Repo sans type version ni validation | aucun reflet, pas d'erreur | Auto |
| R11 | Exigence d'un sous-composant (`objectTypeRef` du composant) | reflets lus dans son repo | Auto |

## Interface

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| I1 | ⚙️ : cocher Design et Validation dans la vue Tableau | colonnes affichées avec « 1.0 » et « Conforme (1.0) » | e2e web |
| I2 | Colonne « Couverture » | libellée « Vérification » | e2e web |
| I3 | Colonnes non cochées | aucun appel `reflections:list` | e2e web |
| I4 | Vue Document, même exigence | reflets affichés | e2e web |
| I5 | Tri et filtre sur la colonne Validation | sur le texte affiché | Manuel |
| I6 | Desktop : clic sur le label de version | page de la version | Manuel |
| I7 | Signature puis annulation dans la vue Validation | colonne mise à jour sans recharger | Manuel |
| I8 | Vue enregistrée avec la colonne Design | colonne restaurée | Manuel |

## Non-régression

- Colonne de couverture : tri, filtre (GH224) et export inchangés.
- Vue Validation : statut de design inchangé.
