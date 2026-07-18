# T43 — Design technique

**Statut** : coding sprint 1
**Branche** : T43
**Worktree** : `../polenta-T43/`

> **Correction post-sprint 1** : `requirements.tsx`/`tests.tsx` (cibles décrites ci-dessous) sont en
> réalité des routes mortes, jamais montées depuis l'ActivityBar/Sidebar — voir la note en tête de
> `T43.md` et `T43-sprint1.md` pour le détail. Le sprint 1 a été implémenté contre `SystemView.tsx`
> à la place (même slot `ViewHeader.actions`, payload construit depuis `rawObjects` filtré au lieu
> de la variable `filtered` de `requirements.tsx` — le mécanisme générique IPC/service/générateurs
> décrit plus bas n'a pas eu besoin de changer). **Sprint 2 doit vérifier `tests.tsx` en premier**
> avant de s'y brancher.

---

## Vue d'ensemble des couches

- **Main process** : un service unique `export.service.ts` qui dispatche par format (`xlsx`/`docx`/`pdf`),
  plus un utilitaire `pdf.util.ts` (fenêtre Electron cachée + `webContents.printToPDF`). Un seul canal IPC
  générique `export:save`, pas un canal par type de contenu — évite la duplication du pattern
  `dialog.showSaveDialog` déjà vu 15 fois (7 types × jusqu'à 3 formats).
- **Renderer** : un composant partagé `<ExportButton>` (popover de choix de format) inséré dans le slot
  `actions` de chaque `ViewHeader` concerné, plus un jeu de **routes imprimables** dédiées
  (`/print/requirements`, `/print/tests`, `/print/campaign-plan`, `/print/campaign-report`,
  `/print/impact-analysis`, `/print/dashboard`) chargées uniquement par la fenêtre cachée pour la
  génération PDF (jamais visitées par l'utilisateur).
- **Types partagés** : nouveau fichier `packages/types/src/export.ts` (`ExportFormat`, `ExportKind`,
  `ExportResult`).

---

## Décision structurante : deux mécanismes de génération de contenu, pas un seul

C'est la décision technique centrale du design, elle conditionne tout le reste.

| Format | Mécanisme | Pourquoi |
|---|---|---|
| **xlsx** | Construction programmatique côté main (`ExcelJS`), à partir du **payload envoyé directement par le renderer** (données déjà chargées/filtrées en mémoire — comme le fait déjà `queries:export-excel` aujourd'hui) | Format structuré (cellules, feuilles) — pas de rendu visuel à reproduire |
| **docx** | Construction programmatique côté main (nouvelle lib `docx`), à partir du **même payload** | Idem : styles/paragraphes/tableaux Word, pas de rendu HTML à convertir |
| **pdf** | **Rendu réel d'une route React dédiée** (`/print/<kind>`) dans une `BrowserWindow` cachée, puis `webContents.printToPDF()` | Le contenu à exporter en PDF (dashboard avec graphiques Recharts, richtext des exigences/tests) est déjà correctement rendu par des composants React existants — les reconstruire en HTML côté main dupliquerait cette logique de rendu (mise en forme richtext, thème des charts) sans garantie de rester synchronisé avec l'UI réelle |

**Conséquence pratique** : pour xlsx/docx, le renderer envoie les **données** (payload) via IPC. Pour pdf,
le renderer envoie des **paramètres d'identification** (ex. `repoPath`, `filter`, `type`, `campaignId`,
`analysisId`, `dashboardId`, `queryId`) que la route `/print/<kind>` utilise pour **recharger et refiltrer
elle-même** les données (réutilise les mêmes fonctions de filtrage que la vue normale, extraites en
utilitaires partagés — ex. `filterRequirements(list, {filter, type})` utilisée à la fois par
`requirements.tsx` et `print/requirements.tsx`). C'est une asymétrie assumée entre les deux mécanismes,
documentée explicitement pour ne pas surprendre en Dev : le payload IPC n'a pas la même forme selon le
format demandé.

**Alternative rejetée** : construire le PDF aussi par génération de HTML string côté main (comme pour un
mailer classique). Rejetée — duplique la logique de rendu richtext (TipTap) et graphique (Recharts) déjà
écrite côté renderer, coûteux à maintenir en synchronisation, et le rendu visuel (thème, polices, mise en
page) diverge inévitablement de ce que l'utilisateur voit à l'écran.

**Alternative rejetée** : capturer le DOM de la fenêtre principale visible (`html2canvas` ou capture de la
`webContents` réelle) plutôt qu'une route dédiée. Rejetée — capture le chrome de l'application (sidebar,
activity bar, dark mode) et les états d'édition en cours, alors qu'une route imprimable dédiée donne un
contrôle total sur la mise en page "papier" (A4, pas de dark mode, pas de contrôles interactifs) sans
toucher à la fenêtre principale de l'utilisateur pendant qu'il travaille.

---

## Nouvelles dépendances

| Lib | Usage | Où | Alternative rejetée |
|---|---|---|---|
| `docx` (npm) | Génération de documents Word (`.docx`) : paragraphes, titres, tableaux | `apps/desktop/src/main/services/export/*.docx.ts` | Génération HTML→docx via une lib de conversion générique — rejetée, contrôle plus faible sur le rendu Word natif (styles de titres, sauts de page) |
| *(aucune nouvelle dépendance PDF)* | `webContents.printToPDF` (API native Electron) | `apps/desktop/src/main/services/pdf.util.ts` | `puppeteer`/`pdf-lib` — rejetées (décision utilisateur, poids de dépendance inutile alors qu'Electron fournit déjà la fonctionnalité) |

`ExcelJS` est déjà présent (utilisé par `query-engine.service.ts`) — réutilisé tel quel pour les nouveaux
exports xlsx, enrichi de styles d'en-tête basiques (le générateur actuel n'a aucun style, cf. `T43-tests.md`
cas limite "colonnes non stylées").

---

## Fichiers à créer / modifier

### Types partagés
- `packages/types/src/export.ts` **(NEW)** — `ExportFormat`, `ExportKind`, `ExportResult`, et les formes
  de payload par kind (`RequirementsExportPayload`, `TestsExportPayload`, `CampaignPlanExportPayload`,
  `CampaignReportExportPayload`) — les kinds `impact-analysis`/`query-result`/`dashboard` en pdf n'ont pas
  de payload xlsx/docx correspondant à tous les formats (cf. mapping formats de `T43.md` §2), donc ces
  types de payload restent optionnels/spécifiques par kind, pas un type unique partagé
- `packages/api-client/src/types.ts` **(MODIFIED)** — bloc `export: { save(...): Promise<ExportResult> }`
  dans `ApiClient` ; **suppression** de `queries.exportExcel` (absorbé par le nouveau mécanisme, cf.
  Sprint 3)
- `packages/api-client/src/ipc-client.ts` **(MODIFIED)** — implémentation `export.save` (`invoke('export:save', ...)`)

### Main process
- `apps/desktop/src/main/services/export.service.ts` **(NEW)** — point d'entrée unique `export(kind, format,
  payload, destPath, repoPath, printParams)`, dispatch par format
- `apps/desktop/src/main/services/export/requirements.xlsx.ts`, `.docx.ts` **(NEW)**
- `apps/desktop/src/main/services/export/tests.xlsx.ts`, `.docx.ts` **(NEW)**
- `apps/desktop/src/main/services/export/campaign.xlsx.ts`, `.docx.ts` **(NEW)** — gère plan ET rapport
  (deux fonctions distinctes dans le même fichier, données proches)
- `apps/desktop/src/main/services/export/impact-analysis.xlsx.ts` **(NEW)**
- `apps/desktop/src/main/services/pdf.util.ts` **(NEW)** — `renderRouteToPdf(printUrl: string, destPath:
  string): Promise<void>`, encapsule la `BrowserWindow` cachée
- `apps/desktop/src/main/services/query-engine.service.ts` **(MODIFIED)** — `exportExcel` déplacé/exposé
  pour être appelable depuis `export.service.ts` (kind `query-result`), signature inchangée
- `apps/desktop/src/main/services/git.service.ts` — **inchangé**, `headSha(repoPath)` déjà présent (lignes
  159-161), réutilisé pour construire `{baseline|commit}` dans les noms de fichiers par défaut
- `apps/desktop/src/main/ipc/index.ts` **(MODIFIED)** — nouveau handler `export:save` (lignes à ajouter
  près du bloc `queries:*`, suit le pattern `dialog.showSaveDialog` de `queries:export-excel` lignes
  563-572) ; **suppression** du handler `queries:export-excel` (Sprint 3)

### Renderer
- `apps/desktop/src/renderer/components/export/ExportButton.tsx` **(NEW)** — icône + popover de formats
  disponibles (props `kind`, `formats`, `getPayload()`, `getPrintParams()`, `suggestedName`, `repoPath`)
- `apps/desktop/src/renderer/components/export/exportFilenames.ts` **(NEW)** — implémente le pattern de
  nommage de `T43.md` §4 par kind
- `apps/desktop/src/renderer/routes/print/requirements.tsx` **(NEW)**
- `apps/desktop/src/renderer/routes/print/tests.tsx` **(NEW)**
- `apps/desktop/src/renderer/routes/print/campaign-plan.tsx`, `print/campaign-report.tsx` **(NEW)**
- `apps/desktop/src/renderer/routes/print/impact-analysis.tsx` **(NEW)**
- `apps/desktop/src/renderer/routes/print/dashboard.tsx` **(NEW)** — réutilise `DashboardGrid`
- `apps/desktop/src/renderer/routes/requirements.tsx` **(MODIFIED)** — ajoute prop `actions` (absente
  aujourd'hui) à `<ViewHeader>` (lignes 77-85) avec `<ExportButton kind="requirements" .../>`, extrait la
  logique de filtre (`filtered`, ligne 56) en fonction partagée `filterRequirements()` réutilisée par
  `print/requirements.tsx`
- `apps/desktop/src/renderer/routes/tests.tsx` **(MODIFIED)** — miroir exact de `requirements.tsx`
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` **(MODIFIED)** — ajoute deux
  `<ExportButton>` dans le fragment `actions` existant (ligne 185), le second (`campaign-report`)
  conditionné à `campaign.runs.some(r => r.status !== 'pending')`
- `apps/desktop/src/renderer/routes/query.tsx` **(MODIFIED)** — ajoute prop `actions` à `<ViewHeader>`
  (ligne 235, absente aujourd'hui), retire le bouton d'export inline existant et son `useMutation` dédié
  (~lignes 217-219, 280), remplacés par `<ExportButton kind="query-result" formats={['xlsx','pdf']} .../>`
- `apps/desktop/src/renderer/routes/impact-analysis.tsx` **(MODIFIED)** — ajoute `<ExportButton
  kind="impact-analysis" formats={['xlsx','pdf']} .../>` dans le fragment `actions` conditionnel existant
  (ligne 447), uniquement si `activeAnalysis` est défini
- `apps/desktop/src/renderer/routes/dashboard.tsx` **(MODIFIED)** — ajoute `actions` (à vérifier/créer
  selon l'état réel du fichier au-delà de la ligne 163) avec `<ExportButton kind="dashboard"
  formats={['docx','pdf']} .../>`
- `apps/desktop/src/renderer/components/dashboard/DashboardGrid.tsx` **(MODIFIED)** — ajoute un mode
  `printMode?: boolean` (désactive drag&drop, édition inline, contrôles hover) réutilisé par
  `print/dashboard.tsx`

---

## Nouveaux types (`packages/types/src/export.ts`)

```ts
export type ExportFormat = 'xlsx' | 'docx' | 'pdf'

export type ExportKind =
  | 'requirements'
  | 'tests'
  | 'campaign-plan'
  | 'campaign-report'
  | 'impact-analysis'
  | 'query-result'
  | 'dashboard'

export type ExportResult =
  | { status: 'ok'; filePath: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

// xlsx/docx uniquement — le pdf ne transite pas par ce payload (cf. décision structurante)
export interface RequirementsExportPayload {
  componentLabel: string
  items: Requirement[]
}
export interface TestsExportPayload {
  componentLabel: string
  items: TestCase[]
}
export interface CampaignPlanExportPayload {
  campaign: TestCampaign
  tests: TestCase[] // résolus depuis testCaseIds
}
export interface CampaignReportExportPayload {
  campaign: TestCampaign
  tests: TestCase[]
}
```

`ExportResult` ajoute un cas `error` absent de l'actuel `ExportExcelResult` (`{status:'ok'|'canceled'}`)
— nécessaire car la génération docx/pdf est du code neuf, plus susceptible d'échouer (ex. police
manquante, timeout de rendu de la fenêtre cachée) que l'export xlsx minimal existant ; faire remonter un
message d'erreur explicite au renderer plutôt que de laisser une exception IPC non gérée.

---

## Canal IPC générique

```ts
// main/ipc/index.ts
ipcMain.handle('export:save', async (
  _e,
  repoPath: string,
  kind: ExportKind,
  format: ExportFormat,
  payload: unknown,          // ignoré si format === 'pdf'
  printParams: Record<string, string> | undefined, // utilisé seulement si format === 'pdf'
  suggestedName: string,
) => {
  const saveResult = await dialog.showSaveDialog({
    title: EXPORT_DIALOG_TITLES[kind],
    defaultPath: suggestedName,
    filters: [FORMAT_FILTERS[format]],
  })
  if (saveResult.canceled || !saveResult.filePath) return { status: 'canceled' as const }
  try {
    await c.export.run({ kind, format, payload, printParams, repoPath, destPath: saveResult.filePath })
    return { status: 'ok' as const, filePath: saveResult.filePath }
  } catch (err) {
    return { status: 'error' as const, message: (err as Error).message }
  }
})
```

`export.service.ts` dispatch interne (`switch (format)`), puis `switch (kind)` à l'intérieur de chaque
branche pour appeler le bon générateur (`requirements.xlsx.ts`, etc.). Ancien handler
`queries:export-excel` supprimé au Sprint 3 (remplacé par `kind:'query-result', format:'xlsx'`).

---

## Routes imprimables (`/print/*`)

- Non liées dans la navigation normale (pas d'entrée sidebar/menu), accessibles uniquement via
  `loadURL`/`loadFile` par la `BrowserWindow` cachée du main process, avec les paramètres d'identification
  en query string (ex. `/print/requirements?repoPath=...&filter=...&type=...`)
- Layout minimal dédié (pas d'`AppLayout`/sidebar/activity bar), CSS d'impression (A4, pas de dark mode
  forcé — thème clair fixe pour un rendu papier prévisible)
- Réutilisent les composants d'affichage existants en lecture seule (ex. rendu richtext TipTap en mode
  lecture, `DashboardGrid` en `printMode`) plutôt que de réinventer un rendu
- `pdf.util.ts` attend l'événement `did-finish-load` puis un court délai/signal explicite (`window.postMessage`
  ou variable globale `window.__EXPORT_READY__ = true` positionnée par la route une fois ses données
  chargées via React Query) avant d'appeler `printToPDF()` — nécessaire car le chargement des données
  (fetch IPC) est asynchrone après le premier rendu

---

## Nom de fichier par défaut — implémentation

`exportFilenames.ts` (renderer, appelé au moment d'ouvrir le popover, avant l'appel IPC) implémente le
tableau de `T43.md` §4. Le SHA du commit HEAD (`{commit}`) est récupéré via un nouvel appel
`api.git.headSha(repoPath)` côté renderer (méthode à exposer — `headSha` existe déjà dans
`git.service.ts` mais n'est pas encore dans l'`ApiClient` public, il faut l'y ajouter). Le cas baseline
(`impact-analysis.tsx`) n'a pas besoin de ce SHA, il utilise déjà `fromBaseline.tag`/`toBaseline.tag`.

---

## Découpage en sprints

Le périmètre (7 types × jusqu'à 3 formats, 2 mécanismes de génération, 1 nouvelle dépendance, plusieurs
nouvelles routes) ne tient pas en un sprint. **3 sprints**, chacun livrant une verticale complète et
testable plutôt que "toute l'infra puis rien qui marche" :

### Sprint 1 — Fondations + Cahier d'exigences (bout en bout, 3 formats)
- Canal IPC générique `export:save`, types `export.ts`, `<ExportButton>`, `pdf.util.ts`, infra route
  `/print/*` (layout minimal)
- `docx` npm ajouté
- Premier cas d'usage complet : **cahier d'exigences** (xlsx + docx + pdf) sur `requirements.tsx` — choisi
  en premier car il exerce les 3 formats et donc toute l'infrastructure d'un coup (valide xlsx
  programmatique, docx programmatique, ET le mécanisme route-imprimable-vers-PDF)
- `api.git.headSha` exposé dans l'`ApiClient`

### Sprint 2 — Cahier de test + Cahier/Rapport de campagne
- `tests.tsx` (miroir exact du sprint 1, xlsx/docx/pdf)
- `campaign.$campaignId.tsx` : cahier de campagne (xlsx/docx/pdf) + rapport de campagne (docx/pdf,
  condition sur runs existants)

### Sprint 3 — Query, Impact analysis, Dashboard + nettoyage
- Migration `query.tsx` vers le mécanisme unifié (xlsx + pdf), suppression de `queries:export-excel` et de
  `ExportExcelResult` (remplacés par `export:save`/`ExportResult`)
- `impact-analysis.tsx` (xlsx/pdf)
- `dashboard.tsx` (docx/pdf), `DashboardGrid` en `printMode`
- Mises à jour SPEC : `SPEC-TECH-stack.md` (dépendance `docx`), `SPEC-ELECTRON-DESKTOP.md` §19.13
  (`ViewHeader`/`ExportButton` comme usage standard du slot `actions`), `SPEC-INDEX.md` (colonne MAJ)

---

## Risques identifiés

- **`webContents.printToPDF` et rendu asynchrone des données** : le signal "prêt à imprimer" (§Routes
  imprimables ci-dessus) est un point délicat — à valider tôt en Sprint 1 avec un cas simple avant de le
  généraliser aux 6 routes suivantes
- **Style visuel du PDF vs Word** : le PDF reflète le rendu React (thème app, polices web) tandis que le
  Word est construit programmatiquement (styles Word natifs) — les deux ne seront jamais visuellement
  identiques ; à assumer explicitement, pas un bug
- **`campaign-report` sans run "réel" distinct** : le modèle actuel (`TestCampaign.runs:
  CampaignTestRun[]`) ne distingue pas des exécutions multiples nommées (cf. T66, fusion
  TestCampaign/CampaignRun encore en discussion) — le rapport de campagne exporte donc l'état courant des
  runs embarqués, pas un run historique choisi ; si T66 tranche vers des `CampaignRun` séparés,
  `campaign-report` devra être revu pour cibler un run précis (hors scope ici, dépendance notée)
