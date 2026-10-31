# GH196 — Design : champs d'exécution (`runFields` / `stepFields`) et classeur v3

Spec : `specs/GH196.md`. Trois sprints.

## 1. Types (`packages/types`)

- `ObjectTypeDefinition` += `runFields?: SchemaField[]`, `stepFields?: SchemaField[]` (catégorie `test`).
- `TestRun` += `fields?: Record<string, unknown>` ; `StepResult` += `fields?: Record<string, unknown>`.
- `zod` `ExecuteTestCaseSchema` : `fields` (record) sur le DTO et sur chaque `StepResultSchema`.
- Nouveau `run-fields.ts` :
  ```ts
  export const RUN_RESULT_KEY = 'result'
  export type RunFieldList = 'runFields' | 'stepFields'
  export function runFieldReader(defs: SchemaField[], result: string, fields: Record<string, unknown>): FieldValueReader
  export function convertFieldValue(def: SchemaField, raw: unknown): { ok: true; value: unknown } | { ok: false; reason: string }
  export function prepareRunFields(typeDef, run: { result; fields?; stepResults: { order; result; fields? }[] }):
    { ok: true; fields?; stepFields: Map<number, Record<string, unknown> | undefined> } | { ok: false; reason; field; step? }
  export function runFieldIssues(schema-like: { types: ObjectTypeDefinition[] }): RequiredWhenIssue[]   // cohérence + unicité Q6
  ```
  `convertFieldValue` : `number` (virgule décimale acceptée), `boolean` (true/false/oui/non/yes/no/1/0),
  `enum` (valeur dans `values`), `multi_enum` (CSV, valeurs dans `values`), `link` (`normalizeLinkField`),
  `date` / `datetime` / texte : chaîne. Vide → absent.
- `requiredWhen` : moteur #195 réutilisé avec un lecteur dont le pseudo-champ est `result` ;
  `requiredWhenIssues` reçoit en option le pseudo-champ et ses valeurs (`status` + statuts pour un
  type, `result` + verdicts pour une liste de run / d'étape).
- `graph.ts` : `GraphTestRun.fields`, `notes`, `stepResults` ; `GraphObjectType.runFields` / `stepFields`.

## 2. Main (sprint 1)

| Fichier | Changement |
|---|---|
| `tests.service.ts` `execute` | type du test (`readOwnedTypeDef`, repo du test), `prepareRunFields` après calcul du verdict ; refus `FieldWriteError` avant `nextRunId` ; écrit `fields` (run, étapes) |
| `schema.service.ts` | `save()` : `runFieldIssues` (erreurs) ; `addField` : paramètre `list` |
| MCP `schema-mutation.tools.ts` | `add_field` `list: fields \| runFields \| stepFields` |
| `graph.service.ts` | runs : `fields`, `notes`, `stepResults` ; types : `runFields` / `stepFields` ; `polenta.d.ts` régénéré |

## 3. Renderer

**Sprint 1** — éditeur de schéma : `ElementConfigModal` (types de test) : deux sections repliables
« Champs d'exécution » / « Champs d'étape » réutilisant `FieldsTable` avec `variant: 'run' | 'step'`
(sans « Hist. » ni « Vis. », pseudo-champ `result` pour `requiredWhen`, aide « règle de conception »).
`EditableObjectType` += `runFields`, `stepFields`.

**Sprint 2** — page d'exécution `campaign.$campaignId_.execute.$testId.tsx` : état `runFieldValues`,
`stepFieldValues` (chaînes, défauts pré-remplis), `DynamicField` + `requiredNow` (lecteur `result`),
envoi dans `api.tests.execute(..., { fields, stepResults: [{..., fields}] })`, affichage de l'erreur.
Consultation `campaign.$campaignId_.run.$testId.tsx` : bloc `RunFieldValues` (lecture, `LinkList`,
« hors schéma », ⚠ valeur d'enum inconnue).

**Sprint 3** — classeur v3 :
- `campaign-execution-sheet.ts` : `EXECUTION_SHEET_FORMAT_VERSION = 3`, supportées `[1, 2, 3]` ; type
  `ExecutionSheetFieldColumn { id: 'run:<name>' | 'step:<name>'; list; name; label; type; values?; required; requiredWhen? }`.
- `campaign-execution.xlsx.ts` : le modèle porte `fieldColumns` (union ordonnée, unicité Q6) et, par
  ligne, les champs applicables ; colonnes insérées après « Commentaire » ; cellules sans objet grisées
  verrouillées ; listes déroulantes enum / boolean ; commentaire d'en-tête ; `_polenta` : ligne
  `columns` (ids des colonnes dans l'ordre de la feuille) avant la table des instances.
- `campaign-execution-import.ts` : positions lues dans `columns` (v3) ou ordre fixe (v1/v2) ; valeurs
  brutes des colonnes de champ (`readLinkCell` pour `link`) ; validation par instance via
  `convertFieldValue` + `prepareRunFields` → erreurs `invalid_field_value` / `required_field_missing`.
- `CampaignExecutionService.apply` : transmet `fields` à `execute`.

## 4. Décisions

- **Contrôle dans `execute`** (point d'écriture unique), comme `persist()` en #195 ; l'import fait le
  même contrôle en amont pour l'aperçu (erreur par instance, pas d'arrêt du lot).
- **Unicité Q6** contrôlée sur tout le schéma du repo (nœuds locaux) à `schema:save`.
- **Classeur** : carte des colonnes plutôt que positions fixes ; v1/v2 inchangés à la lecture.

## 5. Sprints

1. Types, contrôle d'écriture, schéma (unicité, MCP), graphe, éditeur de schéma. Tests unitaires.
2. Page d'exécution et consultation d'un run ; e2e.
3. Classeur v3 (export / import) ; tests aller-retour v3 + lecture v2 ; mises à jour SPEC.
