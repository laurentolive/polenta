# GH371 — Sprint 2 : statuts avec migration, documentation

## Fichiers modifiés

- `apps/desktop/src/main/services/schema.service.ts` — `updateStatus`, `removeStatus` (sous `withMutationQueue`,
  migration dans la même entrée de file), `writeAndMigrate` (`dryRun` : `assertSaveable` + aperçu ; sinon `save`
  puis `renameValues`), `requireStatus` ; types `SchemaValueMigrator`, `StatusMutationResult`,
  `StatusMutationPreview` ; helper `withStatusRefsRenamed` (transitions + `requiredWhen.status`).
- `apps/desktop/src/main/services/field-rename.service.ts` — `objectIdsWithStatus` ; collecte des objets du type
  factorisée (`typeObjects`), partagée avec `previewValueRenames`.
- `apps/desktop/src/mcp-server/container.ts` — `fieldRename: FieldRenameService` (issues et validations comprises).
- `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` — outils `update_status`, `remove_status`
  (invalidation préalable des index exigences / tests / issues du repo).
- `apps/desktop/src/main/services/schema-mutation.gh371.test.ts` — scénarios C, D, G1/G2 statuts, G4.
- `apps/desktop/src/main/services/agents-md.template.ts` — liste des outils de schéma.
- `specs/SPEC-MCP-SERVER.md`, `specs/SPEC-INDEX.md`.

## Comportement

Conforme à `specs/GH371-design.md` §6 et à la spec (D2, D3, Q1 proposition par défaut). Réponse
`{ schema, migration }` ; `dryRun` → `{ dryRun: true, schema, preview: { withOld, withNew } }` sans écrit.

## Divergences par rapport au design

- Aucune sur le fond. Précision : l'invalidation des index (§6.4) est faite par le handler, avant l'entrée dans
  la file de mutation (comme `freshComponentRepoResolver` des outils versions / validations), pas dans la file.

## Mises à jour SPEC

- `SPEC-MCP-SERVER.md` §4.3 : `add_field` (`list`, `entryFields`), sous-section GH371 (7 outils, réponses,
  `dryRun`, migration, limites), liste complète de `SchemaValidationErrorCode`.
- `SPEC-INDEX.md` : ligne SPEC-MCP-SERVER (résumé, mots-clés, MAJ → GH371).
- Pas de modification de `SPEC-TEMPLATES.md` §3.3 ni de `SPEC-REQ-requirements.md` §13 : le comportement de
  l'application est inchangé, le MCP s'y aligne.

## Limites connues (identiques à l'application)

- Versions (`versions/*.yaml`) ni comptées par `STATUS_IN_USE` ni migrées au renommage / retrait d'un statut
  non marqué du type version (périmètre de `renameValues` de l'éditeur, GH82).

## Comment tester à la main

`specs/GH371-tests.md` § H : depuis un client MCP réel (Claude Code + `.mcp.json`), configurer une validation
(`add_field entryFields`, `add_decision`, `update_status`, `reorder_statuses`), ouvrir le projet dans l'application
et vérifier l'éditeur de type ; renommer un statut porté par des exigences (`dryRun` puis appel réel) et vérifier
statut et historique dans l'application ; vérifier `tools/list` et l'`AGENTS.md` régénéré.
