# GH439 — Design technique

Spec : `specs/GH439.md`. Scénarios : `specs/GH439-tests.md`.

## 1. Vue d'ensemble

```
Page /version/<ID>/requirements                    Export (xlsx / pdf)
        │                                                  │
  useVersionRequirements ── versions:requirements ──┐      ├─ xlsx : ExportButton kind « version-requirements »
        │            (IPC desktop / canal web)       │      │         → table.xlsx (+ feuille « Version »)
  VersionRequirementsGrid (DataGrid, lecture seule)  │      └─ pdf  : /print/version-requirements (même colonnes,
        │                                            ▼               mêmes filtres) → printToPDF / Chromium headless
  versionRequirementColumns (colonnes partagées) VersionRequirementsService
                                                     ├─ VersionsService.requirementsOf / schemaOf   (état de la version)
                                                     ├─ inPerimeter                                   (hors terminaux)
                                                     ├─ TraceabilityService.getMatrix                 (couverture, état courant)
                                                     ├─ VersionsService.designVersionsFor             (si colonne visible)
                                                     └─ VersionTrackingService.readWithFields         (« modifiée depuis », si visible)
```

Aucune écriture, aucun nouveau format de fichier, aucun changement du modèle de données.

## 2. Fichiers

### 2.1 À créer

| Fichier | Rôle |
|---|---|
| `packages/types/src/version-requirements.ts` | `VersionRequirementRow`, `VersionRequirementsPage`, `VersionRequirementsInclude` (exporté par l'index) |
| `apps/desktop/src/main/services/version-requirements.service.ts` | lecture : version → exigences du périmètre → colonnes calculées |
| `apps/desktop/src/main/services/version-requirements-rows.util.ts` | fonction pure `buildRequirementRows` (périmètre, tri, assemblage des colonnes), testable sans git |
| `apps/desktop/src/renderer/routes/version_.$versionId.requirements.tsx` | route `/version/$versionId/requirements` (le `_` évite l'imbrication sous `version.$versionId`, comme `versions_.backlog.tsx`) |
| `apps/desktop/src/renderer/components/versions/VersionRequirementsGrid.tsx` | grille et en-tête de la page |
| `apps/desktop/src/renderer/components/versions/versionRequirementColumns.ts` | définition des colonnes (`GridColumn<VersionRequirementRow>`), **partagée** par la grille et la route imprimable : le texte exporté est celui de l'écran par construction |
| `apps/desktop/src/renderer/components/versions/useVersionRequirements.ts` | hook de lecture (clé de requête, `include` déduit des colonnes visibles) |
| `apps/desktop/src/renderer/routes/print.version-requirements.tsx` | route imprimable du PDF |
| Tests : `version-requirements.gh439.test.ts` (main), `versionRequirementColumns.gh439.test.ts` (renderer), `e2e-web/gh439-version-requirements.spec.ts` | voir `GH439-tests.md` |

### 2.2 À modifier

| Fichier | Modification | Pourquoi |
|---|---|---|
| `packages/types/src/product-version.ts` | code d'erreur `VERSION_NOT_FROZEN` (version abandonnée sans gel) | refus explicite plutôt qu'une liste du disque |
| `packages/types/src/export.ts` | `ExportKind` += `'version-requirements'` ; `TableExportPayload.infoSheet?: { name: string; rows: { label: string; value: string }[] }` | un seul kind pour xlsx **et** pdf (`ExportButton` n'a qu'un `kind`) ; feuille d'identification |
| `apps/desktop/src/main/container.ts` | `VersionTrackingService` sorti de l'appel inline en constante, partagé ; instanciation du nouveau service | même instance (caches de contenu bornés) pour `VersionsService` et le nouveau service |
| `apps/desktop/src/main/ipc/index.ts` | `r.handle('versions:requirements', (_e, repoPath, id, include, workspaceDir) => c.versionRequirements.page(...))` | canal de lecture |
| `apps/desktop/src/web-server/channel-policy.ts` | `'versions:requirements'` dans la liste blanche, arguments chemin `[0, 3]` | client web (spec §5) |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | `versions.requirements(repoPath, id, include, workspaceDir?)` | contrat renderer |
| `apps/desktop/src/main/services/export.service.ts` | `'version-requirements:xlsx'` → `exportTableXlsx` (même générateur que `table:xlsx`) | pas de nouveau générateur xlsx |
| `apps/desktop/src/main/services/export/table.xlsx.ts` | écrit la feuille `infoSheet` si présente | identification du livrable |
| `apps/desktop/src/main/host/print-renderer.ts` | `PRINT_ROUTE_BY_KIND['version-requirements']` ; `PdfLayout` += `landscape?`, `pageNumbers?` ; `electronPdfLayout` / `playwrightPdfLayout` les traduisent (`landscape`, `displayHeaderFooter` + `footerTemplate`) | A4 paysage et pied « page n / N », les deux moteurs (Chromium) partagent la syntaxe |
| `apps/desktop/src/renderer/components/grid/GridToolbar.tsx` | `exportTable` accepte `kind?`, `formats?`, `getPrintParams?` (défaut inchangé : `table`, `['xlsx']`) | les grilles existantes ne changent pas |
| `apps/desktop/src/renderer/components/grid/exportTable.ts` | `buildTablePayload` accepte `infoSheet` | feuille « Version » |
| `apps/desktop/src/renderer/components/export/exportFilenames.ts` | `versionRequirementsExportBaseName(repo, label)` | nom proposé |
| `apps/desktop/src/renderer/routes/version.$versionId.tsx` | bouton « Exigences » (absent si version abandonnée sans gel) | accès |
| `apps/desktop/src/renderer/components/versions/useVersions.ts` | clé de requête dans `useInvalidateVersions` et dans le groupe d'invalidation de la couverture (celui de `validations:page`) | la page suit une exécution, un lien, une release sans recharger |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | clés `versionRequirements.*` | FR / EN |
| `apps/desktop/src/renderer/routeTree.gen.ts` | régénéré (la route est nouvelle) | convention du ticket qui ajoute une route |
| SPEC-REQ §11 (nouveau §11.5), SPEC-SYSTEM-VIEW (tableau Grilles communes), SPEC-WEB §11, SPEC-INDEX | dernier sprint | `WORKFLOW.md` Agent Dev |

## 3. Types

```ts
// packages/types/src/version-requirements.ts
export interface VersionRequirementsInclude {
  /** Colonne Design visible ; absente de la page sinon (aucun calcul). */
  design?: boolean
  /** Colonne « Modifiée depuis » visible. */
  changedSince?: boolean
}

export interface VersionRequirementRow {
  requirementId: string
  title: string
  objectTypeRef: string
  status: string                        // statut à l'état de la version
  version: number                       // révision de l'exigence à l'état de la version
  fields: Record<string, unknown>       // champs à l'état de la version
  coverageStatus: CoverageStatus        // état courant
  tests: Array<{ id: string; title: string }>
  /** Présent seulement si `include.design` ; `null` : jamais livrée à l'identique. */
  designVersion?: { id: string; title: string } | null
  /** Présent seulement si `include.changedSince` et version figée. */
  changedSince?: boolean
}

export interface VersionRequirementsPage {
  version: { id: string; title: string; state: VersionState; freeze: { tag: string; sha: string; at: string } | null }
  component: { label: string; repoPath: string }
  rows: VersionRequirementRow[]
  requirementFields: SchemaField[]                  // union des champs des types d'exigence (schéma du gel)
  requirementTypeLabels: Record<string, string>     // objectTypeRef → libellé
  requirementStatusLabels: Record<string, string>   // statut → libellé (schéma du gel)
  readonly: boolean
}
```

`requirementFields` et les libellés viennent du **schéma du gel** (`schemaOf`), pas du schéma courant : un type renommé
ou supprimé depuis ne casse pas la lecture (GH266). `readonly` ne bloque rien (lecture seule) mais s'affiche comme sur
les autres pages de version.

## 4. Service `VersionRequirementsService`

```ts
constructor(
  versions: Pick<VersionsService, 'get' | 'versionType' | 'schemaOf' | 'requirementsOf' | 'designVersionsFor' | 'isReadonly'>,
  traceability: Pick<TraceabilityService, 'getMatrix'>,
  tracking: Pick<VersionTrackingService, 'readWithFields'>,
)
async page(repoPath, versionId, include, workspaceDir?): Promise<VersionRequirementsPage>
```

Algorithme :

1. `version = await versions.get(repoPath, versionId)` (`VERSION_NOT_FOUND` sinon). `state = versionState(typeDef, version.status)`.
2. `state === 'abandoned' && !version.freeze` → `VersionError('VERSION_NOT_FROZEN')`.
3. `schema = await versions.schemaOf(repoPath, version)` ; `all = await versions.requirementsOf(repoPath, version)`
   (commit figé illisible → `VERSION_NOT_FOUND`, l'erreur remonte : jamais de liste vide) ;
   `reqs = inPerimeter(schema, all)` (réutilisé de `validation-rows.util.ts`).
4. Couverture : `matrix = await traceability.getMatrix(repoPath, {}, workspaceDir)`, indexée par ID : `{ status, tests }`.
   Même appel que `ValidationsService.liveColumns` : une exigence absente de la matrice vaut `not_covered`.
5. `include.design` → `versions.designVersionsFor(repoPath, reqs.map(r => r.state))`.
6. `include.changedSince && version.freeze` → pour chaque exigence, `tracking.readWithFields(repoPath, 'requirements/<ID>.yaml')`
   (disque) ; `changedSince = !current || current.state.key !== r.state.key` (fichier disparu : modifiée). Lectures **par lots
   bornés** (32 à la fois) : le verrou de tâches Git est global au processus (leçon GH335), pas de `Promise.all` sur tout
   le repo.
7. `rows = buildRequirementRows(...)` (pure : assemble, trie par ID numérique, n'ajoute `designVersion` / `changedSince`
   que si demandés).
8. `requirementFields`, libellés de types et de statuts : lus du schéma du gel, types de catégorie `requirement` du
   repo (`flattenSystemNodes`, comme `ValidationsService.requirementDisplay`).

Coût : `requirementsOf` lit un fichier par exigence à `freeze.sha` via le `git cat-file --batch-command` persistant du
repo (GH337) et un cache de contenu borné ; pas de processus par fichier. `getMatrix` parcourt le workspace comme pour la
validation.

### Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Réutiliser `SystemView` / `ExcelView` avec un paramètre « version » | ces composants sont liés au contexte (arbre, sélection, édition, éditeurs, vues d'équipe) et à l'index courant ; une lecture figée y demanderait un mode lecture seule dans 1 400 + lignes de composant. La grille commune (GH389) donne le même rendu, les mêmes filtres et le même 👁 sans ce couplage |
| Réutiliser `ValidationsService.page` | exige une validation existante et porte décisions, reprise, signature |
| Ajouter la liste au `VersionPage` existant | alourdit la page d'une version (lecture de toutes les exigences à chaque ouverture) pour un écran à part |
| Couverture recalculée au gel | relire liens, tests, exécutions à un commit : nouvelle brique et nouveau coût, hors besoin exprimé (décision D2) ; le calcul `computeCoverage` est pur et le permettrait plus tard sans changer le contrat |
| Copier la couverture dans le fichier de version à la release | nouveau champ système, migration des versions existantes, pas de reprise possible |
| Un kind d'export par format | `ExportButton` n'a qu'un `kind` ; deux kinds feraient deux boutons |

## 5. Renderer

### 5.1 Route et en-tête

`version_.$versionId.requirements.tsx` : mêmes paramètres de recherche que `version.$versionId.tsx` (`repoPath`,
`workspaceDir`). Charge la page via `useVersionRequirements`, rend `VersionRequirementsGrid`. Titre d'onglet
(`useSetTabTitle`) « Exigences — <label> ». L'en-tête reprend le `ViewHeader` de la page d'une version : pastille d'état,
`PageLink` vers la version, ligne d'information (spec § 2.2).

Erreur `VERSION_NOT_FROZEN` / `VERSION_NOT_FOUND` : `versionErrorText` (déjà utilisé par la page d'une version), message
dans la zone de la grille.

### 5.2 Colonnes

`buildVersionRequirementColumns({ page, t, language })` retourne la liste ordonnée des colonnes
(`id`, `title`, `status`, `objectTypeRef`, une colonne par champ, `version`, `coverageStatus`, `tests`, `designStatus`,
`changedSince`). Chaque colonne porte `getText` (texte affiché : export et filtre), `render` (cellule), `defaultVisible`.

- Défauts : `id`, `title`, `status`, champs `defaultVisible` du type (sinon trois premiers, `defaultVisibleFields`),
  `coverageStatus`.
- `coverageStatus` : `CoverageBadge` à l'écran ; `getText` = `t('system.coverage.status.<s>')` (filtrable sur le libellé,
  GH224). Le badge reçoit `coverage` et les tests : fournir l'adaptateur `{ coverageStatus, cells: [] }` si le badge exige
  des cellules (à vérifier au sprint 2, le tooltip liste les tests).
- Richtext : `htmlToCellText(fieldValueToText(v))`, comme la grille de validation.
- `id` : `ElementLink` (l'exigence courante) ; `designStatus` : `PageLink` vers la version.

### 5.3 Grille

`DataGrid` + `GridToolbar` (`gridId="version-requirements"`), préférences `useGridPrefs({ repoPath, prefKey:
'grid::version-requirements', view: 'columns', defaults })`, `useColumnFilters`, `useColumnLayout`, `useRowSelection`,
`useGridKeyboard`, `useGridScrollKey('version-requirements')`, `RowClamp`. Pas d'édition, pas de cases : la sélection
sert aux gestes communs.

`include` du hook = `{ design: visible.includes('designStatus'), changedSince: visible.includes('changedSince') }` :
cocher une de ces colonnes déclenche une nouvelle lecture (clé de requête distincte, `keepPreviousData`).

### 5.4 Export

`GridToolbar.exportTable` reçoit :

```ts
{ repoPath, title, getPayload: () => buildTablePayload(..., infoSheet), kind: 'version-requirements',
  formats: ['xlsx', 'pdf'], getPrintParams: () => ({ repoPath, versionId, workspaceDir, username, title,
                                                      filters: JSON.stringify(filters), filterKeys: JSON.stringify(filterKeys) }) }
```

- **xlsx** : `buildTablePayload` (GH389) produit lignes filtrées / colonnes visibles ; `infoSheet` = feuille « Version »
  (composant, label, état, tag, date de gel, commit figé, « n exportées / total », date d'export). Générateur
  `table.xlsx.ts` : une seconde feuille quand `infoSheet` est fourni.
- **pdf** : `api.export.save(..., 'pdf', undefined, printParams, ...)` → `PRINT_ROUTE_BY_KIND` → fenêtre cachée.

## 6. Route imprimable `/print/version-requirements`

Même patron que `print.executions.tsx` : `validateSearch` sur `repoPath, versionId, workspaceDir, username, title, filters,
filterKeys` ; recharge la page (`versions:requirements`), lit les colonnes visibles du `.pref` (`grid::version-requirements`,
vue `columns`), construit les colonnes avec **le même** `buildVersionRequirementColumns`, applique `filters` (même fonction
que la grille, `columnFilters`), rend :

- bloc d'identification (mêmes lignes que la feuille « Version ») ;
- `<table>` statique : `thead` en `display: table-header-group` (répété à chaque page), `tr { break-inside: avoid }`,
  cellules texte (badge de couverture rendu en texte coloré) ;
- appelle `useNotifyPrintReady(loaded && prefsLoaded)`.

`include` = colonnes visibles du `.pref` (même règle que l'écran). Largeur de colonne : proportionnelle aux largeurs
enregistrées, sinon automatique ; `word-break` sur les champs longs.

`PDF_LAYOUT_BY_KIND['version-requirements'] = { scale: 1, marginMm: PRINT_MARGIN_MM, landscape: true, pageNumbers: true }` :
Electron `printToPDF({ landscape, displayHeaderFooter, headerTemplate: '<span></span>', footerTemplate })`, Playwright
`page.pdf({ landscape, displayHeaderFooter, … })` ; `footerTemplate` utilise les classes `pageNumber` / `totalPages` de
Chromium. L'échelle reste 1 (pas la réduction du dashboard).

## 7. Décisions techniques

- **Vérification = état courant** (D2) : même fonction que la vue exigence, sans nouvelle lecture historique. Le contrat
  (`coverageStatus` par ligne) ne change pas si une version future la calcule au gel.
- **Pas de cache côté main** : la page se recalcule à chaque lecture ; l'invalidation du renderer (`useInvalidateVersions`
  + groupe couverture) suffit. Les lectures figées profitent du cache de contenu borné de `VersionTrackingService`.
- **Colonnes calculées à la demande** (`include`) : évite de lire le design (parcours des versions released) et l'état
  courant de chaque exigence quand l'utilisateur ne les affiche pas (critère 3).
- **Aucun tri** (règle des grilles communes) : ordre des ID.
- **Indicateurs** : aucun compteur calculé (GH79) ; le « n / total » de la barre d'outils est celui de toute grille.

## 8. Découpage en sprints

| Sprint | Contenu | Vérification |
|---|---|---|
| **1 — Données** | types, `VersionRequirementsService` + util pure, `VERSION_NOT_FROZEN`, canal IPC + liste blanche web, client API, câblage conteneur, tests unitaires | niveau 2 (typecheck, lint, `pnpm test`) ; aucune UI |
| **2 — Écran** | route, grille, colonnes partagées, préférences, bouton sur la page version, i18n, invalidation, e2e web de l'écran (U1–U13, U16–U18 hors export) | niveau 2 + `e2e-web/gh439-` |
| **3 — Exports** | `ExportKind`, `infoSheet`, générateur, route imprimable, `PdfLayout` (paysage, pied), `GridToolbar` étendu, e2e export (U14, U15), mise à jour des SPEC, `GH439-sprint3.md` | niveau 2 ; PDF vérifié comme `s4-print.spec.ts` |

Dernier sprint : mise à jour de SPEC-REQ §11.5, SPEC-SYSTEM-VIEW (ligne dans le tableau des grilles), SPEC-WEB §11,
SPEC-INDEX (colonne `MAJ`).

## 9. Risques

| Risque | Parade |
|---|---|
| Volume (milliers d'exigences) : lecture du gel + saturation de la file de tâches Git (leçon GH335) | lectures par lots bornés, test au-delà du seuil (`GH439-tests.md` L1) |
| PDF : tableau large coupé, lignes tronquées entre deux pages | paysage, `break-inside: avoid`, en-tête répété ; vérifié sur un jeu de 300 lignes avec champs richtext longs |
| Texte exporté différent de l'écran | colonnes partagées entre grille, xlsx et route imprimable ; test de parité (`GH439-tests.md` P1) |
| `CoverageBadge` exige des cellules de matrice | adaptateur au sprint 2 ; sinon texte seul + `title` |
| Route nouvelle : `routeTree.gen.ts` | régénéré et commité dans ce ticket (il ajoute une route) |
