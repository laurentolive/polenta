# GH206 — Sprint 1 : contraintes de transition côté main, types et MCP

## Fichiers modifiés

- `packages/types` : `transitions.ts` (nouveau : types, `matchingConditions`, `evaluateTransition`, `transitionRuleIssues`, `renameTransitionRefs`), `field-validators.ts` (nouveau : `isFilled`, `isEarsCompliant` déplacés du main, `validatorError` avec `EARS` et `regex:`), `schema.ts` (`ObjectTypeDefinition.transitions`), `index.ts`.
- Main : `transition-guard.service.ts` (nouveau : `check`, `assert`, `preview`, `TransitionBlockedError`), `traceability.service.ts` (`hasCoverage`), `requirements.service.ts`, `tests.service.ts`, `issues.service.ts` (garde dans `persist`, setter `setTransitionGuard`, `workspaceDir` transmis), `schema.service.ts` (`TRANSITION_INVALID`), `field-checks.util.ts` (ré-export), `container.ts`, `ipc/index.ts` (`transitions:preview`).
- Web : `channel-policy.ts` (`transitions:preview` exposé, `ROOT_ARGS` `[0, 3]`).
- Client : `packages/api-client` (`transitions.preview`).
- MCP : `mcp-server/container.ts`, `update.tools.ts` (contrôle avant écriture, `transitionWarnings`), `bulk-import.tools.ts` (contrôle du statut de création en `dryRun`, `transitionWarnings`).
- Tests : `transitions.gh206.test.ts` (19 tests).

## Comportement implémenté

- Bloc `transitions` contrôlé à chaque enregistrement du schéma, mutations MCP comprises (toutes passent par `save`). Un statut retiré encore cité par une règle est refusé (« statut d'arrivée inconnu »), avec le nom de la règle.
- Contrôle dans le `persist` des trois services : création (toutes les règles vers le statut de création), changement de statut ; rien si le statut ne change pas, ni pour une écriture `raw`. Refus `TRANSITION_BLOCKED: <motifs>` ; notifications dans `transitionWarnings` de l'objet renvoyé, jamais écrites ni indexées.
- `hasCoverageLink` : `TraceabilityService.hasCoverage`, liens et tests de tous les repos du workspace, même règle que la matrice.
- Pré-contrôle `transitions:preview` : un résultat par statut, couverture lue une fois.
- MCP : `update_requirements` / `update_tests` contrôlent le passage sur l'état prévu **avant toute écriture** (même résultat en `dryRun` et au réel, plus d'écriture partielle sur un statut refusé) ; `bulk_import_*` contrôle le statut de création au `dryRun`.

## Divergences avec le design

- **Retrait d'un statut cité** : pas de fonction dédiée côté schéma ; `transitionRuleIssues` le refuse déjà comme statut inconnu. `rulesCitingStatus` reste disponible pour l'éditeur (sprint 2).
- **Recouvrement avec l'existant**, constaté en test : `requiredWhen` (GH195) bloque déjà l'écriture, et l'import en masse refuse déjà un champ `required` vide. `fieldsFilled` apporte surtout le contrôle des champs `required` **non écrits** lors d'un changement de statut (objet ancien), et son niveau. Mettre ces contrôles existants à niveaux reste hors périmètre (spec).
- **`/code-review`** lancé, mais exécuté dans le dépôt principal (`polenta-official`, sur `main`) et non dans le worktree : il a relu le dernier merge, pas ce diff. Ses constats (index, graphe, tags) sont hors de #206. Relecture du diff faite à la main.

## Vérifications

- `pnpm typecheck` : OK.
- Tests unitaires desktop : 1385 OK, dont les 19 de `transitions.gh206.test.ts` (scénarios E1–E10, U1, S1, S2, S4–S8, S11, C1, C2, M1–M3).
- Non couverts ce sprint : S3 (test dans un autre repo), S9 (type de sous-composant), S10 (`raw`) ; I1–I7 au sprint 2.

## Comment tester manuellement

Pas d'écran ce sprint. Via le MCP : déclarer dans `schema.yaml` une règle `to: approved, requires: { hasCoverageLink: block }`, puis `update_requirements` avec `status: approved` sur une exigence sans test : refus `TRANSITION_BLOCKED`, en `dryRun` comme au réel.
