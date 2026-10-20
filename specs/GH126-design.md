# GH126 — Design : colonne calculée éclatée (`splitColumn`)

> Spec : `specs/GH126.md`. Base : mécanisme GH70 (`specs/GH70-design.md`).

## 0. Idée directrice

Toutes les vues (Excel, Word, exports, impression, sélecteur de tests GH33) consomment les colonnes
calculées **par clé** via `useComputedColumns` (`columnsMap`, `merge`, `exportColumns`,
`filterFields`). Une requête éclatée est donc **déployée dans le hook** en sous-colonnes ordinaires
de clé `query::<ID>::<valeur>` : l'aval n'a presque rien à changer. Les seuls ajouts visibles sont
le **groupe** dans le panneau ⚙️ et l'infobulle d'en-tête.

Aucune connaissance des campagnes dans Polenta : seuls la bibliothèque de départ et le modèle
(contenu projet) parlent de campagnes.

## 1. Types partagés — `packages/types/src/suivi-columns.ts`

```ts
export interface QueryColumnDef {
  // … GH70 inchangé …
  /** GH126 — une sous-colonne par valeur distincte de cette colonne du résultat. */
  splitColumn?: string
  /** GH126 — libellé de chaque sous-colonne (défaut : la valeur de `splitColumn`). */
  splitLabelColumn?: string
}

export const MAX_SPLIT_COLUMNS = 50

/** `query::<ID>` ou, pour une sous-colonne, `query::<ID>::<valeur>`. */
export function computedColumnKey(queryId: string, split?: string): string
/** Inverse : `null` si la clé n'est pas une clé de colonne calculée. L'ID de requête ne contient
 *  jamais `::` ; tout ce qui suit le premier `::` après l'ID est la valeur (qui peut en contenir). */
export function parseComputedColumnKey(key: string): { queryId: string; split?: string } | null

export interface SplitColumnValues { split: string; label: string; values: Map<string, ComputedCell> }

/** Lignes → sous-colonnes, dans l'ordre de première apparition de leur valeur.
 *  Erreurs : ligne sans id / value / valeur de split (« colonne « X » manquante »), plus de
 *  MAX_SPLIT_COLUMNS valeurs (« 50 sous-colonnes au maximum (N trouvées) »). */
export function splitColumnValuesFromRows(rows: readonly GraphRow[], decl: QueryColumnDef):
  { columns: SplitColumnValues[]; error?: string }
```

- `validateColumnDecl` : `splitColumn` / `splitLabelColumn` traités comme `idColumn` (nom non vide
  si fourni, vide / `null` = absent) ; `splitLabelColumn` sans `splitColumn` → erreur
  `column.splitLabelColumn : réservé aux colonnes éclatées (splitColumn)`.
- Refactor interne : la lecture d'une ligne (`id`, valeur, infobulle, `_ids` → `ComputedCell`) est
  extraite de `columnValuesFromRows` dans une fonction privée partagée par les deux fonctions ;
  comportement de `columnValuesFromRows` inchangé.
- `columnFieldDef(key, decl, locale, label?)` : prend la **clé** (au lieu de l'ID) et un libellé
  optionnel (celui de la sous-colonne). Appelants mis à jour (hook uniquement).
- `isComputedColumnKey` inchangé (préfixe `query::`) : vrai aussi pour les sous-colonnes, donc
  lecture seule, `(calc)`, exclusion des écritures (`SystemView` l.673) restent valables.
- Empreinte : rien à faire — la déclaration n'entre déjà plus dans `queryCodeForHash` (GH70 §9 A).

Persistance (`suivi-format.ts`, `saved-queries.service.ts`) : la déclaration validée est écrite
telle quelle dans `query.yaml` ; les deux propriétés passent sans code supplémentaire (vérifié par
test). `packages/api-client/src/types.ts` : rien (type importé).

## 2. Hook — `apps/desktop/src/renderer/hooks/useComputedColumns.ts`

### 2.1 Entrées / sorties

```ts
useComputedColumns(opts: {
  … // inchangé
  /** GH126 — exécuter aussi les colonnes éclatées applicables non visibles, pour lister leurs
   *  sous-colonnes (panneau ⚙️ ouvert). */
  discover?: boolean
})

export interface ComputedColumn {
  key: string                    // query::ID ou query::ID::valeur
  queryId: string
  label: string
  queryTitle: string
  fieldDef: SchemaField
  /** GH126 — infobulle d'en-tête : « ID — titre » ou « libellé du groupe — libellé ». */
  headerTitle: string
  /** GH126 — sous-colonne : valeur et groupe. */
  split?: { value: string; groupLabel: string }
}

/** GH126 — entrée du panneau ⚙️ : colonne simple ou groupe éclaté. */
export type ComputedColumnPanelEntry =
  | { kind: 'column'; column: ComputedColumn }
  | { kind: 'group'; queryId: string; label: string; queryTitle: string; pending: boolean; error?: string; columns: ComputedColumn[] }

interface ComputedColumnsState {
  … // inchangé ; `available` = liste à plat (colonnes simples + sous-colonnes connues), ordre ⚙️
  panel: ComputedColumnPanelEntry[]
}
```

### 2.2 Exécution

- Requête simple : exécutée si sa clé est visible (inchangé).
- Requête éclatée : exécutée si **une** clé visible a son `queryId` (via `parseComputedColumnKey`)
  **ou** si `discover`. Une seule exécution, même clé react-query `['widget-query-result', …,
  'column', id, script]` → le résultat de l'ouverture du ⚙️ est réutilisé par la vue et
  inversement, rafraîchi par `useLiveFileSync` comme aujourd'hui (nouvelle campagne → nouvelle
  sous-colonne sans recharger).

### 2.3 Déploiement

- Résultat reçu : `splitColumnValuesFromRows` → une `ComputedColumn` + un `ComputedColumnResult` par
  sous-colonne (clé `query::ID::valeur`, `fieldDef` avec la clé, `split`, `headerTitle`).
- **Avant le premier résultat** (ou en erreur d'exécution / de lignes) : chaque clé **visible** de la
  requête reçoit une colonne de substitution (libellé = la valeur, `pending` ou `error`) — la colonne
  ne disparaît pas puis réapparaît au chargement, et ⚠ s'affiche dans son en-tête. Une fois le
  résultat reçu sans erreur, une clé visible absente du résultat n'a plus de colonne →
  `filterFields` l'écarte (règle GH70 : ignorée, jamais réécrite).
- Ordre de `available` / `panel` : entrées triées par libellé (colonne simple) ou libellé de groupe
  (requête éclatée), comme aujourd'hui ; les sous-colonnes d'un groupe gardent l'ordre du script.
- `merge`, `columnsMap`, `exportColumns`, `filterFields`, `pending`, `ready` : construits sur la
  liste déployée, code inchangé hormis la source.

## 3. Vues

| Fichier | Changement |
|---|---|
| `renderer/components/system/SystemView.tsx` | `useComputedColumns({ …, discover: showFieldConfig })` ; `FieldConfigModal` reçoit `computed.panel` (en plus de `available` pour l'ordre canonique). Section « Colonnes calculées » : entrée `column` rendue comme aujourd'hui ; entrée `group` = ligne de titre (libellé + `(calc)`, infobulle « ID — titre », spinner si `pending`, ⚠ + message si `error`) puis une case par sous-colonne, indentée, `data-testid="field-config-computed-group"`. `canonicalOrder` construit depuis `available` (à plat) : recocher une sous-colonne la remet à sa place. |
| `renderer/components/system/ExcelView.tsx` | Infobulle de l'en-tête d'une colonne calculée = `column.headerTitle` (au lieu de `queryTitle` seul sur le badge `(calc)`). |
| `renderer/components/system/WordView.tsx` | `ComputedField` : infobulle du libellé = `headerTitle`. |
| `TestPickerGrid.tsx`, `print.requirements.tsx`, `print.tests.tsx`, `lib/exportColumns.ts` | Aucun changement (clés et `exportColumns` déjà génériques). Vérifié par les tests. |

Clés i18n (fr / en) : `system.fieldConfig.computedGroupPending`, `queryPage.column.split`,
`queryPage.column.splitHint`, `queryPage.column.splitLabelColumn`.

## 4. Saisie — vue `/query`

`renderer/components/dashboard/ColumnDeclEditor.tsx` : sous les listes « Colonne identifiant /
valeur / infobulle », case « Une colonne par valeur de » + liste (colonnes du dernier résultat,
comme `mappingSelect`) ; cochée → liste « Libellé des colonnes » (option vide = la valeur). Décocher
retire `splitColumn` et `splitLabelColumn`. Validation : `validateColumnDecl` (déjà appelé par
`query.tsx`), aucun code de plus dans `query.tsx`.

## 5. MCP

- `mcp-server/tools/suivi-common.ts` `columnSchema` : `splitColumn`, `splitLabelColumn`
  (`string | null`, optionnels, descriptions), description générale complétée (une ligne par
  (élément, sous-colonne)).
- `main/services/agents-md.template.ts` : une phrase sur les colonnes éclatées.
- `create_query` / `update_query` / `list_queries` : rien d'autre (passent par `checkColumn`).

## 6. Bibliothèque et modèle (contenu projet)

- `apps/desktop/resources/dashboard-lib/campaign.js` → `// @polenta-lib campaign 4` ; nouvelle
  fonction exportée :

  ```js
  /** @returns {{ campaignId, campaignTitle, testId, status, executedAt, executedBy, entryId, statuses }[]} */
  export function entryResultsByCampaign(data)
  ```
  campagnes triées par `createdAt` puis `id`, toutes (abandonnées comprises) ; entrées actives
  (`c.entries`) groupées par `testCaseId` dans l'ordre d'apparition ; `status = worst(statuses)`
  (import `worst` depuis `./status.js`) ; `executedAt` / `executedBy` / `entryId` de l'entrée
  exécutée la plus récente, à défaut de la première entrée (`executedAt: null`).
- `resources/dashboard-lib/manifest.json` : version 4 + empreinte, résumé « Résultat par
  campagne : entryResultsByCampaign (GH126) » ; la v3 reste connue → bandeau des mises à jour.
- `packages/types/src/suivi-templates.ts` : `QueryTemplateId` + `'campaign-results'`,
  `generateCampaignResults()` (script de la spec §6.2, import `entryResultsByCampaign` et `dayOf`),
  `campaignResultsColumn()` (`splitColumn: 'campaignId'`, `splitLabelColumn: 'campaignTitle'`,
  `values: [PASS, FAIL, BLOCKED, INCOMPLETE, pending]`), entrée dans `QUERY_TEMPLATES`
  (« Résultat par campagne (colonnes) » / « Result by campaign (columns) »).
- `scripts/demo-lave-linge/content.mjs` : requête partagée « Résultat par campagne » (prochain ID
  libre) depuis ce modèle ; `suivi-corpus.test.ts` : un cas fige ses lignes sur la démo.

Dépendance bibliothèque : comme GH70, un projet dont `campaign.js` est en v3 obtient une erreur
d'import tant qu'il n'a pas appliqué la mise à jour proposée par le bandeau — comportement connu,
message moteur explicite (`import`), pas de traitement spécial.

## 7. Décisions et alternatives rejetées

- **Déploiement dans le hook plutôt que dans chaque vue** : une seule implémentation, vues
  inchangées. Rejeté : un type « colonne groupe » propagé jusqu'à ExcelView/WordView/exports.
- **Clé `query::ID::valeur`** : lisible dans les préférences, compatible `isComputedColumnKey`.
  Rejeté : clé encodée (base64/hash) — illisible, pas de gain (l'ID de requête ne contient pas `::`).
- **Découverte à l'ouverture du ⚙️** plutôt qu'exécution permanente : aucun coût tant que rien
  n'est visible ni configuré. Rejeté : exécuter toutes les requêtes éclatées à chaque vue.
- **Colonnes de substitution** pendant le chargement : évite le saut de mise en page et garde ⚠
  visible en erreur. Libellé provisoire = la valeur (ex. `CAMP-0005`), remplacé au résultat.
- **Limite 50** : protège la Vue Excel d'un `splitColumn` mal choisi (ex. une colonne d'ID).

## 8. Découpage en sprints

**Sprint 1 — mécanisme générique**
- §1 types + validation + `splitColumnValuesFromRows` + clés ; §2 hook ; §3 vues (⚙️ groupe,
  infobulles) ; §4 `ColumnDeclEditor` ; §5 MCP + AGENTS.md ; i18n.
- Tests unitaires (types, validation, déploiement, persistance `query.yaml`, MCP) ; e2e web
  `e2e-web/gh126-split-column.spec.ts` avec une requête Script éclatée.

**Sprint 2 — contenu projet, démo, specs**
- §6 bibliothèque v4 + manifest, modèle `campaign-results`, démo + corpus ; tests lib / modèle ;
  e2e du modèle sur la démo.
- Mise à jour des SPEC référencées (`SPEC-DASHBOARDS` §4–§6, §7 ; `SPEC-SYSTEM-VIEW`
  §Configuration des champs… ; `SPEC-MCP-SERVER` §global) et de `SPEC-INDEX.md`.
- Hors code Polenta, après merge : dans PH2, remplacer QUERY-0004/5/6 par une requête du modèle.
