# GH195 — Design : type de champ `link` et `requiredWhen`

Spec : `specs/GH195.md`. Deux sprints.

## 1. Principe : un point d'écriture unique côté main

Les écritures de l'application (formulaires, vues Excel / Word / Édition, transitions de statut)
**ne valident aujourd'hui aucun champ côté main** : `required` n'est contrôlé que par le MCP
(`planUpdate`, `validateBulkEntries`). Toutes les écritures passent en revanche par le
`persist()` de leur service (`requirements.service.ts`, `tests.service.ts`,
`campaigns.service.ts`), qui connaît l'avant et l'après.

On y branche une fonction **pure** de `packages/types`, `prepareFieldsWrite(typeDef, before,
after)`, qui :

1. normalise les champs `link` modifiés (forme texte `libellé | URL` → objets, simple / liste
   selon `multiple`) et contrôle leurs URL (§1.3 de la spec) ;
2. évalue les `requiredWhen` dont le champ ou une référence a changé (§2.4) ;
3. renvoie les `fields` normalisés, ou une erreur `{ field, reason }`.

`persist()` lève `FieldWriteError(reason)` en cas d'erreur (sauf écriture `raw`). Les chemins MCP
de contrôle préalable (`planUpdate`, `validateEntry`, utiles au `dryRun`) appellent la même
fonction. Conséquence : le renderer peut envoyer un champ `link` sous **forme texte** (chaîne) —
c'est le main qui convertit. Les formulaires à base de `Record<string, string>` restent inchangés.

Seuls les champs **modifiés** sont normalisés : on ne réécrit jamais un champ non touché (spec
§1.2, Q6).

## 2. `packages/types`

### 2.1 `schema.ts`
- `SchemaFieldType` += `'link'`.
- `SchemaField` += `multiple?: boolean` (link seulement), `requiredWhen?: Record<string, unknown[]>`.

### 2.2 Nouveau `field-links.ts`
```ts
export interface LinkValue { label?: string; url: string }
export function isAcceptedLinkUrl(url: string): boolean   // http(s)://, file://, \\serveur\…
export function isHttpLinkUrl(url: string): boolean
export function parseLinkLine(line: string): LinkValue | null   // dernier '|' ; vide → null
export function parseLinksText(text: string): LinkValue[]
export function formatLinkText(l: LinkValue): string             // 'libellé | URL' ou 'URL'
export function formatLinksText(ls: LinkValue[]): string         // une ligne par lien
export function readLinkValues(raw: unknown): LinkValue[]        // tolérance §1.2 (chaîne, objet, liste)
export function isLinkValue(v: unknown): v is LinkValue
export function normalizeLinkField(field: SchemaField, raw: unknown):
  { ok: true; value: LinkValue | LinkValue[] | undefined } | { ok: false; reason: string }
export function fieldValueToText(v: unknown): string             // String(v), liens en forme texte
```
Regex : `http(s)` et `file` sans blanc ; UNC `^\\\\[^\\/\s]+\\.+` (espaces admis dans le chemin).
Un libellé contenant `|` ou un saut de ligne est refusé.

### 2.3 Nouveau `required-when.ts`
```ts
export type FieldValueReader = (name: string) => string[]      // valeurs « comme chaînes »
export function objectFieldReader(typeDef, obj: { status?: string; fields?: Record<string, unknown> }): FieldValueReader
//   status → [status] ; multi_enum → parseMultiEnumValue ; boolean → ['true'|'false'] ; autre → [String(v)]
export function activeRequiredWhen(field: SchemaField, read: FieldValueReader): string | null  // clé de la condition vraie
export function isFieldRequiredNow(field: SchemaField, read: FieldValueReader): boolean
export function requiredWhenIssues(typeDef, statuses): RequiredWhenIssue[]   // cohérence §2.3
export function prepareFieldsWrite(typeDef, before, after): { ok: true; fields } | { ok: false; field; reason }
```
Le lecteur est un paramètre : L2 (`result` d'un run / d'une étape) et L5 (champs de décision)
fourniront le leur.

`requiredWhenIssues` distingue :
- **erreurs** (refus à `schema:save` et au MCP) : auto-référence, liste vide, référence vers un
  champ d'un type non admis ;
- **avertissements** (⚠ dans l'éditeur, condition inerte, pas de refus) : champ de référence
  absent, valeur inconnue. Le MCP `add_field` les refuse à la déclaration.

> Amendement de la spec §2.3 : refuser une valeur inconnue à `schema:save` empêcherait de retirer
> une valeur d'enum (une sauvegarde aussi). Seules les erreurs de structure sont refusées à la
> sauvegarde ; le reste est un ⚠, cohérent avec « la condition devient inerte ».

Message de refus : `« Justification » est obligatoire quand Statut = Approuvé` (libellés du schéma,
valeurs séparées par « ou »).

### 2.4 Autres
- `history.ts` : `HISTORY_TRACKABLE_TYPES` += `link` (mode valeur) ; `comparable` passe les liens par
  `readLinkValues` (chaîne et objet équivalents).
- `graph.ts` : `GraphFieldType` += `link` ; `GraphLink`.
- `suivi-columns.ts` : `ComputedColumnType = Exclude<SchemaFieldType, 'drawio' | 'link'>`.
- `export.ts` : rien (le type est déjà porté).

## 3. Main / MCP (sprint 1)

| Fichier | Changement |
|---|---|
| `requirements.service.ts`, `tests.service.ts`, `campaigns.service.ts` | `persist()` → `prepareFieldsWrite` ; `FieldWriteError` |
| `update-validation.util.ts`, `bulk-import-validation.util.ts` | même fonction, avant écriture (dryRun) |
| `merge-resolution.service.ts` | `requiredWhen` non satisfait → avertissement `requiredEmpty` |
| `schema.service.ts` | `save()` / `addField()` : `requiredWhenIssues` (erreurs) → `SchemaValidationError('REQUIRED_WHEN_INVALID')` ; `addField` refuse aussi les avertissements |
| `mcp-server/tools/schema-mutation.tools.ts` | zod : `link`, `multiple`, `requiredWhen` |
| `ipc/desktop-only.handlers.ts` + preload + `api` | `links:open(url)` : revalide `isAcceptedLinkUrl`, confirmation `dialog.showMessageBox` hors http(s), `shell.openPath` pour UNC, `openExternal` sinon |
| `export/link-cell.util.ts` (nouveau) | `readLinkCell(cell)` (§1.10) et `writeLinkCell(cell, links)` (§1.7) |
| exports xlsx (`requirements`, `query-result`, `campaign`, gabarit xlsx) | `writeLinkCell` pour les champs `link` |
| exports docx (`campaign.docx.ts`, gabarit) | `ExternalHyperlink` par lien ; markdown `[l](u)` |
| `graph.service.ts` | `link` passé tel quel (valeur lue par `readLinkValues`) |
| `resources/dashboard-lib/polenta.d.ts` | `GraphLink`, type `link` |

`readLinkCell` n'est branché sur aucun import dans ce lot (aucun import xlsx ne lit de champ
`link` avant L2) : il est livré testé, sur un classeur produit par Excel (fixture `.xlsx`).

## 4. Renderer (sprint 2)

| Fichier | Changement |
|---|---|
| `components/links/LinkList.tsx` (nouveau) | lecture : libellés cliquables, URL en infobulle ; web hors http(s) → « Copier » |
| `components/links/LinkEditor.tsx` (nouveau) | lignes libellé / URL, ajout / retrait / ordre, URL invalide signalée ; collage `text/html` (ancres) puis texte |
| `components/links/linkPaste.ts` (nouveau) | `linksFromClipboard(DataTransfer)` (DOMParser, ancres seules) |
| `DynamicField.tsx` | `link` → `LinkEditor` sur la forme texte ; prop `requiredNow` |
| `EditView.tsx`, `ExcelView.tsx`, `WordView.tsx` | rendu `LinkList`, édition via popover `LinkEditor` (modèle T126) ; astérisque dynamique |
| `DiffValue.tsx`, `merge/RenderedObjectPane.tsx` | `libellé (URL)` par lien |
| routes `req.*`, `test.*`, `campaign.*`, modales impact | `String(v)` → `fieldValueToText(v)` ; `requiredNow` |
| `schema/objectTypeEditor.tsx` | type `link`, case « Multiple », colonne « Obligatoire si » (référence + valeurs), ⚠ / erreurs `requiredWhenIssues` |
| `lib/exportColumns.ts`, `objectUnits.ts`, `ColumnDeclEditor.tsx` | `link` reconnu / exclu des colonnes calculées |
| i18n fr / en | libellés |

e2e web : `e2e-web/gh195-link-field.spec.ts` (déclaration, saisie, refus d'URL, `requiredWhen` sur
transition).

## 5. Alternatives rejetées
- **Normaliser dans le renderer** : cinq chemins d'écriture UI + MCP, risque d'oubli ; le main reste
  la seule garantie.
- **Contrôler `requiredWhen` sur l'objet entier** : bloquerait des objets anciens (Q2).
- **Hyperlien par lien en xlsx via texte riche** : Excel ne le permet pas (un hyperlien par cellule).

## 6. Sprints
- **Sprint 1** : §2 + §3, tests unitaires (`field-links`, `required-when`, `prepareFieldsWrite`,
  `readLinkCell`/`writeLinkCell`, persist refusé, schéma).
- **Sprint 2** : §4, e2e, mises à jour SPEC.
