# GH340 — Scénarios de test

Spec : `specs/GH340.md`, design : `specs/GH340-design.md`.

**Niveaux** : U = unitaire (vitest), E = e2e web (`e2e-web/gh340-*.spec.ts`), M = manuel.

## Écriture (sprint 1)

| # | Scénario | Attendu | Niv. |
|---|---|---|---|
| W1 | Créer une exigence, un test, une issue | Le fichier contient les 4 champs, `createdAt` = `updatedAt`, `by` = acteur de `HistoryService` | U, E |
| W2 | Modifier un champ d'un objet repris | `updatedAt` / `updatedBy` avancent, `createdAt` / `createdBy` inchangés | U, E |
| W3 | Transition de statut | `updatedAt` avance | U |
| W4 | Réenregistrer à l'identique (même DTO) | Fichier identique à l'octet près | U |
| W5 | Commentaire de modification sans changement de champ | Champs d'audit inchangés | U |
| W6 | `needsRevalidation` posé puis levé (transition d'un élément lié) | Champs d'audit inchangés sur l'élément lié | U |
| W7 | `retargetObjectTypeRef` ; `tests.update` avec `objectTypeRef` seul | Inchangés | U |
| W8 | Renommage de champ ou de valeur (`rewriteObjects`), y compris issues | Inchangés, et toujours présents dans le fichier | U |
| W9 | Reprise d'historique GH77 (`updateHistory`) | Inchangés | U |
| W10 | `addRun` / `addDecision` sur une issue | `updatedAt` avance | U |
| W11 | Modification par le MCP | `updatedBy` = `--user`, sinon `local` | U |
| W12 | Objet non repris (sans champs) modifié | `updatedAt` / `updatedBy` écrits, aucune clé `createdAt: null` dans le fichier | U |
| W13 | Enregistrement depuis la vue de diff (`diff-edit` sur un objet) | `updatedAt` avance si le contenu change | U |
| W14 | Garde-fou des chemins d'écriture | Passe ; toute écriture d'objet passe par `persist` / `writeElement` / `fillAuditDates` | U |

## Lecture (sprint 1)

| # | Scénario | Attendu | Niv. |
|---|---|---|---|
| R1 | Construction des index (exigences, tests, issues) | Valeurs lues dans le YAML ; aucun appel de lecture d'historique git (espion sur `GitService`) | U |
| R2 | Champ absent | `null`, affiché « — » | U |
| R3 | Date non quotée dans le YAML (objet `Date` au chargement) | Normalisée en chaîne ISO | U |
| R4 | Lecture à un tag de baseline : fichier avec champs, puis fichier sans champs | Valeurs du fichier, puis `null` ; aucun parcours d'historique | U |
| R5 | Copie `testSnapshot` créée à l'ajout d'un test en campagne | Ne contient pas les 4 champs | U |
| R6 | Mesure : reconstruction des index de handstickProduct après changement de branche | Temps avant et après, notés dans le résumé de sprint | M |

## Fusion (sprint 1)

| # | Scénario | Attendu | Niv. |
|---|---|---|---|
| F1 | Deux côtés modifient des champs différents, `updatedAt` différents | Sans conflit ; `updatedAt` le plus récent avec son `updatedBy` | U |
| F2 | `createdAt` différents (objet repris différemment sur deux branches) | Le plus ancien avec son `createdBy` | U |
| F3 | Un seul côté a les dates | Ce côté | U |
| F4 | Session de résolution GH37 sur un objet en conflit sur `fields.x` | Aucune entrée de conflit sur les champs d'audit | U |

## Reprise (sprint 2)

| # | Scénario | Attendu | Niv. |
|---|---|---|---|
| C1 | Repo dont des objets n'ont pas les champs | `check` renvoie `audit-dates` avec ces fichiers seulement | U, E |
| C2 | Historique avec une branche fusionnée qui modifie un fichier | `updatedBy` = l'auteur du commit de la branche, pas celui de la fusion | U |
| C3 | Fichier créé dans le commit racine | `createdAt` = date de ce commit | U |
| C4 | Fichier ayant déjà `updatedAt` mais pas `createdAt` | Seuls `createdAt` / `createdBy` sont ajoutés | U |
| C5 | Valider | Un commit `[polenta] …` ne contenant que ces fichiers, poussé ; la ligne disparaît | E |
| C6 | Plus tard | Rien n'est écrit ; « — » affiché | E |
| C7 | Arbre de travail modifié | Refus `conformity-dirty`, comme les autres éléments | U |
| C8 | Composant épinglé (HEAD détaché) | Pas de proposition | M |
| C9 | Repo sans objet manquant | Pas d'élément `audit-dates` | U |

## Cas limites

- Fichier YAML invalide : ignoré par l'index (comportement actuel) et par `check`.
- Objet non commité au moment de la reprise : impossible, l'arbre doit être propre (C7).
- Horloge : `updatedAt` est l'heure locale en UTC, à la seconde. Deux écritures dans la même seconde
  donnent la même valeur, ce qui est sans effet.
