# GH399 — Sprint 1 (unique) : lien et popup d'une exécution

Spec : `specs/GH399.md` · Design : `specs/GH399-design.md` · Scénarios : `specs/GH399-tests.md`.

## Comportement implémenté

- L'exécution devient une catégorie (`run`) de l'index des liens. Toute la mécanique de GH229 lui
  est acquise : `ElementLink`, ID reconnus dans les richtext, délégation au conteneur, popup unique.
- **Navigation** : page d'exécution si la campagne est ouverte, relecture si elle est close, sinon
  rien.
  - La ligne de l'exécution est relue par `executions:history` avec la cible `{ runId, testId }`.
  - Si la page a changé pendant la lecture, la navigation tardive est abandonnée.
- **Popup** : un en-tête fixe, puis les colonnes de l'onglet Popup de la vue Exécutions
  (`runPopup`), lues par `useGridPrefs`.
- **Emplacements** :
  - colonne Entrée des grilles d'historique ;
  - date dans la vue Validation ;
  - origine d'une issue ;
  - pastille de résultat dans la grille d'une campagne ;
  - richtext.

## Divergences par rapport au design

- **Entrée en attente** : elle garde son bouton vers la page d'exécution. Le design le supprimait
  avec `gestures.open` ; la revue de code a relevé cette régression.
- **Cible `{ runId, testId? }`** : le test est pris dans l'index, plutôt que déduit de l'ID
  d'exécution. Cela couvre un ID d'exécution hors format (revue de code).
- **Rafraîchissement** : seul `['element-nav', 'runs', repo]` est relu sur un changement de
  `test-runs/`, sans tout l'index. `execution-run` est aussi invalidé sur `campaigns/` et sur `*`.
- **Renommage** : `useExecutionGestures` devient `useExecutionCellGestures`, pour ne pas reprendre
  le nom `useCellGestures` déjà utilisé par les grilles.
- **i18n** : la clé `issues.originRuns` est remplacée par `issues.originRunsLabel`.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/execution-history.ts` | cible `{ runId, testId? }`, `RunRef`, `runTestId` |
| `packages/api-client/src/{types,ipc-client}.ts` | `executions.runIds` |
| `main/services/execution-history.service.ts` | cible d'une exécution, `runIds` |
| `main/services/tests.service.ts` | `runsMap` |
| `main/ipc/index.ts`, `web-server/channel-policy.ts` | canal `executions:run-ids` |
| `renderer/lib/executionsRoute.ts` | `canOpenRow`, `runPage` |
| `renderer/contexts/ElementNavContext.tsx` | catégorie `run`, index des exécutions, `follow` asynchrone, `runQueryKey` |
| `renderer/components/element/ElementPreviewPopup.tsx` | renvoi vers `RunPreviewBody` |
| `renderer/components/executions/RunPreview.tsx` | corps de la popup |
| `renderer/components/executions/executionColumnDefs.tsx`, `ExecutionHistoryGrid.tsx`, `ExecutionsView.tsx`, `ExecutionsSection.tsx` | colonne Entrée en lien d'exécution, gestes |
| `renderer/routes/print.executions.tsx` | gestes inertes |
| `renderer/components/validation/ValidationRuns.tsx` | date en lien d'exécution |
| `renderer/components/system/EditView.tsx` | origine d'une issue en liens |
| `renderer/components/campaign/CampaignEntriesGrid.tsx` | pastille de résultat en lien |
| `renderer/hooks/useLiveFileSync.ts` | invalidations |
| `renderer/i18n/locales/{fr,en}.json` | `issues.originRunsLabel`, `executionsView.runLabel` |

## Tests

- **Unitaires** :
  - `execution-history.gh399.test.ts` (U1–U4) ;
  - `lib/executionsRoute.gh399.test.ts` (U5).
- **E2E** : `e2e-web/gh399-run-preview.spec.ts`, 7 tests.
  - Correspondance avec les scénarios :

    | Test | Scénarios |
    |---|---|
    | E1/E8 | E1, E8 |
    | E2 | E2 |
    | E3 | E3, E3b, et l'entrée en attente |
    | E4 | E4 |
    | E5 | E5 |
    | E6 | E6 |
    | E7 | E7 |
  - `gh400-executions` GH400-5 a été adapté : la cellule Entrée est un lien d'exécution, et non
    plus un bouton.

## Vérifications

| Vérification | Résultat |
|---|---|
| `pnpm typecheck` | OK |
| `pnpm test`, lancé avant les corrections | 2074 / 2075. Seul échec : délai dépassé de `sync.service.gh173` U4 sous la charge de la suite (opérations git) ; repassé seul, 22/22 |
| Unitaires ciblés | OK |
| E2E voisins (GH229, GH197, GH400, GH389, GH204, GH271, GH250), avant les corrections | 37 passés, 2 échecs |
| E2E après les corrections : GH399, GH400 et `gh389-excel-keyboard` | 16 passés |
| Suite e2e complète (niveau 3) | non lancée : elle attend le « Validé » |

Les deux échecs e2e d'avant les corrections :
- GH400-5 : attendu, le test a été adapté (cellule Entrée devenue un lien) ;
- `gh389-excel-keyboard` : passe seul, échec dû à la charge à 4 workers.

## Mises à jour SPEC

- `SPEC-SYSTEM-VIEW.md` :
  - § Liens d'élément : nouveau point « Lien d'exécution (GH399) » ;
  - § Vue Exécutions : renvoi depuis l'onglet Popup.
- `SPEC-REQ-requirements.md` :
  - §3.2g : ID d'exécution dans le texte ;
  - §12 : liens de `origin.runs`.
- `SPEC-INDEX.md` : MAJ → GH399 pour REQ §3, REQ §12, SYSTEM-VIEW §global et § Vue Exécutions.

## Issue ouverte

- #404 : une exécution d'un test d'un autre repo met à jour l'index en mémoire du mauvais repo.

## Tester à la main

1. Ouvrir un test qui a des exécutions, section Exécutions : survoler un ID d'entrée (popup), puis
   cliquer dessus (page d'exécution ou relecture). Une exécution remplacée a la popup mais
   n'ouvre rien.
2. Vue Exécutions, 👁, onglet Popup : cocher un champ, puis survoler une exécution n'importe où.
3. Fiche d'une campagne : survoler la pastille de résultat.
4. Issue créée depuis une exécution : les exécutions à l'origine sont des liens.
5. Écrire un ID d'exécution dans une description ou des notes : il devient un lien.
6. Non automatisé :
   - vue Validation (date d'une exécution) ;
   - client desktop Electron ;
   - exécution d'un test de composant vue depuis le produit.
