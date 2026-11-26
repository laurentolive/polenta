# GH439 — Design technique (révision 3)

> Révision 3 (2026-11-26) : périmètre de la liste = contenu cumulé de la lignée (`VersionsService.availableRequirementIds`,
> § 5, § 4) ; le reste est inchangé. Une version released dont la couverture est figée lit son périmètre dans les lignes de
> `verification` (immuable) ; la lignée n'est lue que pour une version en cours ou sans couverture figée.

Spec : `specs/GH439.md`. Scénarios : `specs/GH439-tests.md`.

## 1. Vue d'ensemble

```
Page /version/<ID>  (version.$versionId.tsx)
 ├─ ViewHeader : titre, ID + pastille d'état, actions [Exporter] [🔒] [tag en attente] [Release]
 └─ sections repliables (SectionToggle + useSectionOpen) :
      Informations · Composants · Changements · Analyse d'impact · Tests à exécuter · Exigences (fermée, lazy)
                                                                                       │
                                                         useVersionRequirements ── versions:requirements ── VersionRequirementsService
                                                                                                              ├─ VersionsService.requirementsOf/schemaOf (état de la version)
                                                                                                              ├─ inPerimeter                              (hors terminaux)
                                                                                                              └─ version.verification (figée)  |  TraceabilityService.getMatrix (en cours)

Passage released (VersionsService.release) ──► + verification { computedAt, rows[] } dans le commit du fichier de version

Exporter (ExportButton, choix de sections)
   ├─ xlsx : buildVersionSectionTables(...) → TablesExportPayload → 'version:xlsx' → un onglet par section
   └─ pdf  : /print/version (mêmes données, même buildVersionSectionTables) → printToPDF / Chromium headless
```

Un seul nouveau champ persistant : `verification` dans le fichier de version, posé au passage released.

## 2. Modèle de données

```ts
// packages/types/src/product-version.ts
export interface VersionVerificationRow { id: string; status: CoverageStatus; tests: string[] }
export interface VersionVerification { computedAt: string; rows: VersionVerificationRow[] }   // rows triées par ID

export interface ProductVersion { /* … */ verification?: VersionVerification }
```

- Champ système : écrit par `release()` seulement, jamais par `update()` (même garde que `analysis`, `freeze`).
- `copy()` reconstruit la version à partir de champs choisis : `verification` n'en fait pas partie (test).
- Renommage de schéma (GH381 `rewriteObjects`) : la valeur d'un `CoverageStatus` n'est pas un statut du projet, rien à migrer.
- `VersionPage` (`versions:get`) **n'embarque pas** `verification` (volumineux : une ligne par exigence) : retiré de
  l'objet `version` renvoyé ; lecture par `versions:requirements` seulement. À vérifier au sprint 1 comment `page()`
  construit aujourd'hui cet objet (il renvoie peut-être déjà `analysis` tel quel) pour appliquer la même règle sans
  régression.
- CLAUDE.md (« Champs propres aux versions »), SPEC-REQ §11.1 : ajouter `verification` (dernier sprint).

## 3. Fichiers

### 3.1 À créer

| Fichier | Rôle |
|---|---|
| `packages/types/src/version-requirements.ts` | `VersionRequirementRow`, `VersionRequirementsPage` |
| `apps/desktop/src/main/services/version-requirements.service.ts` | lecture des exigences d'une version (état de la version + couverture) |
| `apps/desktop/src/main/services/version-requirements-rows.util.ts` | `buildRequirementRows` pure : périmètre, tri, assemblage, testable sans git |
| `apps/desktop/src/main/services/version-verification.util.ts` | `buildVerification(requirements, matrix, now)` pure : rows triées pour le gel |
| `renderer/components/versions/VersionRequirementsSection.tsx` | section « Exigences » : ligne d'information, grille |
| `renderer/components/versions/versionRequirementColumns.ts` | `buildVersionRequirementColumns({ page, t, language, gestures })` |
| `renderer/components/versions/versionChangeColumns.ts`, `versionTestColumns.ts`, `versionAnalysisColumns.ts` | colonnes **extraites** des trois grilles existantes (voir § 7) |
| `renderer/components/versions/versionSectionTables.ts` | `buildVersionSectionTables(input)` → `SectionTable[]`, **partagée** par l'export Excel et la route imprimable |
| `renderer/components/versions/VersionInfoSection.tsx` | section « Informations » (bloc d'en-tête déplacé) |
| `renderer/components/versions/useVersionRequirements.ts` | hook de lecture (`enabled` = section ouverte) |
| `renderer/components/versions/useVersionExport.ts` | sections proposées, collecte des données, `getPayload` / `getPrintParams` |
| `renderer/routes/print.version.tsx` | route imprimable `/print/version` |
| Tests : `version-requirements.gh439.test.ts`, `versions.release-verification.gh439.test.ts` (main) ; `versionSectionTables.gh439.test.ts` (renderer) ; `e2e-web/gh439-version-page.spec.ts`, `e2e-web/gh439-version-export.spec.ts` | voir `GH439-tests.md` |

### 3.2 À modifier

| Fichier | Modification | Pourquoi |
|---|---|---|
| `packages/types/src/product-version.ts` | `verification?`, code `VERSION_NOT_FROZEN` | § 2 ; refus d'une version abandonnée sans gel |
| `packages/types/src/export.ts` | `ExportKind` += `'version'` ; `TablesExportPayload { sheets: TableExportPayload[] }` | export multi-onglets |
| `main/services/versions.service.ts` | `release()` calcule et écrit `verification` ; `setImpactSources` reçoit aussi `getMatrix` ; `page()` retire `verification` | § 4 |
| `main/container.ts` | `new VersionRequirementsService(...)` ; `versions.setImpactSources({ traceability, campaigns })` (traceability expose déjà `getMatrix`) | câblage |
| `main/ipc/index.ts`, `web-server/channel-policy.ts` | canal `versions:requirements` (args chemin `[0, 2]`) | desktop et web |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | `versions.requirements(repoPath, id, workspaceDir?)` | contrat |
| `main/services/export.service.ts`, `export/table.xlsx.ts` | `'version:xlsx'` → `exportTablesXlsx` : un onglet par `TableExportPayload` (`addTableSheet` extrait de `buildTableWorkbook`) ; noms d'onglet uniques | multi-onglets |
| `main/host/print-renderer.ts` | `PRINT_ROUTE_BY_KIND.version`, `PdfLayout` += `landscape?`, `pageNumbers?` (+ `electronPdfLayout`, `playwrightPdfLayout`) | A4 paysage, pied de page |
| `renderer/components/export/ExportButton.tsx` | prop `choices?: { items: { key; label }[]; storageKey }` : cases à cocher dans le popover, sélection transmise à `getPayload(format, { templated, selected })` et `getPrintParams(selected)` ; formats désactivés sans sélection | choix de sections |
| `renderer/routes/version.$versionId.tsx` | sous-titre ID + pastille toujours ; plus de `useHeaderCollapsed` ni de bouton ; `Exporter` dans `actions` ; sections `Informations`, `Exigences` ; `Composants` sorti du bloc d'en-tête ; `OrphanComponents` toujours visible | § 2 de la spec |
| `renderer/components/versions/useVersions.ts` | `useSectionOpen(section, defaultOpen = true)` ; clé de requête dans `useInvalidateVersions` | `Exigences` fermée par défaut |
| `renderer/components/versions/VersionChangesTable.tsx`, `VersionTestsSection.tsx`, `VersionAnalysisSection.tsx` | colonnes déléguées aux modules extraits ; `noExport` sur leur `DataGrid` | D9 |
| `renderer/components/grid/useHeaderCollapsed.ts` | type `page` réduit à `'validation'` | la version n'en a plus |
| `renderer/components/export/exportFilenames.ts` | `versionExportBaseName(repo, label)` | nom proposé |
| `renderer/i18n/locales/{fr,en}.json` | `versions.info`, `versions.requirements.*`, `versions.export.*` | FR / EN |
| `renderer/routeTree.gen.ts` | régénéré (route `/print/version`) | nouvelle route |
| `e2e-web/gh389-versions.spec.ts` | scénario de repli de l'en-tête → section « Informations » ; `expectGridContract` : bouton Exporter absent des trois grilles de la page | D9, spec § 2.1 |
| SPEC-REQ §11 (§11.1 `verification`, §11.5 section Exigences), SPEC-SYSTEM-VIEW (grilles, export), SPEC-ELECTRON-DESKTOP §19.8b / §19.15, SPEC-WEB §11, SPEC-INDEX, CLAUDE.md | dernier sprint | `WORKFLOW.md` Agent Dev |

## 4. Couverture figée au passage released

Dans `VersionsService.release()`, à côté de `freezeAnalysis` (même commit, même `stamp`) :

```ts
const verification = this.impactSources ? await this.freezeVerification(repoPath, head, workspaceDir) : undefined
// ... { ...version, ..., freeze, ...(analysis && { analysis }), ...(verification && { verification }) }
```

`freezeVerification(repoPath, head, workspaceDir)` :

1. `{ requirements } = await perimeterOf(repoPath, { ...version, freeze })` — **la même fonction que la lecture**, donc
   la même liste que celle que la page affichera à `freeze.sha` : exigences **disponibles dans la version** (incluses dans
   la version ou sa lignée), non terminales, lues à `freeze.sha` avec le schéma de ce commit.
2. `matrix = await impactSources.traceability.getMatrix(repoPath, {}, workspaceDir)` (état du workspace au passage,
   comme l'analyse d'impact — précédent GH245 : « calculée sur l'état du workspace au moment du passage »).
3. `buildVerification(reqs, matrix, new Date())` (pure) : une ligne par exigence du périmètre `{ id, status, tests: [IDs] }`,
   `status = 'not_covered'` si absente de la matrice, rows triées par ID numérique.

Une erreur de lecture de la matrice **fait échouer le passage** (comme la validation : sans matrice, tout paraîtrait non
couvert) — rien n'est écrit, la version reste en cours. `impactSources` absent (tests unitaires sans traçabilité) :
pas de `verification`, comportement d'aujourd'hui.

Écart connu, assumé (précédent GH245) : la couverture lit le **workspace**, `freeze.sha` est `HEAD`. Un lien ou une
exécution non commités au moment du passage sont comptés dans `verification` sans être dans le commit figé. Le message
du passage n'y change rien ; la ligne d'information dit « figée à la release », pas « à `freeze.sha` ».

## 5. Service de lecture

```ts
class VersionRequirementsService {
  constructor(
    versions: Pick<VersionsService, 'get' | 'versionType' | 'schemaOf' | 'requirementsOf' | 'isReadonly'>,
    traceability: Pick<TraceabilityService, 'getMatrix'>,
  )
  page(repoPath, versionId, workspaceDir?): Promise<VersionRequirementsPage>
}
```

```ts
interface VersionRequirementRow {
  requirementId: string; title: string; objectTypeRef: string
  status: string; version: number; fields: Record<string, unknown>   // à l'état de la version
  coverageStatus: CoverageStatus | null                               // null : non figée (version released avant GH439) ou ligne absente
  tests: string[]
}
interface VersionRequirementsPage {
  version: { id; title; state: VersionState; freeze: { tag; sha; at } | null }
  component: { label; repoPath }
  verification: 'frozen' | 'missing' | 'live'     // origine de la colonne Vérification
  rows: VersionRequirementRow[]
  requirementFields: SchemaField[]                // union des champs des types d'exigence, schéma du gel
  requirementTypeLabels: Record<string, string>
  requirementStatusLabels: Record<string, string>
}
```

Algorithme de `page` :

1. `version = versions.get(...)` ; `state = versionState(...)`. `abandoned && !freeze` → `VersionError('VERSION_NOT_FROZEN')`.
2. `{ schema, requirements } = versions.perimeterOf(repoPath, version)` : `requirementsOf` lit les exigences du repo à
   l'état de la version (commit absent → `VERSION_NOT_FOUND`, remonte : pas de liste vide), `availableRequirementIds`
   en retient celles **livrées par la lignée** (incluses dans la version ou une version released de `basedOn`, une
   version abandonnée ne livre rien, garde anti-cycle), `inPerimeter` écarte les terminales ; schéma illisible : erreur.
3. `version.freeze` :
   - `version.verification` présent → `verification: 'frozen'`, couverture par ID depuis `rows` ;
   - absent → `'missing'`, `coverageStatus: null` partout (U8).
   `freeze` absent (en cours) → `getMatrix(repoPath, {}, workspaceDir)` indexé par ID → `'live'` (une exigence absente de la
   matrice vaut `not_covered`, comme `ValidationsService.liveColumns`).
4. `rows = buildRequirementRows(...)` (pure, tri numérique) ; champs et libellés lus du **schéma du gel**
   (`flattenSystemNodes`, types de catégorie `requirement`).

Une version released lit **zéro** couverture dans l'état courant : ni matrice, ni exécutions (critère 2 par construction).

### Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Recalculer la couverture à `freeze.sha` (relire liens, tests, exécutions à un commit) | nouvelle brique de lecture historique, coûteuse ; le besoin est « ce qui était vérifié à la release », une copie à la release le donne exactement |
| Couverture courante + colonne « Modifiée depuis » (révision 1) | refusé par l'humain (D2) ; la copie rend la colonne inutile |
| Mettre `verification` dans `analysis` | `analysis` est l'analyse d'impact (racines, lignes d'impact) ; un autre sujet, un autre cycle de lecture |
| Page dédiée `/version/<ID>/requirements` (révision 1) | refusée (D5) : la section suit le motif des autres sections de la page |
| Un export par grille | refusé (D6) : export global avec choix de sections |
| Réutiliser `SystemView` / `ExcelView` | liés au contexte (arbre, sélection, édition) et à l'index courant ; la grille commune (GH389) donne le même rendu |

## 6. Section « Exigences » (renderer)

- `VersionRequirementsSection` reçoit `repoPath`, `projectId`, `versionId`, `state`, `freeze` ; état `open` via
  `useSectionOpen('requirements', false)` ; `useVersionRequirements(..., enabled = open)`.
- `DataGrid` (`gridId="version-requirements"`, `noExport`), préférences `{ repoPath, prefKey: 'grid::version-requirements',
  view: 'columns', defaults }`, `useGridScrollKey('version-requirements')`. Pas d'édition, pas de cases.
- Colonnes (`buildVersionRequirementColumns`) : `getText` = texte affiché ; `coverageStatus` : `CoverageBadge` à l'écran,
  libellé `system.coverage.status.<s>` en texte, « — » quand `coverageStatus === null`. Le badge exige peut-être des
  cellules de matrice : adaptateur `{ coverageStatus, cells: [] }` (à vérifier au sprint 2 ; sinon texte + `title`).
- Richtext : `htmlToCellText(fieldValueToText(v))`.
- Ligne d'information : trois textes selon `page.verification` (spec § 2.3).
- Invalidation : clé `['versions', 'requirements', repoPath, id, workspaceDir]` dans `useInvalidateVersions` ; pour une version
  en cours elle suit aussi le groupe d'invalidation de la couverture (celui de `validations:page`) — à confirmer au sprint 2.

## 7. Section « Informations » et mise en page

- `VersionInfoSection` reprend, sans changement de comportement, le bloc `version-header` (libellé, statut, basée sur,
  tag figé, champs du type, Enregistrer / Annuler). Même `SectionToggle` que les autres (compteur rendu **optionnel**),
  `useSectionOpen('info')`, `data-testid="version-info-toggle"` / `"version-info"`.
- `Composants` : redevient une section de premier niveau, `useSectionOpen('components')` (déjà existant) ;
  `OrphanComponents` rendu **hors section** (alerte).
- Barre de titre : `subtitle = <span>{version.id}<pastille d'état/></span>` toujours ; `actions` sans bouton de repli.
- `useHeaderCollapsed('version')` retiré de la page ; le hook ne sert plus qu'à la validation (type `'validation'`).
- `SectionToggle` est aujourd'hui local à `version.$versionId.tsx` : le sortir dans `components/versions/SectionToggle.tsx`
  (compteur optionnel) pour que `Informations`, `Exigences` et les autres l'utilisent.

### Colonnes extraites des trois grilles existantes

`VersionChangesTable`, `VersionTestsSection` et `VersionAnalysisSection` définissent leurs colonnes dans un `useMemo`. Elles
passent dans des fonctions pures :

```ts
buildVersionChangeColumns({ t, gestures, removable }): GridColumn<VersionChangeRow>[]
buildVersionTestColumns({ t }): GridColumn<VersionTestToRun>[]
buildVersionAnalysisColumns({ t, titleOf }): GridColumn<VersionImpactRow>[]
```

Les composants les appellent dans leur `useMemo` ; l'export les appelle avec des gestes inertes (précédent :
`buildExecutionColumns` + `INERT_GESTURES` de `print.executions.tsx`). **Pas de duplication** des `getText` : le texte
exporté est celui de l'écran. Colonnes de gestes (`actions`, `diff`) : exclues de l'export par clé.

## 8. Export global

### 8.1 Choix des sections et collecte (`useVersionExport`)

Sections proposées : `info`, `components` (si la version a des composants), `changes`, `analysis` et `tests` (si état ≠
abandonnée), `requirements` (si la section est disponible). `ExportButton` reçoit `choices` (cases, mémorisation
`localStorage` par poste en `try/catch`) ; pas de sélection → formats désactivés.

`getPayload('xlsx', { selected })` :

1. données déjà chargées par la page : `page` (versions:get), `impactQuery.data` (analyse, tests) ;
2. `requirements` : `queryClient.fetchQuery(['versions','requirements',…])` — chargée **même section fermée** ;
3. colonnes visibles : `api.pref.getFieldVisibility(repoPath, username, 'grid::<id>')` + `gridPrefKeys('columns')`, défauts
   de chaque grille (`DEFAULTS` des composants, exportés) — **mêmes préférences que l'écran** ;
4. `buildVersionSectionTables({ selected, page, impact, requirements, visibleColumns, t, language })` → `SectionTable[]` ;
5. `TablesExportPayload = { sheets: tables.map(toTableExportPayload) }` (`sheetNameOf(label)`, largeurs enregistrées).

### 8.2 `buildVersionSectionTables`

Fonction pure, `SectionTable = { id, title, columns: { key; label; width? }[], rows: Record<string,string>[] }`.

- `info` : colonnes Champ / Valeur, lignes : libellé, état, statut, basée sur, tag, date de gel, commit (7 caractères),
  champs du type version (`fieldValueToText`), composant, exporté le.
- `components` : composant, version retenue, état.
- `changes`, `tests`, `analysis`, `requirements` : colonnes des modules extraits, restreintes aux clés visibles dans
  l'ordre, `getText` de chaque ligne ; **aucun filtre**.
- Aucun accès réseau ni DOM : testable en unitaire.

### 8.3 xlsx

`'version:xlsx'` → `exportTablesXlsx(payload, dest)` : `new ExcelJS.Workbook()`, pour chaque feuille
`addTableSheet(workbook, sheet)` (en-tête gras, volets figés, largeurs, hyperliens) ; noms d'onglets dédoublonnés.

### 8.4 PDF

`api.export.save(repoPath, 'version', 'pdf', undefined, printParams, suggestedName)`, `printParams = { repoPath, projectId,
versionId, sections: 'info,changes,…', username, language }`. Route `/print/version` :

- recharge `versions:get`, `versions:impact` (si besoin), `versions:requirements` (si besoin) et les préférences de colonnes ;
- appelle **la même** `buildVersionSectionTables` ;
- rend titre et identification, puis pour chaque section un `<h2>` et un `<table>` statique : `thead { display:
  table-header-group }`, `tr { break-inside: avoid }`, badge de couverture rendu en texte, `word-break` sur les champs longs ;
- `useNotifyPrintReady(true)` quand toutes les requêtes sont terminées.

`PDF_LAYOUT_BY_KIND.version = { scale: 1, marginMm: PRINT_MARGIN_MM, landscape: true, pageNumbers: true }` : Electron
`printToPDF({ landscape, displayHeaderFooter, headerTemplate: '<span></span>', footerTemplate })`, Playwright
`page.pdf({ landscape, displayHeaderFooter, … })` ; le pied utilise les classes `pageNumber` / `totalPages` de Chromium.

### 8.5 Retrait des exports de grille (D9)

`DataGrid` a déjà `noExport` : posé sur `version-changes`, `version-tests`, `version-analysis` (grilles de la page version).
Les grilles du Backlog, de la validation, des campagnes… gardent leur export.

## 9. Décisions techniques

- **Copie à la release plutôt que recalcul** : une donnée lue à la release, une fois ; la page n'a plus aucun lien avec
  l'état courant pour une version figée.
- **Une seule fonction de tables** (`buildVersionSectionTables`) pour Excel et PDF : parité par construction (critère 6).
- **Colonnes extraites, pas dupliquées** : l'export suit l'écran quand une colonne change.
- **Chargement paresseux** : la section « Exigences » ne lit rien fermée ; l'export la charge à la demande.
- **Aucun tri, aucun filtre exporté** (D10).
- **Indicateurs** : aucun agrégat calculé (GH79).

## 10. Découpage en sprints

| Sprint | Contenu | Vérification |
|---|---|---|
| **1 — Données** | `verification` (types, `freezeVerification`, `buildVerification`), `VersionRequirementsService` + util, `VERSION_NOT_FROZEN`, canal IPC + liste blanche web + client API, câblage, tests unitaires | niveau 2 (typecheck, lint, `pnpm test`) ; aucune UI |
| **2 — Page** | `SectionToggle` partagé, section « Informations », barre de titre, section « Exigences », colonnes extraites des trois grilles, `useSectionOpen(…, defaultOpen)`, i18n, mise à jour de `gh389-versions.spec.ts`, e2e web de la page (U1–U15, U22–U25 hors export) | niveau 2 + `e2e-web/gh439-version-page` |
| **3 — Export** | `ExportButton` + `choices`, `buildVersionSectionTables`, `useVersionExport`, kind `version`, `exportTablesXlsx`, route `/print/version`, `PdfLayout`, `noExport` des trois grilles, e2e export (U16–U21), mises à jour des SPEC, `GH439-sprint3.md` | niveau 2 ; PDF vérifié comme `s4-print.spec.ts` |

## 11. Risques

| Risque | Parade |
|---|---|
| Version released avant GH439 : colonne vide | ligne d'information explicite (D2b), cas U8 testé |
| `verification` volumineuse dans le fichier de version (milliers d'exigences) | une ligne `{id, status, tests}` par exigence, IDs de test seuls ; test sur 1 500 exigences (taille et durée du passage) |
| Passage released plus long (matrice + lecture du périmètre) | même coût que l'analyse d'impact déjà calculée au passage ; mesuré au sprint 1 |
| Saturation de la file de tâches Git à la lecture d'un gros périmètre (leçon GH335) | `requirementsOf` lit via le `cat-file --batch-command` persistant (GH337), cache de contenu borné ; test au-delà du seuil |
| Export : texte différent de l'écran | colonnes extraites + fonction de tables unique ; test de parité grille / xlsx / PDF |
| PDF : tableau large, lignes coupées | paysage, `break-inside: avoid`, en-tête répété ; vérifié sur 300 lignes à champs richtext longs |
| Régression de la page (en-tête déplacé, Composants sorti du bloc replié) | e2e de la page, `gh389-versions.spec.ts` adapté, test du retour de défilement (GH300) |
| `ExportButton` : clic souris dans le popover (leçon GH416) | test au clic souris sur les cases et sur les formats |
| Route nouvelle : `routeTree.gen.ts` | régénéré et commité dans ce ticket |
