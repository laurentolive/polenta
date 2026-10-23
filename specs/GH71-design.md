# GH71 — Design : avancement de la définition des tests au résultat

Spec : `specs/GH71.md`. Issue : #71.

## 1. Vue d'ensemble

Une seule règle, partagée main / renderer dans `@polenta/types`, calcule l'**étape** d'une entrée
de campagne (`prep:<statut>` / `ready` / résultat) et l'**ordre canonique** des étapes. Le main
l'utilise pour les colonnes `campaign_entries` et pour `resolveRowTarget` ; le renderer pour les
pastilles de la page campagne et pour le préréglage du widget barre.

```
@polenta/types/campaign-progress.ts ── entryProgress, progressSubject, progressRank, progressOrder…
   │
   ├─ main  : QueryEngineService (colonnes progress/progressRank/testStatus, resolveRowTarget)
   │          DashboardSeedService (nouvelle requête/widget, mise à niveau des seeds GH65)
   └─ renderer : BarWidget (preset 'campaignProgress'), WidgetConfigModal,
                 page campagne (pastilles + `progress` dans l'URL), campaignApproval (GH68)
```

## 2. Types — `packages/types`

### 2.1 `src/campaign-progress.ts` (nouveau, exporté par `index.ts`)

```ts
export const PREP_PREFIX = 'prep:'
export const PROGRESS_READY = 'ready'
/** Résultats dans l'ordre canonique (après `ready`). */
export const PROGRESS_RESULTS = ['INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS'] as const

export const prepKey = (status: string) => PREP_PREFIX + status
export const prepStatusOf = (key: string): string | null => key.startsWith(PREP_PREFIX) ? key.slice(PREP_PREFIX.length) : null
export function isProgressKey(v: unknown): v is string   // prep:<non vide> | ready | résultat

/** Test dont on juge la préparation (règle GH68 + campagne ouverte, spec §2). */
export function progressSubject(
  run: CampaignTestRun, live: TestCase | undefined, campaignOpen: boolean, isApproved: (t: TestCase) => boolean,
): TestCase | undefined
// resynchronisable = campaignOpen && pending && testSnapshot && !isApproved(testSnapshot)
// → live ?? snapshot ; sinon snapshot ?? live

/** Étape d'une entrée (spec §1). Test inconnu → 'ready'. */
export function entryProgress(run: CampaignTestRun, subject: TestCase | undefined, isApproved: (t: TestCase) => boolean): string

/** Rang canonique. `statusIndex` : position du statut dans son type (prep uniquement). */
export function progressRank(key: string, statusIndex?: number): number
// prep connu → statusIndex (0..), prep inconnu → 999, ready → 1000, INCOMPLETE 1001, BLOCKED 1002,
// FAIL 1003, PASS 1004, autre → 2000

/** Ordre des statuts de préparation pour un schéma (types de catégorie test, tous nœuds) :
 *  nom → plus petit index dans un type ; même règle de départage que la spec §4 (nom). */
export function prepStatusOrder(schema: ProjectSchema | undefined): Map<string, number>
/** Comparateur de clés d'étape (ordre canonique), à égalité par nom. */
export function compareProgressKeys(order: Map<string, number>): (a: string, b: string) => number
```

`isApprovalStatus` (GH68, `schema.ts`) reste la seule définition de « approuvé ».

### 2.2 `src/dashboard.ts`

- `CAMPAIGN_ENTRY_FIELDS` : + `progress`, `progressRank`, `testStatus`.
- `WidgetFieldMapping` : + `preset?: 'campaignProgress'` (barre avec `series` uniquement).
- `RowTarget` `campaign` : + `progress?: string`.

## 3. Main

### 3.1 `QueryEngineService` — colonnes

`doBuildDataset` construit en plus, à partir de `perRepo` :
- `tcRepo: Map<testId, schema>` — schéma du repo où vit chaque test (statut et rang jugés dans
  **son** type) ;
- un prédicat d'approbation par schéma (`isApprovalStatus(findObjectTypeDef(schema, ref))`).

`flattenCampaignEntry(c, run, component, testTitle, progress)` reçoit
`{ progress, progressRank, testStatus }` calculés par :

```ts
const live = tcMap.get(run.testCaseId)
const schema = tcRepo.get(run.testCaseId) ?? campaignRepoSchema     // test supprimé : schéma de la campagne
const isApproved = approvalFor(schema)
const subject = progressSubject(run, live, c.status === 'planned' || c.status === 'in_progress', isApproved)
const progress = entryProgress(run, subject, isApproved)
const status = prepStatusOf(progress)
const statusIndex = status != null ? typeStatuses(schema, subject!.objectTypeRef).indexOf(status) : undefined
progressRank(progress, statusIndex === -1 ? undefined : statusIndex)
testStatus = subject?.status ?? null
```

Allowlists : `CAMPAIGN_ENTRY_FIELDS` est partagé (main/renderer) ; `QueryBuilder` masque en plus
`progressRank` (`CAMPAIGN_BUILDER_HIDDEN`), comme `executed`.

### 3.2 `QueryEngineService.resolveRowTarget`

Entrée `pending` → `{ kind: 'campaign', id, repoPath, progress }`, étape calculée comme en 3.1
(test cherché via `testsIndex.findById` dans les repos du périmètre, schéma du repo trouvé).
Repli (calcul impossible) : `status: 'pending'` comme aujourd'hui. Ligne de campagne (sans entrée)
avec une colonne `progress` valide → `progress` (en plus de `status`, inchangé).

### 3.3 `DashboardSeedService`

**Nouvelles définitions** (`CAMPAIGN_SEED_QUERIES.progress`, `CAMPAIGN_SEED_WIDGETS[0]`) : spec §12.
Les définitions GH65 sont conservées en constantes `GH65_PROGRESS_SQL` / `GH65_PROGRESS_MAPPING`
pour la mise à niveau. Libellé de requête : « Campagnes — avancement » / « Campaigns — progress ».

**Mise à niveau** (`upgradeCampaignsSeed(repoPath, username)`, appelée par `ensureSeeded` après
`ensureCampaignsSeeded`, même `.catch` journalisé) :

```
marker  = pref['campaignsSeedUpgrades'] ?? []        // nouvelle clé du .pref, liste de versions
si 'progressV2' ∈ marker → rien
pour chaque requête PRIVÉE de l'utilisateur dont sqlText === GH65_PROGRESS_SQL :
    sqlText ← nouvelle requête (savedQueries.update)
    pour chaque widget d'un dashboard PRIVÉ de l'utilisateur avec queryId = cette requête
      et fieldMapping deep-equal GH65_PROGRESS_MAPPING (ordre des clés indifférent) :
        fieldMapping ← nouveau (dashboards.updateWidget)
marker += 'progressV2'
```

- **Pourquoi chercher par contenu et pas par id** : le marqueur `campaignsSeed` en état `done`
  n'a plus les ids (`{ state: 'done', seededAt }`). Le contenu exact suffit : une requête dont le
  SQL est encore mot pour mot celui du seed n'a pas été modifiée. Une copie faite par l'utilisateur
  à l'identique serait aussi mise à niveau, ce qui est le résultat voulu.
- **Requête partagée** (passée en `shared` par l'utilisateur) : non touchée (écriture dans le repo).
- **Widget personnalisé sur une requête intacte** : la nouvelle requête ne sélectionne plus
  `status`, donc un widget qui l'utilise encore serait vide. La requête n'est mise à niveau **que si
  tous les widgets qui l'utilisent ont le mapping GH65** (ou s'il n'y en a aucun) ; sinon ni la
  requête ni ses widgets ne sont touchés. Précision de la spec §13, qui traitait requête et widget
  séparément.
- Marqueur posé même s'il n'y avait rien à faire, et pour un seed neuf (déjà aux nouvelles
  définitions) : `ensureCampaignsSeeded` le pose en fin de seed.
- `ensureCampaignsSeeded` conserve désormais `queries` et `dashboardId` dans le marqueur `done`
  (utile aux prochaines mises à niveau ; pas exploité par celle-ci).

API utilisées : `SavedQueriesService.findAll/update`, `DashboardsService.list/updateWidget` — à
vérifier au sprint 1 (sinon ajout de méthodes minimales, sans changer les canaux IPC).

## 4. Renderer

### 4.1 Préréglage du widget barre

- `components/dashboard/widgets/progressPresentation.ts` (nouveau, pur) :
  `presentProgressSeries(keys, schema, t) → { key, label, color }[]` ordonnés —
  `compareProgressKeys(prepStatusOrder(schema))`, libellé (statut du schéma : premier type de test qui
  le déclare ; `ready` → `campaignProgress.ready` ; résultats → `campaignPage.runStatus.*`), couleur.
- Couleurs : nouveaux jetons `index.css` (clair + sombre) `--chart-progress-prep-1..4`,
  `--chart-progress-ready`, `-incomplete`, `-blocked`, `-fail`, `-pass`. Préparation : gris du plus
  foncé (1er statut) au plus clair ; au-delà de 4 statuts, le 4e est réutilisé. Valeur hors étape :
  `seriesColor(i)` sur son rang parmi les valeurs hors étape, placée après.
- `BarWidget` : si `fieldMapping.preset === 'campaignProgress'` et `series`, remplace l'ordre
  d'apparition par l'ordre présenté ; `<Bar name={label} fill={color}>` ; `dataKey` et valeur de
  drill-down restent la clé brute. Le schéma vient de `useProjectSchema(repoPath)` : nouveau prop
  `repoPath` sur `WidgetRenderer` → `BarWidget` (les deux appelants l'ont).
- Limite : un statut d'un type de test qui n'est déclaré que dans un **autre repo** (composant) n'a
  pas de libellé dans le schéma local → libellé = nom, rang « inconnu » (après les connus).
- `WidgetConfigModal` : sous « Empiler », select « Présentation des séries » (Standard /
  Avancement de campagne), visible pour un widget barre avec série ; `preset` absent = Standard.

### 4.2 Page campagne

- `lib/campaignApproval.ts` (GH68) : `isResyncable/approvalSubject/unapprovedTestOf` délèguent à
  `progressSubject` avec `campaignOpen` (spec §2, correction GH68) ; signature + paramètre
  `campaignOpen`, appelants mis à jour.
- Nouveau `lib/campaignProgress.ts` (pur) : `runProgress(run, live, campaignOpen, isApproved)` et
  `progressPills(runs, …) → { key, count }[]` (préparation présentes, puis `ready` et résultats,
  toujours affichés) dans l'ordre canonique.
- Route `/campaign/$campaignId` : `validateSearch` + `progress` (`isProgressKey`, sinon ignoré).
  Filtre : `progress` → entrées dont l'étape = clé ; sinon `status` comme GH65. Pastilles : clic =
  bascule `progress` (et retrait de `status`). Libellés : `presentProgressSeries` (mêmes libellés que
  le graphe). Classes : préparation `bg-status-neutral-bg` (texte plus clair pour les statuts
  suivants), `ready` `bg-status-info-bg`, résultats inchangés.
- `RUN_STATUSES` / `parseRunStatus` conservés pour `status` (compatibilité des liens GH65).
- `lib/rowNavigation.ts` : `campaign` + `progress` → `search.progress`.

### 4.3 i18n

`campaignProgress.ready` (« Prêt à exécuter » / « Ready to run »),
`dashboard.widgetModal.presetLabel` / `presetStandard` / `presetCampaignProgress`,
`campaignPage.statusFilter.*` réutilisés avec le libellé d'étape.

## 5. Décisions et alternatives rejetées

| # | Décision | Rejetée |
|---|----------|---------|
| D1 | Règle d'étape dans `@polenta/types`, partagée | Calcul côté main seulement et colonne lue par la page : la page campagne n'interroge pas le moteur de requêtes |
| D2 | Mise à niveau du seed par contenu exact (SQL + mapping) | Par ids du marqueur : absents en état `done` |
| D3 | Requête mise à niveau seulement si tous ses widgets ont le mapping GH65 | Mise à niveau de la requête seule : casserait un widget personnalisé qui utilise `status` |
| D4 | Préréglage nommé dans `fieldMapping` | Libellés/couleurs par valeur stockés dans le widget : les statuts dépendent du schéma et changent |
| D5 | `progressRank` calculé dans le type du test ; ordre du renderer calculé sur le schéma local | Rang global multi-repo : le renderer ne connaît que le schéma local |

## 6. Documentation (sprint final)

- `SPEC-DASHBOARDS.md` §2.1 (colonnes), §2.2 (`resolveRowTarget` + `progress`), §4.1 (préréglage),
  §5.1b (widget, mise à niveau).
- `SPEC-TESTS.md` §4.2 (GH68 : condition « campagne ouverte »), §4.3 (pastilles, `progress`).
- `SPEC-INDEX.md` : lignes correspondantes, MAJ → GH71.

## 7. Découpage — 2 sprints

**Sprint 1 — types + main** (testable sans UI)
- `campaign-progress.ts` + tests unitaires (`apps/desktop/src/main/services/campaign-progress.test.ts`)
- `CAMPAIGN_ENTRY_FIELDS`, `WidgetFieldMapping.preset`, `RowTarget.progress`
- `QueryEngineService` (colonnes, `resolveRowTarget`) + tests (`query-engine.campaigns.test.ts`)
- `DashboardSeedService` (nouvelles définitions, mise à niveau, marqueur `done` enrichi) + tests
  (`dashboard-seed.campaigns.test.ts`)
- `QueryBuilder` : `progressRank` masqué (une ligne, pour garder l'allowlist cohérente)

**Sprint 2 — renderer**
- Préréglage (`progressPresentation`, `BarWidget`, `WidgetRenderer`, `WidgetConfigModal`, jetons CSS)
- Page campagne (pastilles, `progress`, `campaignProgress.ts`), correction GH68 (`campaignApproval`)
- `rowNavigation`, i18n
- e2e : `gh71-progress.spec.ts` ; mise à jour de `gh65-navigation.spec.ts` (2.4/2.7 : `progress`
  au lieu de `status=pending` ; 2.9 : pastilles) et `gh68-unapproved.spec.ts` si besoin
- Documentation (§6)
