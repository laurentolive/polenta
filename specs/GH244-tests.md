# GH244 — Scénarios de test

## Automatiques (`versions.gh244.test.ts`, `issues.gh244.test.ts`)

| # | Scénario | Attendu |
|---|---|---|
| I1 | Créer une issue | ID séquentiel, `issues/<ID>.yaml`, statut initial, historique du statut |
| I2 | Modifier titre, champs et statut | Écrit ; `version` inchangée, aucun verrou même avec un statut `isApproval` |
| I3 | Ajouter une exécution à `origin.runs` | Ajoutée une seule fois |
| S1 | Sauver le premier type issue | `issue-impact` ajouté au schéma |
| S2 | Sauver un second type issue, ou après retrait du type de lien | Pas de doublon, pas de réajout |
| L1 | Lien issue → exigence du composant | Accepté |
| L2 | Lien issue → exigence d'un autre repo, ou de type non déclaré | `NOT_OWN_ELEMENT` |
| V1 | Issue non terminale jamais incluse | Au backlog, incluable |
| V2 | Issue `rejetee` jamais incluse | Hors backlog |
| V3 | Issue incluse, released, puis modifiée | Revient au backlog avec sa base |
| V4 | Issue incluse avec exigence impactée | Exigence racine, `viaIssues`, ses tests proposés ; l'issue n'est pas racine |
| V5 | Issue incluse sans exigence impactée | Ligne de changement, aucune racine, passage released accepté |
| V6 | Issue incluse non commitée | `DIRTY_CHANGES` au passage released |
| V7 | Issue avec un statut `isApproval` modifiée | Pas de signalement « hors interface » |
| G1 | Graphe | Collection `issues` |

## Manuels

| # | Scénario | Attendu |
|---|---|---|
| M1 | Modèle de données : « + Issue » | Type créé avec les statuts par défaut ; lien `issue-impact` présent |
| M2 | Panneau Issues, vues Tableau et Document | Liste, création, édition, colonnes ⚙️ |
| M3 | Fiche d'issue | Exigences impactées ajoutées et retirées ; refus pour un autre composant |
| M4 | Version : backlog, « Ajouter », page, diff | L'issue s'y comporte comme un changement ; lien vers sa fiche |
| M5 | Analyse d'impact | Racine avec « via ISS-… » |
| M6 | Exécution FAIL ou BLOCKED | Popup : Créer, Lier, Ignorer |
| M7 | Exécution PASS, ou composant sans type issue | Pas de popup |
| M8 | Import Excel avec échecs | Bilan avec « Créer une issue » par ligne |
| M9 | Composant en lecture seule | Consultation seule |
| M10 | Couverture | « Vérifié » dans les badges et la matrice |
