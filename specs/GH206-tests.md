# GH206 — Scénarios de test

Auto = test unitaire (`transitions.test.ts` dans `packages/types`, `transition-guard.gh206.test.ts`,
`schema.service.gh206.test.ts`, outils MCP) ou e2e (`e2e-desktop/gh206`, `e2e-web/gh206`) ; Manuel = à vérifier
dans l'application.

## Évaluateur pur

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| E1 | Type sans `transitions` | aucune condition, quel que soit le passage | Auto |
| E2 | Règle `from: review, to: approved` ; passages review → approved, draft → approved | conditions la première fois, aucune la seconde | Auto |
| E3 | Création (`from` null) vers `approved` | règles avec et sans `from` appliquées | Auto |
| E4 | Même condition `warn` dans une règle, `block` dans une autre | niveau `block` | Auto |
| E5 | Condition `off` | ignorée | Auto |
| E6 | `fieldsFilled` : `required` vide ; `requiredWhen: { status: [approved] }` vide vers `approved` ; même champ vers `review` | motif, motif, aucun | Auto |
| E7 | `validatorsPass` : énoncé non EARS ; énoncé vide non requis ; `regex:^[A-Z]` non respecté | motif, aucun, motif | Auto |
| E8 | `transitionIssues` : catégorie `version`, statut inconnu, `from = to`, `requires` vide, condition non admise (`hasCoverageLink` sur un test), niveau inconnu, doublon | une erreur nommant la règle, chaque fois | Auto |
| E9 | `block` sur une sortie d'approbation (`from: approved`, ou `from` absent vers `draft`) | avertissement D5, pas d'erreur | Auto |
| E10 | `renameTransitionRefs` : `approved` → `valide` | `to: valide` | Auto |

## Écriture (services)

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| S1 | Exigence non couverte, `hasCoverageLink: block`, `transition` → approved | `TRANSITION_BLOCKED`, fichier inchangé | Auto |
| S2 | Lien créé depuis le test (sens test → exigence), puis depuis l'exigence | passage accepté dans les deux sens | Auto |
| S3 | Test couvrant dans un autre repo du workspace, avec `workspaceDir` | passage accepté | Auto |
| S4 | `hasCoverageLink: warn` | écrit ; `transitionWarnings` d'un motif ; rien dans le YAML ni l'index | Auto |
| S5 | Une condition `block` et une `warn` non remplies | refus listant les deux motifs | Auto |
| S6 | Mise à jour du titre avec statut inchangé renvoyé | aucun contrôle | Auto |
| S7 | Création d'un test directement en `approved` avec champ `required` vide, `fieldsFilled: block` | refus | Auto |
| S8 | Issue : `fieldsFilled: block` vers `corrigee` | refus, puis accepté une fois le champ rempli | Auto |
| S9 | Type de sous-composant (schéma du repo propriétaire) | règle appliquée | Auto |
| S10 | Écriture `raw` (renommage de type) | pas de contrôle | Auto |
| S11 | `transitions:preview` | un résultat par statut, statut courant exclu, identique à l'écriture | Auto |

## Schéma

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| C1 | Enregistrer une règle incohérente (E8) | `TRANSITION_INVALID` | Auto |
| C2 | Retirer un statut cité par une règle | refus nommant la règle | Auto |
| C3 | Renommer le statut cité dans l'éditeur, enregistrer | règle migrée | Auto (e2e) |
| C4 | `add_object_type` MCP avec `transitions` invalide | refus, même message | Auto |

## MCP

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| M1 | `update_requirements` `status: approved`, non couverte, `block` : `dryRun`, puis réel | même refus, rien d'écrit | Auto |
| M2 | Même cas en `warn` | `dryRun` et réel renvoient les mêmes avertissements ; écrit au réel | Auto |
| M3 | `bulk_import_requirements` en `approved`, champ requis vide, `block` | entrée en erreur au `dryRun` comme au réel | Auto |
| M4 | `create_issue` avec statut bloqué | `TRANSITION_BLOCKED` | Auto |

## Interface

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| I1 | Éditeur de schéma : ajouter une règle `to: approved`, cocher `hasCoverageLink` | Notification par défaut ; YAML `hasCoverageLink: warn` | e2e desktop |
| I2 | Passer la condition en Blocage, puis retirer la règle | un clic chacun ; YAML à jour | e2e desktop |
| I3 | Menu de statut, vue Tableau, exigence non couverte, `block` | « Approuvé » désactivé avec motif | e2e desktop, e2e web |
| I4 | Même cas en `warn`, choisir « Approuvé » | passage fait, notification listant le motif, sans confirmation | e2e desktop, e2e web |
| I5 | Refus serveur pendant une saisie optimiste (vue Tableau) | message ; la cellule revient au statut réel | e2e desktop |
| I6 | Pages exigence, test, issue ; vue Document ; volet de recherche | mêmes annotations | Manuel |
| I7 | Avertissement D5 dans l'éditeur | affiché sur la condition | Manuel |

## Non-régression

- Suites existantes vertes sans bloc `transitions` (critère 1).
- `requiredWhen` (GH195) et verrou de l'approuvé (GH200) inchangés.
