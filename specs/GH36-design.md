# GH36 — Design : exécution hors outil via classeur Excel (export / réimport)

Spec : `specs/GH36.md`. Tests : `specs/GH36-tests.md`.

## 0. Prérequis : #34 mergé

GH36 réutilise `markdownToPlainText` (`apps/desktop/src/main/services/export/template/markdown-to-text.ts`),
introduit par #34 (branche GH34, sprint 4 commité, pas encore mergé). **Avant le sprint 1, la
branche GH36 est rebasée sur `main` une fois #34 mergé.** Si #34 n'est pas mergé au démarrage du
sprint 1 : l'Agent Dev s'arrête et pose `status:blocked` (« dépend de #34 »). Pas de copie du helper.

#34 modifie aussi `ExportButton.tsx` et `export.service.ts` en profondeur. Pour éviter tout
couplage, GH36 **ne passe pas** par `ExportButton` / `ExportService.GENERATORS` / `export:save` :
canaux et composant dédiés (§3, §5).

## 1. Vue d'ensemble

```
renderer                                   main
────────────────────────────────────────   ─────────────────────────────────────────────────────
ExecutionSheetMenu (header campagne)
 ├ Exporter… ──────────────────────────▶  campaigns:execution-sheet-export
 │                                          CampaignExecutionService.exportSheet()
 │                                            ├ charge campagne + tests (snapshot ▸ live)
 │                                            ├ buildExecutionSheetModel()   (pur)
 │                                            └ writeExecutionWorkbook()     (exceljs)
 └ Importer… ──────────────────────────▶  campaigns:execution-sheet-preview
      ExecutionImportModal ◀── preview ──   dialog ouvrir → readExecutionWorkbook() (pur)
                                              → validateExecutionImport()    (pur)
      « Importer N » ──────────────────────▶ campaigns:execution-sheet-apply(filePath)
                                              relit + revalide, puis par instance :
                                              TestsService.execute() → CampaignsService.updateRun()
```

Principe : **le fichier est relu et revalidé à l'application** (pas d'état conservé côté main
entre aperçu et écriture) — la campagne peut avoir changé entre-temps ; l'aperçu n'est qu'une
indication.

## 2. Types (`packages/types`)

### 2.1 `test.ts`

```ts
export interface TestRun {
  …
  /** GH36 — origine du résultat ; absent = saisie dans l'outil. */
  origin?: 'excel-import'
}
```

### 2.2 Nouveau `campaign-execution-sheet.ts` (exporté par `index.ts`)

```ts
export const EXECUTION_SHEET_FORMAT_VERSION = 1
export type ExecutionSheetLocale = 'fr' | 'en'

/** Libellés du classeur (en-têtes, listes déroulantes, bandeau) par langue — source unique pour
 *  l'export (langue de l'UI) et l'import (accepte codes + libellés de toutes les langues). */
export const EXECUTION_SHEET_LABELS: Record<ExecutionSheetLocale, {
  sheetName: string                 // 'Exécution' / 'Execution'
  headers: Record<ExecutionSheetColumn, string>
  stepVerdicts: Record<StepResultValue, string>
  globalVerdicts: Record<TestRunResult, string>
  banner: string                    // « Ne pas modifier les colonnes grisées… »
  preconditions: string; postconditions: string
}>

export type ExecutionSheetColumn =
  'key' | 'instance' | 'step' | 'text' | 'expected' | 'requirement' | 'params'
  | 'currentStatus' | 'verdict' | 'tester' | 'date' | 'comment'

/** Normalise un verdict saisi (code ou libellé FR/EN, casse/espaces ignorés) ; null si inconnu. */
export function parseStepVerdict(raw: string): StepResultValue | null
export function parseGlobalVerdict(raw: string): TestRunResult | null

export type ExecutionImportFatal =
  | { code: 'unreadable' } | { code: 'not_an_execution_sheet' }
  | { code: 'unsupported_version'; version: unknown }
  | { code: 'wrong_campaign'; fileCampaignId: string }
  | { code: 'campaign_closed'; status: CampaignStatus }

export type ExecutionImportInstanceError =
  | { code: 'entry_not_found' }
  | { code: 'test_not_found'; testCaseId: string }
  | { code: 'steps_mismatch'; expected: number[]; found: number[] }
  | { code: 'invalid_verdict'; row: number; value: string }       // row = n° de ligne Excel
  | { code: 'invalid_date'; row: number; value: string }

export interface ImportedInstance {
  entryId: string
  testCaseId: string
  requirementId?: string
  title: string
  previousStatus: TestRunStatus          // ≠ 'pending' → « remplace le résultat existant »
  result: TestRunResult                  // forcé ou calculé
  resultForced: boolean
  executedBy: string                     // fichier, sinon identité de l'importateur
  executedAt: string                     // ISO
  notes: string                          // Markdown
  stepResults: { order: number; result: StepResultValue; comment: string }[]
}

export interface ExecutionImportPreview {
  filePath: string
  fileName: string
  fatal?: ExecutionImportFatal           // présent → rien d'importable
  importable: ImportedInstance[]
  errors: { entryId: string; error: ExecutionImportInstanceError }[]
  warnings: { code: 'row_without_key'; row: number }[]
  unfilledCount: number
}

export interface ExecutionImportResult {
  imported: string[]                     // entryIds écrits, dans l'ordre
  failure?: { entryId: string; message: string }   // arrêt en cours de route
  preview: ExecutionImportPreview        // revalidation effectuée à l'application
}
```

### 2.3 Helpers de substitution des paramètres → `packages/types`

`isT171Run`, `runParamLookup`, `substituteRunParams` sont aujourd'hui dans
`apps/desktop/src/renderer/lib/testParams.ts` mais n'utilisent que `@polenta/types`. Ils sont
**déplacés** dans `packages/types/src/parameter-refs.ts` (à côté de `substituteMarkdownParamRefs`)
pour être utilisés aussi côté main ; `testParams.ts` les **ré-exporte** (aucun appelant renderer
modifié).

### 2.4 `zod-schemas/test.schema.ts` — `ExecuteTestCaseSchema`

Ajout de champs optionnels : `executedBy: z.string().optional()`, `executedAt: z.string().datetime().optional()`,
`origin: z.literal('excel-import').optional()`. Absents = comportement actuel inchangé
(`executedAt` = maintenant, `executedBy` = `'TODO:current-user'`, pas d'`origin`).

## 3. Main process

### 3.1 `TestsService.execute()` (`tests.service.ts`)

Utilise `dto.executedAt ?? now` (run **et** `stepResults[].executedAt`), `dto.executedBy ?? 'TODO:current-user'`,
recopie `dto.origin` s'il est présent. Rien d'autre ne change.

### 3.2 `CampaignsService.updateRun()` (`campaigns.service.ts`)

Paramètre optionnel en fin de signature : `meta?: { executedAt?: string; executedBy?: string }`.
`executedAt: meta?.executedAt ?? new Date().toISOString()` ; `executedBy` posé seulement s'il est
fourni. Canal IPC `campaigns:update-run` inchangé (le renderer ne le passe pas).

### 3.3 Génération : `services/export/campaign-execution.xlsx.ts`

Deux niveaux, pour tester sans Electron :

```ts
/** Pur : ce qui sera écrit, ligne par ligne (aucune dépendance exceljs). */
export function buildExecutionSheetModel(input: {
  campaign: TestCampaign
  entries: { run: CampaignTestRun; test: TestCase }[]   // test = snapshot ▸ live, params NON substitués
  locale: ExecutionSheetLocale
  exportedAt: string
}): ExecutionSheetModel

/** exceljs : mise en forme, protection, validations, feuille _polenta. */
export async function writeExecutionWorkbook(model: ExecutionSheetModel, destPath: string): Promise<void>
```

`buildExecutionSheetModel` : texte des étapes / pré-/postconditions = `markdownToPlainText(substituteRunParams(md, run))`,
images/diagrammes : `markdownToPlainText` les omet — on insère le repère `[image]` / `[diagramme]`
via un pré-passage sur les blocs fenced dédiés (même détection que #34). Paramètres de l'instance :
`resolvedParams` puis `paramValues`, `réf = valeur`, une par ligne, triés par clé.

**Mise en page de la feuille « Exécution »** (colonnes fixes, mêmes pour les deux types de ligne) :

| Col. | Clé | Ligne d'instance | Ligne d'étape | Saisie |
|------|-----|------------------|---------------|--------|
| A | `key` (masquée) | `entryId` | `entryId#order` | — |
| B | `instance` | `entryId` | — | — |
| C | `step` | — | `order` | — |
| D | `text` | `TEST-ID — titre` | action | — |
| E | `expected` | préconditions / postconditions | résultat attendu | — |
| F | `requirement` | `requirementId` | — | — |
| G | `params` | paramètres figés | — | — |
| H | `currentStatus` | libellé statut actuel | — | — |
| I | `verdict` | verdict global (liste globale) | verdict d'étape (liste étape) | ✔ |
| J | `tester` | testeur | — | ✔ (instance) |
| K | `date` | date d'exécution (`numFmt` date) | — | ✔ (instance) |
| L | `comment` | commentaire global | commentaire d'étape | ✔ |

- Lignes 1–3 : titre campagne (`ID — titre`), baseline / date d'export, bandeau. Ligne 5 : en-têtes,
  `autoFilter` sur le tableau, volet figé sous les en-têtes.
- Lignes d'étape : `outlineLevel = 1` (repliables sous leur instance). Ligne d'instance : fond
  coloré, gras. Cellules non saisissables : fond gris clair.
- Cellules saisissables : `protection.locked = false` ; `dataValidations` liste (`"Passé,Échoué,…"`)
  sur I selon le type de ligne, `allowBlank`, message d'erreur.
- `sheet.protect('', { autoFilter: true, sort: true, formatColumns: true, formatRows: true, selectLockedCells: true, selectUnlockedCells: true })`.
- Feuille `_polenta` en `state: 'veryHidden'` : `formatVersion`, `campaignId`, `exportedAt`, `locale`,
  puis une ligne par instance : `entryId`, `testCaseId`, `orders` (`"1,2,3"`).
- `wrapText` sur D/E/G/L, largeurs fixes.

**Limite connue (Excel)** : sur une feuille protégée, Excel refuse le tri d'une plage contenant des
cellules verrouillées, même avec `sort: true` ; le **filtre** fonctionne. Comme la protection n'a pas
de mot de passe, un testeur peut ôter la protection pour trier ; l'import étant fondé sur la clé
masquée, l'ordre des lignes est sans effet (CA 4 vérifié en réordonnant les lignes dans le script de
contrôle). À signaler dans `GH36-sprint1.md` → la spec §3.3 sera ajustée (« filtrer autorisé ;
trier après déprotection ») à la mise à jour SPEC.

### 3.4 Lecture / validation : `services/export/campaign-execution-import.ts`

```ts
/** exceljs → structure brute (aucune règle métier). */
export async function readExecutionWorkbook(filePath: string): Promise<RawExecutionSheet | { fatal: ExecutionImportFatal }>

/** Pur : règles §4.2 de la spec. */
export function validateExecutionImport(raw: RawExecutionSheet, ctx: {
  campaign: TestCampaign
  fallbackUser: string
  now: string
  filePath: string
}): ExecutionImportPreview
```

- La feuille de saisie est trouvée par l'ordre (1ʳᵉ feuille visible) — pas par son nom, qui dépend
  de la langue. Colonnes par position (A…L), lignes à partir de la ligne 6 ; seules comptent les
  lignes dont la clé (A) est non vide ; une ligne sans clé mais avec une valeur en I/J/K/L →
  `row_without_key`.
- Regroupement par `entryId` (clé avant `#`). « Remplie » = verdict global ou ≥ 1 verdict d'étape.
- `steps_mismatch` : ensemble des `order` trouvés ≠ `orders` de `_polenta` pour cet `entryId`
  (contrôlé seulement pour une instance remplie).
- Dates : `Date` exceljs (cellule date) → composantes **UTC** lues comme heure locale (Excel ne
  stocke pas de fuseau ; exceljs les expose en UTC) ; texte `AAAA-MM-JJ[ HH:mm]` ou
  `JJ/MM/AAAA[ HH:mm]` → heure locale ; sans heure → 12:00 locale (évite un changement de jour en
  UTC). Résultat stocké en ISO.
- Commentaires → Markdown : échappement `\ * _ ` [ ] # < >` et des marqueurs de liste en début de
  ligne ; une ligne non vide = un paragraphe (`\n\n`). Pas de détection de liens (texte seul).
- `wrong_campaign`, `unsupported_version`, `campaign_closed` → `fatal`.

### 3.5 Orchestration : `services/campaign-execution.service.ts` (nouveau, à plat)

```ts
export class CampaignExecutionService {
  constructor(campaigns: CampaignsService, tests: TestsService, testsIndex: TestsIndexService,
              auth: AuthService, git: GitService) {}
  exportSheet(repoPath, campaignId, locale, destPath, workspaceDir?): Promise<void>
  preview(repoPath, campaignId, filePath): Promise<ExecutionImportPreview>
  apply(repoPath, campaignId, filePath, workspaceDir?): Promise<ExecutionImportResult>
}
```

- `exportSheet` : refus si `completed`/`abandoned` ; tests = `testSnapshot` sinon lecture live
  (même repli que `resolveCampaignRuns` côté renderer, via `testsIndex.findById`) ; entrée dont le
  test est introuvable → ligne d'instance avec titre « (test introuvable) » et **aucune** étape ;
  à l'import, une telle instance remplie est en erreur `test_not_found` (le test source n'existe
  plus, `TestsService.execute` échouerait).
- `apply` : `preview()` (relit + revalide) ; si `fatal` → retour sans écriture. Puis pour chaque
  `importable`, **séquentiellement** : `tests.execute(repoPath, testCaseId, { stepResults, notes,
  result, requirementId, executedBy, executedAt, origin: 'excel-import' }, workspaceDir)` puis
  `campaigns.updateRun(repoPath, campaignId, entryId, status, run.id, { executedAt, executedBy })`.
  Exception → `failure` et arrêt.
- `fallbackUser` = `auth.getAuthor(repoPath).name`.
- Enregistré dans `container.ts`.

### 3.6 IPC (`ipc/index.ts`) + `api-client`

| Canal | Signature | Retour |
|-------|-----------|--------|
| `campaigns:execution-sheet-export` | `(repoPath, campaignId, locale, workspaceDir?)` — ouvre `showSaveDialog` (nom `<CAMP-ID>_execution_<AAAA-MM-JJ>.xlsx`, filtre xlsx) | `ExportResult` |
| `campaigns:execution-sheet-preview` | `(repoPath, campaignId)` — ouvre `showOpenDialog` (xlsx) | `ExecutionImportPreview \| { canceled: true }` |
| `campaigns:execution-sheet-apply` | `(repoPath, campaignId, filePath, workspaceDir?)` | `ExecutionImportResult` |

`api.campaigns.executionSheet.{export, preview, apply}` dans `packages/api-client` (types + `ipc-client.ts`).
Le serveur MCP n'expose rien (hors scope).

## 4. Renderer

### 4.1 `components/campaign/ExecutionSheetMenu.tsx` (nouveau)

Bouton `btn-secondary-sm` « Excel d'exécution » (icône `FileSpreadsheet`) + popover à 2 entrées :
« Exporter le classeur… » / « Importer des résultats… ». Inséré dans `actions` du `ViewHeader` de
`campaign.$campaignId.tsx`, après les `ExportButton`. **Masqué** si la campagne est
`completed`/`abandoned`. Export : popover de confirmation identique à `ExportButton` (chemin, Ouvrir
le dossier / Ouvrir le fichier via `api.export.showInFolder/openFile`). La langue passée = langue de
l'UI (`i18n.language` normalisé en `fr`/`en`).

### 4.2 `components/campaign/ExecutionImportModal.tsx` (nouveau)

Ouverte avec le résultat de `preview`. Sections : erreur fatale (seule section affichée si
présente) ; « À importer (N) » — tableau `entryId`, test, exigence, verdict (badge), testeur, date,
mention ⚠ « remplace le résultat existant (<statut>) » ; « En erreur (M) » avec message traduit par
code ; « Avertissements » ; « K instances non remplies ignorées ». Boutons « Importer N résultats »
(désactivé si N = 0) / « Annuler ». Après `apply` : si `failure` → message (instances déjà
importées + erreur) ; sinon toast « N résultats importés ». Dans tous les cas : invalidation
`['campaign', repoPath, id]`, `['campaigns', repoPath]`, `['traceability-matrix', repoPath]`,
`['test-runs', …]` (clés existantes).

Si l'aperçu revalidé à l'application diffère (`result.preview.importable.length` ≠ N affiché),
le message de fin l'indique (« la campagne a changé depuis l'aperçu : X importés »).

### 4.3 Relecture d'un run (`campaign.$campaignId_.run.$testId.tsx`)

Dans la ligne d'en-tête (`· date · executedBy`) : badge « Importé depuis Excel » si
`run.origin === 'excel-import'`.

### 4.4 i18n

Clés `campaignPage.executionSheet.*` (menu, modale, messages d'erreur par code, toast) dans
`fr.json` / `en.json`. Les libellés **du classeur** ne passent pas par i18n mais par
`EXECUTION_SHEET_LABELS` (§2.2) : le main les utilise pour écrire, et l'import doit reconnaître
les deux langues indépendamment de la langue de l'UI.

## 5. Fichiers touchés

| Fichier | Sprint | Modification |
|---------|--------|--------------|
| `packages/types/src/campaign-execution-sheet.ts` | 1 | nouveau (labels, parse verdicts, types aperçu/résultat) |
| `packages/types/src/parameter-refs.ts` | 1 | + `isT171Run`, `runParamLookup`, `substituteRunParams` (déplacés) |
| `packages/types/src/index.ts` | 1 | export du nouveau module |
| `packages/types/src/test.ts` | 2 | `TestRun.origin?` |
| `packages/zod-schemas/src/test.schema.ts` | 2 | `executedBy/executedAt/origin` optionnels |
| `apps/desktop/src/renderer/lib/testParams.ts` | 1 | ré-export des helpers déplacés |
| `apps/desktop/src/main/services/export/campaign-execution.xlsx.ts` | 1 | nouveau (modèle + écriture) |
| `apps/desktop/src/main/services/export/campaign-execution-import.ts` | 2 | nouveau (lecture + validation) |
| `apps/desktop/src/main/services/campaign-execution.service.ts` | 1 (export) / 2 (preview, apply) | nouveau |
| `apps/desktop/src/main/services/tests.service.ts` | 2 | `execute()` : executedBy/executedAt/origin |
| `apps/desktop/src/main/services/campaigns.service.ts` | 2 | `updateRun(…, meta?)` |
| `apps/desktop/src/main/container.ts` | 1 | enregistrement du service |
| `apps/desktop/src/main/ipc/index.ts` | 1 (export) / 2 | 3 canaux |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | 1 / 2 | `campaigns.executionSheet.*` |
| `apps/desktop/src/renderer/components/campaign/ExecutionSheetMenu.tsx` | 1 (export) / 2 (import) | nouveau |
| `apps/desktop/src/renderer/components/campaign/ExecutionImportModal.tsx` | 2 | nouveau |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | 1 | insertion du menu |
| `apps/desktop/src/renderer/routes/campaign.$campaignId_.run.$testId.tsx` | 2 | badge origine |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | 1 / 2 | clés `campaignPage.executionSheet.*` |
| `apps/desktop/scripts/check-gh36.ts` | 1 / 2 | script de contrôle (tsx), cf. tests |
| `specs/SPEC-TESTS.md`, `specs/SPEC-INDEX.md` | 2 | mise à jour SPEC |

## 6. Décisions techniques et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|----------|---------------------|--------|
| Canaux + composant dédiés | Nouveau `ExportKind` dans `ExportButton`/`export:save` | #34 réécrit ces fichiers (conflits) ; l'import n'a pas d'équivalent dans ce mécanisme ; le main a besoin du `repoPath` et des services (le pipeline export ne travaille que sur un payload) |
| Modèle construit côté **main** | Payload construit côté renderer (comme les autres exports) | L'import doit relire le même référentiel (`_polenta`, orders) : garder génération et lecture au même endroit ; pas d'aller-retour de gros payload |
| Relecture du fichier à `apply` | Cache de l'aperçu côté main (previewId) | Sans état, robuste à une campagne modifiée entre aperçu et import, pas de fuite mémoire |
| Clé technique en colonne masquée + `_polenta` veryHidden | Identification par position / par en-têtes | Robuste au tri/filtre, indépendant de la langue |
| Libellés classeur dans `@polenta/types` | i18n renderer passé en payload | L'import doit accepter FR **et** EN quelle que soit la langue de l'UI ; précédent `TEST_RUN_STATUS_LABELS` |
| Réutiliser `TestsService.execute` + `updateRun` | Écriture directe des YAML de run | Un résultat importé = une exécution dans l'outil (même ID de run, index, couverture T179) |
| Protection sans mot de passe | Mot de passe | Guide le testeur sans le bloquer ; la validation à l'import est la vraie garantie |
| Dépendance à #34 (`markdownToPlainText`) | Copie locale du helper | Pas de duplication ; #34 est au dernier sprint |

## 7. Découpage en sprints

**Sprint 1 — Export du classeur**
- Types `campaign-execution-sheet.ts` (labels, `parseStepVerdict`/`parseGlobalVerdict`, types).
- Déplacement des helpers de substitution vers `@polenta/types` + ré-export.
- `campaign-execution.xlsx.ts`, `CampaignExecutionService.exportSheet`, canal `…-export`, api-client.
- `ExecutionSheetMenu` (entrée Export seule active ; l'entrée Import n'apparaît pas encore), i18n.
- `check-gh36.ts` partie export (scénarios E*).

**Sprint 2 — Import des résultats**
- `TestRun.origin`, zod, `TestsService.execute`, `CampaignsService.updateRun(meta)`.
- `campaign-execution-import.ts`, `preview`/`apply`, canaux, api-client.
- `ExecutionImportModal`, entrée Import du menu, badge sur la relecture d'un run, i18n.
- `check-gh36.ts` partie import (scénarios I*), essai de bout en bout dans l'app (démo lave-linge).
- Mise à jour SPEC (`SPEC-TESTS` §3.2 `origin`, nouvelle §4.5 « Exécution hors outil (Excel) »,
  ajustement tri/protection), `SPEC-INDEX`.
