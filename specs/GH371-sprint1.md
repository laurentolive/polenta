# GH371 — Sprint 1 : entryFields, décisions, ordre des statuts, propriétés du type

## Fichiers modifiés

- `apps/desktop/src/main/services/schema.service.ts` — codes `STATUS_NOT_FOUND`, `STATUS_IN_USE`,
  `STATUS_LIST_INVALID`, `DECISION_NOT_FOUND`, `DECISION_NAME_TAKEN` ; `save` = `assertSaveable` (garde-fous,
  sans écrire) + écriture ; lecture partagée `readValidationEntries` (utilisée par `assertValidationTypeStable` et
  `validationsUsingDecision`) ; `addField` accepte `list: 'entryFields'` ; `addDecision`, `updateDecision`,
  `removeDecision`, `reorderStatuses`, `updateObjectType` ; helpers `idList`, `setOrDelete`, `fieldsCiting`,
  `renamePseudoRefs`.
- `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` — outils `add_decision`, `update_decision`,
  `remove_decision`, `reorder_statuses`, `update_object_type` ; `add_field.list` += `entryFields` ;
  `requireSomeChange` (erreur d'entrée « au moins une propriété »).
- `apps/desktop/src/main/services/schema-mutation.gh371.test.ts` (nouveau) — scénarios A, B, E, F, G1/G2.

## Comportement

Conforme à `specs/GH371-design.md` §5. Chaque outil passe par `withMutationQueue` ; tout refus est levé avant
l'écriture du schéma. Aucun objet n'est réécrit dans ce sprint (renommage d'une décision : seulement si aucune
entrée ne la porte, S1).

## Divergences

Aucune par rapport au design.

## Vérifications

- `pnpm typecheck` : OK.
- `npx vitest run src/main/services/schema-mutation.gh371.test.ts` : 25/25.
- Tests voisins (GH77 `field-rename`, GH195, GH196, GH229, GH362, GH104 `schema-delete`) : 76/76.
- `pnpm test` : merge-core 83/83, admin-service 124 (+3 ignorés), desktop 1888 passés sur 176/177 fichiers ;
  `suivi-corpus.test.ts` non rapporté (« Timeout calling onTaskUpdate » du worker vitest, charge machine) ;
  relancé seul : 6/6.
- `pnpm lint` : pas de configuration ESLint 9 dans `apps/desktop` (non lancé).

## Comment tester à la main

Voir `specs/GH371-tests.md` § H (après le sprint 2).
