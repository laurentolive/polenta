# GH69 — Design technique : widget « Matrice »

Spec : [GH69.md](GH69.md). **Un seul sprint.**

## Vue d'ensemble

Le widget matrice est un composant **purement renderer** : il pivote le `QueryResult` déjà renvoyé
par le moteur, sans nouveau channel IPC ni nouvelle exécution SQL. Côté main, seule la colonne
`campaignCreatedAt` s'ajoute à `campaign_entries`. La navigation réutilise intégralement GH65
(`onSelect` → `DrillDownModal` → `queries:drill-down` ; `onRowClick` → `useOpenRowTarget` →
`queries:resolve-row-target`).

```
QueryResult ──► buildMatrix() (lib pure, testée) ──► MatrixWidget (rendu, sticky, couleurs)
                                                      ├─ clic cellule  → onSelect({cat, series})   (DrillDownModal, GH65)
                                                      └─ clic en-tête  → onRowClick({ id: valeur }) (useOpenRowTarget, GH65)
```

## Fichiers modifiés / créés

### Types — `packages/types/src/dashboard.ts`
- `WidgetType` : ajout de `'matrix'`.
- `WidgetFieldMapping` : ajout de `label?: string` (matrix : colonne affichée à côté de la valeur de
  ligne). Commentaires des clés existantes complétés pour le rôle matrix.
- `CAMPAIGN_ENTRY_FIELDS` : ajout de `'campaignCreatedAt'` (après `baselineRef`).

**Décision — mapping : réutiliser `category` / `series` / `measure`** plutôt que de nouvelles clés
(`rows`, `cols`, `value`) :
- `category` = Lignes, `series` = Colonnes, `measure` = Valeur, `label` = Libellé de ligne (nouveau).
- C'est déjà le pivot catégorie × série du `BarWidget`/`LineWidget` ; le drill-down GH65 attend
  précisément `{ [category]: v, [series]: w }` — aucun changement côté main.
- Pas de migration YAML, schéma MCP étendu d'une seule clé.
- *Rejeté* : clés dédiées — plus explicites dans le YAML mais dupliquent la sémantique, élargissent
  le schéma MCP strict et obligent `drillDown` à connaître le type de widget.
- Conséquence acceptée : passer de « barres » à « matrice » dans la popup conserve le mapping
  (comportement déjà vrai entre barres et courbe).

### Main — `apps/desktop/src/main/services/query-engine.service.ts`
- Construction d'une ligne `campaign_entries` : `campaignCreatedAt: c.createdAt ?? null`.
- Allowlist builder : automatique (dérivée de `CAMPAIGN_ENTRY_FIELDS`).
- `schema-lookup.util.ts` ré-exporte `CAMPAIGN_ENTRY_FIELDS` — rien à changer.

### Renderer — builder — `components/dashboard/QueryBuilder.tsx`
- `CAMPAIGN_SYSTEM_FIELD_DEFS` : `campaignCreatedAt` typé `'date'` comme `executedAt`.

### Renderer — statuts d'exécution — `renderer/lib/runStatus.ts` (nouveau)
- Déplacement depuis `routes/campaign.$campaignId.tsx` de `RUN_STATUS_LABEL_KEY` et
  `RUN_STATUS_CLASS` (classes `bg-status-*-bg text-status-*`), plus :
  - `isTestRunStatus(v: unknown): v is TestRunStatus`
  - `RUN_STATUS_SEVERITY` : `FAIL 4 > BLOCKED 3 > INCOMPLETE 2 > pending 1 > PASS 0`
  - `worstRunStatus(statuses: TestRunStatus[]): TestRunStatus`
- `campaign.$campaignId.tsx` et `print.campaign-report.tsx` (seul autre importeur de
  `RUN_STATUS_LABEL_KEY`, aujourd'hui depuis la route) importent depuis `lib/runStatus`.
- *Hors périmètre* : les copies de `RUN_STATUS_CLASS` dans `CampaignListView.tsx` et
  `ExecutionImportModal.tsx` restent telles quelles (pas de refactoring annexe).

### Renderer — pivot — `components/dashboard/widgets/matrix.ts` (nouveau, pur)

```ts
export type MatrixCell =
  | { kind: 'empty' }
  | { kind: 'status'; status: TestRunStatus; count: number; breakdown: Partial<Record<TestRunStatus, number>> }
  | { kind: 'number'; value: number; count: number }
  | { kind: 'text'; value: string; count: number }

export interface MatrixAxisItem { key: string; raw: unknown; label?: string }   // key = toLabel(raw)

export interface Matrix {
  rows: MatrixAxisItem[]        // ordre naturel du libellé (Intl.Collator numeric)
  columns: MatrixAxisItem[]     // ordre de première apparition
  cell(rowKey: string, colKey: string): MatrixCell
}

export function buildMatrix(rows: Record<string, unknown>[], m: { category: string; series: string; measure: string; label?: string }): Matrix
```
- Un passage sur les lignes : `Map<rowKey, Map<colKey, unknown[]>>` ; regroupement par `toLabel`
  (`null` → « — »), valeur brute = première rencontrée (comme `rawValueIndex`).
- Agrégation d'une cellule : toutes `isTestRunStatus` → `status` (pire + répartition) ; sinon toutes
  numériques (`typeof number` ou chaîne numérique non vide) → `number` (somme) ; sinon `text`
  (valeurs distinctes `toLabel` jointes par « , »).
- Tri des lignes : `new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`, « — »
  en dernier.
- `label` : libellé de la première ligne portant la valeur de ligne.

### Renderer — rendu — `components/dashboard/widgets/MatrixWidget.tsx` (nouveau)
- Props : `result`, `fieldMapping`, `onSelect?`, `onRowClick?` (mêmes signatures que les autres).
- Mapping incomplet → `WidgetEmptyState` « chooseMatrixFields » ; résultat vide → « noData ».
- `<div className="overflow-auto h-full">` + `<table>` ; `thead th` `sticky top-0`, première
  colonne `sticky left-0` (fond `bg-surface`, coin haut-gauche `z-20`, en-têtes `z-10`).
- Cellule `status` : pastille `RUN_STATUS_CLASS[status]` + libellé traduit (`RUN_STATUS_LABEL_KEY`),
  suffixe `×n` si `count > 1`, `title` = répartition traduite (« 1 PASS, 1 FAIL »).
  Cellule `number` : `formatNumber`. `text` : tronqué (`max-w` + `truncate`), `title` complet.
  `empty` : « · » en `text-ink-3`, non cliquable.
- Clic cellule non vide → `onSelect({ [category]: row.raw, [series]: col.raw })`.
- Clic en-tête (ligne ou colonne) dont la valeur brute est une chaîne non vide →
  `onRowClick({ id: raw })` ; sinon non cliquable. La résolution `id` → exigence / test / campagne
  existe déjà côté main ; valeur non résolvable → mention « objet introuvable » affichée par la
  carte (`useOpenRowTarget.message`), sans code nouveau.
- Pas de virtualisation : 200 × 30 = 6 000 cellules, rendu direct acceptable ; le pivot est
  mémoïsé (`useMemo` sur `result` + mapping).

### Renderer — câblage
- `widgets/WidgetRenderer.tsx` : `case 'matrix'`.
- `WidgetConfigModal.tsx` : option de type (icône `Grid3x3` de lucide), `FieldMappingForm` branche
  `matrix` (Lignes / Libellé de ligne (facultatif) / Colonnes / Valeur, via `ColumnSelect`),
  `mappingComplete` = `category && series && measure`.
- `DashboardGrid.tsx` : rien (`onSelect` / `onRowClick` déjà passés à `WidgetRenderer`).

### i18n — `renderer/i18n/locales/fr.json` + `en.json`
- `dashboard.widgetModal.typeMatrix`, `rowsLabel`, `rowLabelLabel`, `columnsLabel`, `valueLabel`.
- `dashboardPage.widget.chooseMatrixFields`.

### MCP — `apps/desktop/src/mcp-server/tools/dashboards.tools.ts`
- `widgetTypeSchema` : `'matrix'`.
- `fieldMappingSchema` : `label` ; descriptions de `category`/`series`/`measure` complétées
  (« matrix : lignes / colonnes / valeur »). Description de `add_widget` : exemple test × campagne.

### Spécifications (fin de sprint)
- `SPEC-DASHBOARDS.md` §2.1 (`campaignCreatedAt`), §4 (type `matrix`, nouvelle §4.2 « Widget
  matrice »), §7 si besoin ; `SPEC-MCP-SERVER.md` (type/mapping) ; `SPEC-INDEX.md` colonne MAJ → GH69.

## Tests

- **Unitaires** (`vitest`) : `widgets/matrix.test.ts` (pivot, agrégations, tri naturel, `null`),
  `lib/runStatus.test.ts` (`worstRunStatus`) ; `query-engine.campaigns.test.ts` : présence de
  `campaignCreatedAt`.
- **E2E web** : `e2e-web/gh69-matrix.spec.ts` sur le modèle de `gh65-campaigns.spec.ts` (création
  requête + widget matrice, rendu, clic cellule → Détail, clic en-tête → onglet).
- Scénarios détaillés : [GH69-tests.md](GH69-tests.md).

## Risques

- **Valeurs mixtes** dans une cellule (statut + texte libre) → `text`, pas de couleur : voulu (la
  coloration ne s'applique qu'à une cellule 100 % statuts).
- **Mapping hérité** d'un autre type quand on bascule vers « Matrice » : `series` peut être vide →
  état « chooseMatrixFields », pas d'erreur.
- `fieldMappingSchema` MCP est `.strict()` : un client MCP ancien envoyant `label` ne peut pas exister
  (clé nouvelle) — pas de risque de régression.
