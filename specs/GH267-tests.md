# GH267 — Scénarios de test

Numéros des critères : `specs/GH267.md` §7. Unitaires dans `validations.gh204.test.ts`, describe « GH267 ».

| # | Scénario | Critère | Type |
|---|---|---|---|
| 1 | La signature écrit la copie dans le commit, avec la seule dernière exécution ; rien dans `history` | 1, 8 | Auto |
| 2 | Lien retiré, nouveau run, test supprimé : lignes identiques | 2 | Auto |
| 3 | Matrice en échec : la page s'ouvre, l'annulation passe, les copies restent | 3 | Auto |
| 4 | Matrice ou historique en échec à la signature : refus, fichier inchangé | 4 | Auto |
| 5 | La version suivante reprend la décision sans la copie | 5 | Auto |
| 6 | Entrée sans copie dans un fichier signé : `outsideSignature`, les autres figées | 6 | Auto |
| 7 | Signée sans aucune copie : `legacy`, lecture directe | 7 | Auto |
| 8 | Graphe : `atSignature` exposée | 8 | Auto |
| 9 | Proposition MCP avec un `atSignature` fourni : ignoré | 9 | Auto |
| 10 | Validation en cours : lecture directe | 10 | Auto |
| 11 | Parcours desktop : après la signature, mention « À la signature » | 1 | e2e `gh204-validation` |

## À vérifier à la main

- Après une signature, retirer le lien d'un test et ajouter un run : le détail garde la ligne figée ; le chevron montre les exécutions actuelles.
- Bandeau et badge « hors signature » : éditer le YAML d'une validation signée pour retirer une copie.
- Mention « signée avant le figeage » : retirer toutes les copies.
