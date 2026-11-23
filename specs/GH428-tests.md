# GH428 — Scénarios de test

Niveau 1 : tests unitaires ciblés (`npx vitest run <fichier>`). Niveau 2 : suite complète et e2e du ticket.
U = unitaire, E = e2e (`apps/desktop/e2e-web/gh428-run-inputs.spec.ts`).

## Schéma et conversion

| # | Scénario | Attendu | Niveau |
|---|---|---|---|
| S1 | `campaignInput` sur un champ de `runFields` d'un type `text` | aucune erreur `runFieldIssues` | U |
| S2 | `campaignInput` sur un champ de `stepFields` | erreur (liste hors `runFields`) | U |
| S3 | `campaignInput` sur un type `richtext` ou `link` | erreur (type non admis) | U |
| S4 | `campaignInput` absent | aucune nouvelle erreur, comportement inchangé | U |

## Saisie en campagne — `updateRunInputs`

| # | Scénario | Attendu | Niveau |
|---|---|---|---|
| C1 | Saisie d'un nombre `"12,5"` sur un champ `number` | stocké `12.5` dans `runInputs` de l'entrée | U |
| C2 | Clé qui n'est pas un champ `campaignInput` | refus, campagne inchangée | U |
| C3 | Valeur enum hors liste | refus avec le message de conversion, campagne inchangée | U |
| C4 | Valeur vide | la clé est retirée de `runInputs` | U |
| C5 | Entrée retirée (`removedRuns`) | refus | U |
| C6 | Entrée déjà exécutée | saisie acceptée, aucun run modifié | U |

## Exécution — fusion des valeurs d'entrée

| # | Scénario | Attendu | Niveau |
|---|---|---|---|
| X1 | Entrée avec `runInputs`, page envoie les mêmes valeurs | `run.fields` contient les valeurs d'entrée | U |
| X2 | `dto.fields` avec une valeur différente de `runInputs` (import classeur) | la valeur du `dto` est figée dans le run | U |
| X3 | Champ `campaignInput` `required` absent de `runInputs` et de `dto.fields` | refus `required_field_missing`, aucun run écrit | U |
| X4 | Modifier `runInputs` après un run | le run existant reste identique (`run.fields` inchangé) | U |
| X5 | Retest de la même entrée après modification | le nouveau run porte la nouvelle valeur | U |
| X6 | Exécution sans campagne (`campaignEntry` absent) | aucune lecture de campagne, comportement inchangé | U |

## Lectures

| # | Scénario | Attendu | Niveau |
|---|---|---|---|
| R1 | Colonnes de la grille : union des `runFields` des types présents | une colonne `run:<nom>` par champ, libellé du champ | U |
| R2 | Dernier run d'une entrée avec deux runs | valeur du run le plus récent | U |
| R3 | Indication « dernier run » | affichée seulement si `runInputs` diffère du dernier run | U |
| R4 | Page d'exécution, entrée avec `runInputs` | champs d'entrée préremplis et désactivés, les autres saisissables | U (fonction de préremplissage) |

## Classeur Excel

| # | Scénario | Attendu | Niveau |
|---|---|---|---|
| L1 | Export d'une instance en attente avec `runInputs` | colonne d'entrée pré-remplie | U |
| L2 | Import d'un classeur avec une valeur d'entrée | valeur du classeur figée (X2) | U |
| L3 | Import avec cellule d'entrée vide | `runInputs` repris (X1) | U |

## E2E — `gh428-run-inputs.spec.ts`

| # | Étapes | Attendu |
|---|---|---|
| E1 | Créer un type de test avec un `runFields` `campaignInput` (enum) et un résultat ; créer une campagne | la grille affiche la colonne d'entrée |
| E2 | Saisir la valeur dans la grille | la valeur est affichée et persistée dans la campagne |
| E3 | Ouvrir « Exécuter » | le champ d'entrée est prérempli et désactivé ; le champ de résultat reste saisissable |
| E4 | Soumettre le résultat | le run contient la valeur d'entrée dans `fields` |
| E5 | Modifier la valeur d'entrée, réexécuter | nouveau run avec la nouvelle valeur ; l'ancien run inchangé |
| E6 | Grille après E5 | colonne de résultat = dernier run ; indication « dernier run » présente |

## Non-régression

- Suite unitaire complète (`pnpm test`) au niveau 2.
- Les specs e2e existantes sur les champs d'exécution (`gh196-run-fields.spec.ts`) et les entrées de campagne
  (`gh65-campaigns.spec.ts`, `gh389*`) : lancées ciblées au niveau 2 si elles touchent les mêmes écrans.
