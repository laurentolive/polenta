# GH70 — Design : colonnes calculées définies par le projet

> Spec : [GH70.md](GH70.md) — scénarios : [GH70-tests.md](GH70-tests.md)

## 0. Principe d'architecture

Une colonne calculée = **requête partagée** + **déclaration `column`** dans `query.yaml`. Rien de
nouveau côté moteur : la valeur est produite par `suivi:run` (`queryId`), exactement comme un
widget. Le renderer :

1. lit les requêtes partagées (`queries:list`) et garde celles dont la déclaration s'applique au
   type affiché ;
2. exécute chacune une fois via `useScriptRun` (clé `['widget-query-result', …]`, déjà invalidée
   par `useLiveFileSync` sur tout changement de données → rafraîchissement gratuit, spec §6.4) ;
3. **fusionne les valeurs dans les objets normalisés** sous la clé `query::<ID>`.

Le point 3 est la décision structurante : tout le pipeline des vues est indexé par nom de champ
(`getCellText` / `getFieldValue`, filtre global et T51, `buildExportRows`, WordView). Une valeur
présente dans `obj['query::QUERY-0012']` est donc affichée, filtrée et exportée sans code dédié ;
il reste seulement à fournir un `SchemaField` synthétique (type, valeurs), le libellé, la lecture
seule, l'infobulle et le double-clic.

Aucun code de Polenta ne connaît les campagnes : « Dernier résultat » n'existe que dans la
bibliothèque projet et un modèle de requête (spec §2, critère 14).

**Alternatives rejetées**
- *Nouveau canal `columns:values` dans le main qui renvoie une `Map` prête* : duplique `suivi:run`
  et son cache ; l'invalidation renderer existe déjà pour `widget-query-result`.
- *Exécuter une fonction de bibliothèque par élément* : N exécutions dans le bac à sable (2 s
  chacune au pire) ; le contrat « une ligne par élément » fait tout en une exécution.
- *Composant de cellule par type de colonne calculée* : la cellule réutilise `InlineCell` en
  lecture seule (rendu « comme les autres », réponse au point 4 de la spec), plus une cellule
  richtext statique.

## 1. Types et logique pure (`packages/types`)

### 1.1 Nouveau fichier `src/suivi-columns.ts`

```ts
import type { ParamLabel } from './suivi-params'
import type { SchemaFieldType } from './schema'
import type { GraphRow } from './graph'

/** Déclaration `column` d'une requête partagée (GH70). */
export interface QueryColumnDef {
  label: ParamLabel                         // libellé bilingue ou texte unique
  appliesTo: { categories: ('requirement' | 'test')[]; objectTypes: string[] }
  type: Exclude<SchemaFieldType, 'drawio'>
  values?: string[]                         // enum / multi_enum : obligatoire, non vide
}

export const COMPUTED_COLUMN_PREFIX = 'query::'
export const computedColumnKey = (queryId: string) => `query::${queryId}`
export const isComputedColumnKey = (col: string) => col.startsWith('query::')

/** Valide une déclaration lue (fichier, MCP, éditeur) : normalisée + erreurs lisibles.
 *  Absente (`undefined`/`null`) → `{ decl: null, errors: [] }`. */
export function validateColumnDecl(raw: unknown): { decl: QueryColumnDef | null; errors: string[] }

/** Colonne proposée pour un type affiché ? (catégorie OU objectTypeRef). */
export function columnAppliesTo(decl: QueryColumnDef, category: string | undefined, objectTypeRef: string | undefined): boolean

/** Valeurs d'une colonne à partir des lignes du script (spec §4).
 *  Première ligne d'un id retenue ; `id` vide ou `value` absent → `error` (genre `rows`). */
export interface ComputedCell { value: string; tooltip?: string; target?: string }
export function columnValuesFromRows(rows: readonly GraphRow[]): { values: Map<string, ComputedCell>; error?: string }

/** `SchemaField` synthétique (rendu par les vues). */
export function columnFieldDef(queryId: string, decl: QueryColumnDef): SchemaField

export function columnLabel(decl: QueryColumnDef, locale: 'fr' | 'en'): string
```

`value` est converti en chaîne comme les champs normalisés (`normalizeObject`) : `null` → `''`,
booléen → `'true'`/`'false'`, nombre → `String(n)`. `appliesTo` vide (aucune catégorie ni type)
est valide mais ne s'applique à rien.

### 1.2 `suivi-format.ts`

- `StoredQuery.column?: QueryColumnDef` ; `ReadQuery.column?: unknown` (non validée, comme
  `parameters`) ; `readQueryRecord` recopie `up.column`.

### 1.3 `dashboard.ts`

- `SavedQuery.column: QueryColumnDef | null` et `columnError?: string`.

### 1.4 `suivi-templates.ts`

- `queryCodeForHash(script, parameters, column?)` : ajoute `\n\u0000column\n${stableJson(column, 2)}`
  **seulement si** `column` est présent — les empreintes existantes ne changent pas (aucune requête
  ne passe « personnalisée » à la mise à jour).
- `QueryTemplate.column?(params): QueryColumnDef | null` ; `queryCode` renvoie aussi `column`.
- Nouveau modèle `campaign-last-result` (« Dernier résultat de campagne » / « Last campaign
  result », v1, sans paramètre de formulaire) :

```js
// Modèle « campaign-last-result » v1
// Nécessite la bibliothèque projet (dashboards/lib/campaign.js).
import { lastEntryResults } from 'lib/campaign.js'
import { dayOf } from 'lib/time.js'

export default function (data, polenta) {
  const rows = []
  for (const [testId, r] of lastEntryResults(data)) {
    rows.push({
      id: testId,
      value: r.status,
      tooltip: `${r.campaignId} — ${r.campaignTitle} · ${dayOf(r.executedAt, polenta)}${r.executedBy ? ' · ' + r.executedBy : ''}`,
      _ids: [`${r.campaignId}/${r.entryId}`],
    })
  }
  return rows
}
```

  `column()` → `{ label: { fr: 'Dernier résultat', en: 'Last result' }, appliesTo: { categories:
  ['test'], objectTypes: [] }, type: 'enum', values: ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE'] }`.
  `QueryTemplateId` étendu.

## 2. Main

### 2.1 `saved-queries.service.ts`

- `toQuery` : `validateColumnDecl(r.column)` → `column`, `columnError` ; `hashed =
  queryCodeForHash(script, parameters, column ?? undefined)`. Une requête **privée** qui porterait
  une déclaration (fichier `.pref` édité à la main) : `column: null`, `columnError` = « réservé aux
  requêtes partagées ».
- `QueryCode` gagne `column: QueryColumnDef | null` ; `resolveCode` / `applyQueryTemplate`
  (`suivi-store.util.ts`) le propagent depuis le modèle.
- DTO : `CreateSavedQueryDto.column?: QueryColumnDef | null`, `UpdateSavedQueryDto.column?:
  QueryColumnDef | null` (`null` = retirer). Mêmes règles que `parameters` : interdit avec
  `template` (généré par le modèle) ; déclaration lue invalide et non remplacée → refus (`columnError`,
  ne pas l'écraser silencieusement).
- Refus `COLUMN_PRIVATE` : `create` en `scope: 'private'` avec `column`, ou `update` d'une requête
  privée avec `column` non nul.
- `setScope(…, 'private')` : la déclaration est **retirée** du payload (la confirmation est côté
  UI, spec §3) ; la requête devient personnalisée si elle venait d'un modèle qui génère une colonne
  (empreinte différente) — accepté.
- `toStored` / `writeShared` écrivent `column` s'il est non nul.

### 2.2 `suivi.service.ts`

Aucun changement (l'exécution par `queryId` existe). `renderTemplate('query')` renvoie aussi
`column`.

### 2.3 MCP (`mcp-server/tools/queries.tools.ts`)

- `columnSchema` (zod) miroir de `QueryColumnDef`, validé en plus par `validateColumnDecl`.
- `create_query` / `update_query` : paramètre `column` (pas avec `template`) ; erreurs
  `INVALID_INPUT` (déclaration) et `COLUMN_PRIVATE`.
- `list_queries` : renvoie `column` et `columnError`. Description des outils et `AGENTS.md`
  (`agents-md.template.ts`) : une ligne sur les colonnes calculées et le contrat de ligne
  (`id`, `value`, `tooltip`, `_ids`).

### 2.4 Bibliothèque de départ (`resources/dashboard-lib/`)

- `campaign.js` : `lastEntryResults(data)` → `Map<testId, { status, executedAt, executedBy,
  campaignId, campaignTitle, entryId }>` (entrées actives `executedAt` non nul, toutes campagnes,
  abandonnées comprises ; plus récent `executedAt` ; égalité → première rencontrée) et
  `lastEntryResult(data, testId)` (`null` sinon). `lastResult(s)` inchangées. En-tête
  `// @polenta-lib campaign <version+1>`.
- `manifest.json` : nouvelle version + empreinte de `campaign.js` (l'empreinte précédente reste
  connue → le bandeau propose la mise à jour, SPEC-DASHBOARDS §8.1).
- `polenta.d.ts` inchangé (contrat du graphe intact).

### 2.5 Projet de démonstration (`scripts/demo-lave-linge/generate.mjs`)

Ajout d'une requête partagée « Dernier résultat de campagne » générée par le modèle (dossier
`queries/QUERY-NNNN/` avec `column`). Corpus Suivi : la requête n'a pas de widget, aucune
référence existante ne change ; un cas est ajouté au corpus (`suivi-corpus.test.ts`) pour figer les
lignes de cette requête sur la démo.

## 3. Renderer

### 3.1 Hook `hooks/useComputedColumns.ts` (nouveau)

```ts
export interface ComputedColumn {
  key: string                    // query::QUERY-0012
  queryId: string
  label: string                  // langue courante
  queryTitle: string
  fieldDef: SchemaField          // columnFieldDef
}
export interface ComputedColumnsState {
  /** Colonnes applicables au type (pour ⚙️), triées par libellé. */
  available: ComputedColumn[]
  /** Résultats des colonnes visibles : valeurs, erreur, chargement. */
  results: Map<string, { values: Map<string, ComputedCell>; error?: string; pending: boolean }>
  /** Objets normalisés + valeurs `query::…` (identité stable si rien ne change). */
  merge<T extends Record<string, string>>(objects: T[]): T[]
}
export function useComputedColumns(opts: {
  workspaceDir: string; category?: string; objectTypeRef?: string; visibleKeys: string[]
}): ComputedColumnsState
```

- Repo des requêtes = repo ouvert du projet (`api.workspace.resolve(workspaceDir).localPath`,
  comme la vue `/query`), **quel que soit le repo sélectionné** dans la Vue Système (T72) : les
  colonnes sont celles du projet ; les IDs des lignes sont globaux (préfixes uniques).
- `queries:list` (clé `['queries', repoPath, username]`, partagée avec la vue Suivi → la liste se
  met à jour après une sauvegarde) ; filtre : `scope === 'shared'`, `column` non nul, pas de
  `state.readOnly`, `columnAppliesTo(...)`.
- Une `useQueries` sur `runOptions(repoPath, wsDir, username, { queryId })` par colonne **visible**
  (`visibleKeys` ∩ `available`). Pas de `limit`. Le script de la requête entre dans la clé (comme
  `widgetRunOptions`) pour réexécuter après modification.
- Erreur d'exécution → `scriptErrorText(error)` ; erreur de lignes → `columnValuesFromRows().error`.
- Clé de colonne visible mais plus disponible (requête supprimée / privée / non applicable) :
  ignorée par les vues (filtrée de `columns`), jamais réécrite dans les prefs (spec §6.1).

### 3.2 `SystemView.tsx`

- Appel du hook avec `visibleKeys = [...visibleFieldsExcel, ...visibleFieldsWord]` filtrées sur le
  mode affiché (seule la vue courante déclenche l'exécution, spec §6.4).
- `objects` → `computed.merge(objects)` (après les `pendingEdits`).
- Colonnes passées aux vues : filtre `isComputedColumnKey(col) ⇒ available` contient `col`.
- `saveInlineEditsMutation` : clés `query::` exclues de `WRITE_BLOCKED` (défense, jamais éditées).
- Exports xlsx/docx : `buildExportRows` reçoit `objects` fusionnés + un dictionnaire de libellés
  des colonnes calculées (§3.6).
- `FieldConfigModal` reçoit `computedColumns: ComputedColumn[]`.

### 3.3 `FieldConfigModal` (dans `SystemView.tsx`)

- Section « Colonnes calculées » (`system.fieldConfig.computedColumns`) entre les champs et
  Étapes / Liens, masquée si `available` vide. Ligne : case + libellé + badge `(calc)` ;
  `title` = `QUERY-0012 — titre`.
- `canonicalOrder` : `[...allFields, ...computedKeys, ...steps, ...links]`.
- Absente de `defaultVisibleFields` (décochée par défaut). « Réinitialiser par défaut » la retire.

### 3.4 `ExcelView.tsx`

- Nouvelle prop `computedColumns?: Map<string, { column: ComputedColumn; result }>`.
- `getColumnLabel(col)` : libellé de la colonne calculée, ⚠ ajouté dans l'en-tête si
  `result.error` (infobulle = message).
- `isSystemField(col)` vrai pour `query::*` → `InlineCell` en lecture seule (rendu non éditable
  existant, `bg-hover`), donc ni double-clic d'édition, ni F2, ni édition en masse ; coller /
  supprimer : clés `query::` exclues de `handlePaste` / suppression de contenu (même garde que les
  champs système).
- `InlineCell` gagne deux props facultatives : `tooltip?: string` (attribut `title` de la cellule
  en lecture seule) et `onOpen?: () => void` (double-clic sur cellule non éditable). Branchées par
  la ligne pour `query::*` : `tooltip = values.get(id)?.tooltip`, `onOpen` si `target`.
  `onOpen` passe par les actions stables (`useCellActions`, nouvelle action `openComputedTarget(id)`)
  pour garder la mémoïsation T176.
- Type `richtext` : cellule en lecture seule rendue par `StaticRichTextViewer` compact (même
  rendu que `RichtextCell` hors édition) — `RichtextCell` reçoit `onStartEdit: undefined`.
- Chargement : tant que `result.pending`, cellule vide avec un `…` discret (`text-ink-3`) ; la vue
  n'attend pas (pas d'ajout au calcul `ready` de SystemView — spec §6.4).
- Filtre T51 : `isFilterableColumn` inchangé (la colonne est filtrable) ; `getCellText` lit
  `obj['query::…']` comme tout champ.
- Ouverture : `useOpenRowTarget(projectRepoPath, workspaceDir)` dans SystemView, passé en
  `onOpenComputedTarget` ; message d'échec affiché comme dans les dashboards (mention temporaire
  sous la toolbar).

### 3.5 `WordView.tsx`

- Les clés `query::*` sont rendues comme un champ en lecture seule (chemin `isSystem`) avec le
  libellé de la colonne ; `title` = tooltip ; clic sur la valeur → ouverture de la cible si
  présente (lien souligné au survol). Richtext : `StaticRichTextViewer`.

### 3.6 Exports (`lib/exportColumns.ts`)

- `getExportColumnLabel(col, typeDef, extraLabels?)` et `buildExportRows(…, extraLabels?)` :
  `extraLabels: Map<string, string>` (libellés des colonnes calculées). Les valeurs viennent déjà
  des objets fusionnés. `ExcelView.getColumnLabel` utilise la même fonction (source unique).
- `print.requirements.tsx` / `print.tests.tsx` : appellent `useComputedColumns` avec les colonnes
  `visibleFieldsWord` et attendent la fin des exécutions avant de signaler le rendu prêt (l'impression
  ne doit pas capturer des `…`). En erreur : colonne vide (pas de ⚠ dans un document).

### 3.7 Sélecteur de tests (`TestPickerGrid.tsx`)

- Même hook (`visibleKeys` = `visibleFields`), `objects` fusionnés, `computedColumns` passé à
  `ExcelView`. Double-clic d'ouverture désactivé en mode sélection (lecture seule forcée GH33 :
  `onOpen` non fourni) ; l'infobulle reste.

### 3.8 Vue `/query` (`routes/query.tsx`)

- Nouveau composant `components/dashboard/ColumnDeclEditor.tsx` sous `ParameterDeclEditor` :
  case « Utiliser comme colonne dans la Vue Système » ; libellé ; catégories (cases Exigences /
  Tests) ; types précis (multi-sélection depuis `useSuiviObjectTypes`, refs `<nœud>::<type>`) ;
  type de champ (liste sans `drawio`) ; valeurs (une par ligne) si `enum` / `multi_enum`.
  Erreurs de `validateColumnDecl` affichées en direct et bloquent l'enregistrement (comme
  `declErrors`).
- Mode modèle : déclaration générée affichée en lecture seule (si le modèle en produit une).
- Requête privée ou non enregistrée : éditeur désactivé avec la mention « réservé aux requêtes
  partagées » ; à la boîte « Enregistrer sous », choisir *Privé* avec une déclaration → message
  d'erreur, enregistrement bloqué.
- `columnError` d'une requête lue → bandeau d'erreur (comme `parametersError`).
- Passage partagé → privé depuis le panneau latéral (`setScope`) d'une requête avec colonne :
  confirmation « La colonne « X » ne sera plus proposée dans la Vue Système ».
- Après sauvegarde : `invalidateQueries(['queries'])` (déjà fait) → ⚙️ et vues à jour.

### 3.9 i18n

Clés fr / en : `system.fieldConfig.computedColumns`, `system.fieldConfig.computedBadge`,
`system.computed.loading`, `system.computed.error`, `queryPage.column.*` (titre, case, libellé,
catégories, types, type de champ, valeurs, partagée seulement, erreurs), confirmation de passage en
privé.

## 4. Fichiers modifiés

| Fichier | Pourquoi |
|---|---|
| `packages/types/src/suivi-columns.ts` (nouveau) + `index.ts` | déclaration, validation, valeurs, applicabilité |
| `packages/types/src/suivi-format.ts`, `dashboard.ts` | `column` stocké / lu / exposé |
| `packages/types/src/suivi-templates.ts` | empreinte, `column()` des modèles, modèle `campaign-last-result` |
| `apps/desktop/src/main/services/saved-queries.service.ts`, `suivi-store.util.ts`, `suivi.service.ts` | lecture / écriture / refus `COLUMN_PRIVATE`, `setScope` |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts`, `main/services/agents-md.template.ts` | MCP |
| `apps/desktop/resources/dashboard-lib/campaign.js`, `manifest.json` | `lastEntryResults` |
| `scripts/demo-lave-linge/generate.mjs` | requête d'exemple dans la démo |
| `apps/desktop/src/renderer/hooks/useComputedColumns.ts` (nouveau) | exécution + fusion |
| `apps/desktop/src/renderer/components/system/SystemView.tsx` | branchement, ⚙️, exports |
| `apps/desktop/src/renderer/components/system/ExcelView.tsx`, `WordView.tsx` | lecture seule, infobulle, ouverture, ⚠ |
| `apps/desktop/src/renderer/lib/exportColumns.ts`, `routes/print.requirements.tsx`, `routes/print.tests.tsx` | exports |
| `apps/desktop/src/renderer/components/campaign/TestPickerGrid.tsx` | sélecteur de tests |
| `apps/desktop/src/renderer/routes/query.tsx`, `components/dashboard/ColumnDeclEditor.tsx` (nouveau) | saisie |
| `apps/desktop/src/renderer/i18n/*` | libellés |
| `apps/desktop/src/preload` / `renderer/api` | types des DTO (`column`) |

## 5. Limites connues

- `appliesTo.objectTypes` compare la ref `<nœud>::<type>` du type affiché ; deux repos du
  workspace exposant la même ref `root::<type>` (écart SPEC-ELECTRON §22.3) reçoivent tous deux la
  colonne. Préférer `categories` ; documenté dans l'éditeur.
- Pas de tri (aucune colonne n'est triable aujourd'hui, spec §8).
- Une colonne calculée sur une vue de 1000+ éléments coûte une exécution de script (≤ 2 s,
  budget du moteur) ; le contexte préparé du graphe est partagé avec les dashboards.

## 6. Découpage en sprints

**Sprint 1 — modèle, main, MCP, bibliothèque, saisie** (testable sans les vues)
- §1 (types, validation, empreinte, modèle `campaign-last-result`), §2 (service, MCP, AGENTS.md,
  bibliothèque + manifest, démo + corpus), §3.8 (éditeur `/query`), i18n associée.
- Tests unitaires : `suivi-columns.test.ts`, service (création / mise à jour / refus privé /
  `setScope` / empreinte inchangée sans colonne), bibliothèque (`dashboard-lib.test.ts`), MCP,
  corpus. E2E : `gh70-query-column.spec.ts` (déclaration saisie et relue).

**Sprint 2 — affichage dans les vues**
- §3.1 à §3.7 (hook, ⚙️, Excel, Word, exports, impression, sélecteur), i18n associée.
- E2E : `gh70-computed-column.spec.ts` (scénarios Vue Excel / Word / filtre / mise à jour live /
  erreur / export) sur le projet de démonstration.
- Mises à jour SPEC (dernier sprint) : SPEC-DASHBOARDS §4, §5, §7.0 ; SPEC-SYSTEM-VIEW §Vue Excel,
  §Vue Word, §Configuration des champs, §Persistance ; SPEC-MCP-SERVER ; SPEC-TECH-stack §1.1
  (#70 livré) ; SPEC-INDEX.
