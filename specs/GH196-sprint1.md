# GH196 — Sprint 1 : types, contrôle d'écriture, schéma, graphe, éditeur

## Fichiers modifiés

- `packages/types` : `schema.ts` (`runFields` / `stepFields`), `test.ts` (`TestRun.fields`,
  `StepResult.fields`), **`run-fields.ts`** (`convertFieldValue`, `prepareRunFields`,
  `runFieldIssues`, `runFieldReader`), `required-when.ts` (pseudo-champ paramétrable), `graph.ts`
  (`GraphTestRun.fields` / `notes` / `stepResults`, `GraphStepResult`, `GraphObjectType.runFields` /
  `stepFields`) ; `zod-schemas` : `fields` sur le DTO d'exécution et chaque `StepResult`.
- Main : `tests.service.ts` `execute` (contrôle avant écriture, `FieldWriteError`) ;
  `schema.service.ts` (`RUN_FIELD_INVALID` à `save`, `addField` `list`) ; `graph.service.ts` ;
  MCP `add_field` `list`. `polenta.d.ts` régénéré (manifeste v5).
- Renderer : éditeur de schéma (`objectTypeEditor.tsx`, `ElementConfigModal.tsx`) : sections
  repliables « Champs d'exécution » / « Champs d'étape » sur les types de test (`FieldsTable`
  `variant`, sans Hist. / Vis., `requiredWhen` sur `result`) ; i18n.

## Comportement

`TestsService.execute` convertit les saisies (chaînes), refuse clé inconnue / valeur illisible, et
contrôle `required` / `requiredWhen` sur le verdict final (calculé depuis les étapes s'il n'est pas
forcé) ; étape non exécutée sans champ ni obligation. `schema:save` refuse un nom de champ d'exécution
réutilisé avec un autre type ou dans l'autre liste (Q6).

## Tests

`run-fields.gh196.test.ts` (11) ; suite complète verte.
