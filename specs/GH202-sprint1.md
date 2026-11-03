# GH202 — Sprint 1

## Comportement livré

- **Run** : champ `testedConfig`, copie figée construite par le main (`TestedConfigService.resolve`, appelé par
  `TestsService.execute`) : version du repo de la campagne, label, état, commit, `changesAt`, composants récursifs, écarts.
- **Version** : `history.changes`, une entrée par écriture qui change la liste (`HistoryService.stampVersionChanges`).
- **Écran d'exécution** : bloc « Version testée » (`TestedVersionPicker`), saisie obligatoire, reprise de la dernière exécution.
- **Classeur** : format v4, colonnes de la version et des composants, `tested_version_missing`,
  `tested_version_undocumented`. `export` et `preview` reçoivent `workspaceDir`.
- **Consultation** : colonnes de la grille, bloc du run (`TestedConfigView`), mention « a évolué » (`TestedConfigService.drift`).
- **Graphe** : `GraphTestRun.testedConfig`, `polenta.d.ts` régénéré (manifeste v14).

## Fichiers

- Types : `packages/types/src/tested-config.ts`, `test.ts`, `execution-history.ts`, `campaign-execution-sheet.ts`,
  `graph.ts` ; `packages/zod-schemas/src/test.schema.ts` ; `packages/api-client/src/{ipc-client,types}.ts`.
- Main : `tested-config.service.ts`, `tests.service.ts`, `versions.service.ts`, `history.service.ts`,
  `execution-history.service.ts`, `campaign-execution.service.ts`, `graph.service.ts`, `export/campaign-execution{.xlsx,-import}.ts`,
  `container.ts`, `ipc/`, `web-server/channel-policy.ts`.
- Renderer : `components/executions/` (`TestedVersionPicker`, `TestedConfigView`, grille, colonnes), routes d'exécution et de
  consultation, `ExecutionImportModal`, `ExecutionSheetMenu`, locales.

## Divergences avec le design

- **`expected: null`** ajouté : la composition ne prévoyait rien pour ce composant.
- **Écarts imbriqués** conservés sous un parent sans version ou en texte libre (revue de code).
- **Runs d'un composant** : le pré-remplissage les cherche aussi dans les repos des dépendances, l'index du repo de la
  campagne ne les contenant pas après un redémarrage (revue de code).
- `tests:execute` reçoit maintenant `workspaceDir` depuis l'écran d'exécution.

## Limites connues

- `resolve` relit les versions pour chaque instance d'un import : acceptable aux volumes actuels, à mutualiser si un import
  de plusieurs centaines d'instances devient lent.
- Une version dont le montage a été renommé après l'exécution ne se retrouve pas : « version supprimée » dans le détail.

## Mises à jour SPEC

- `SPEC-TESTS.md` §3.2 : `testedConfig`, `id` corrigé, `testCaseVersion` retiré (absent du code) ; §4.5 : format v4.
- `SPEC-REQ-requirements.md` §11.1, §11.4 : `history.changes`, renvoi vers GH202.
- `SPEC-DASHBOARDS.md` : `GraphTestRun.testedConfig`, manifeste v14.
- `SPEC-INDEX.md` : colonnes MAJ et mots-clés.
- `specs/GH191.md` §2.5 : renvoi vers GH202.

## Comment tester

Scénarios manuels de `specs/GH202-tests.md`. Automatiques : `tested-config.gh202.test.ts`,
`export/campaign-execution.gh202.test.ts`, `e2e-desktop/gh202-tested-version.spec.ts` (`pnpm test:e2e:desktop -g GH202`).
