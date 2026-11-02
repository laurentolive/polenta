# GH245 — Design technique : impact et tests de la version

> Spec : `specs/GH245.md` (validée 2026-11-02). Référence : `change-analysis.util` et
> `change-tests.util` @ `4e06052`.

## 1. Découpage

| Sprint | Périmètre |
|---|---|
| 1 | Types, `version-analysis.util.ts` (pur : analyse, sources, tests à exécuter), `VersionsService` (`analysis`, `setImpact`, `testsToRun`, analyse figée au passage released), IPC / api-client / channel-policy, graphe (`impacted`, `analysis`, manifeste v12), MCP `get_version_impact` / `get_version_tests`, tests unitaires |
| 2 | Renderer : sections « Analyse d'impact » et « Tests à exécuter » de la page d'une version, raccourcis campagne, i18n ; SPEC |

## 2. Types (`packages/types/src/product-version.ts`)

```ts
export interface VersionImpacted { id: string; status: ImpactAnalysisStatus; comment?: string }
export interface VersionImpactStep { id: string; linkType: string; parentIsTarget?: boolean }
/** Chemin racine → élément (la racine n'est pas répétée dans `path`). */
export interface VersionImpactSource { rootId: string; path: VersionImpactStep[] }
export interface VersionImpactRow {
  id: string; elementType: 'requirement' | 'test_case' | null; title: string | null
  status: ImpactAnalysisStatus; comment?: string
  reached: boolean            // false : enregistré dans `impacted`, plus atteint
  sources: VersionImpactSource[]
}
export interface VersionImpactRoot {
  elementId: string; elementType: 'requirement' | 'test_case'; title: string
  component: string           // repo de la racine (nom de montage)
  descendantTree: ImpactNode[]; ascendantTree: ImpactNode[]
}
export interface VersionAnalysis { computedAt: string; frozen: boolean; roots: VersionImpactRoot[]; rows: VersionImpactRow[] }
export interface VersionTestToRun {
  testId: string; title: string
  requirementIds: string[]    // instances (vide : le test lui-même)
  sources: string[]           // éléments qui l'amènent
  alreadyIn: Array<{ id: string; title: string }>   // campagnes ouvertes du repo qui le contiennent
}
export interface VersionTestsToRun { tests: VersionTestToRun[]; uncovered: string[] }
```

`ProductVersion` gagne `impacted?: VersionImpacted[]` et `analysis?: VersionAnalysis` (écrit au passage
released seulement).

## 3. `version-analysis.util.ts` (pur)

- `computeVersionAnalysis({ roots: Array<{ id; component }>, snapshot, trees, repoPath, impacted, now })` :
  arbres par racine (`buildImpactTreesFromSnapshot`), parcours en profondeur avec le chemin courant →
  `sources` par élément atteint ; lignes = éléments atteints hors racines **dont le repo (snapshot) est
  `repoPath`** ; statut / commentaire repris de `impacted` (défaut `impact_non_verifie`), reportés sur
  les nœuds des arbres ; lignes de `impacted` non atteintes ajoutées `reached: false`. Ordre : ID.
- `computeVersionTests(rootIds, rows, snapshot, openCampaigns)` : sources = racines + lignes atteintes
  hors `pas_d_impact_reel` ; tests exclus s'ils sont eux-mêmes `pas_d_impact_reel` ; test → lui-même,
  exigence → tests qui la couvrent (`matchCoverageLink`) ; exigence sans test → `uncovered` ;
  `alreadyIn` = campagnes `planned` / `in_progress` du repo dont une entrée active vise le test.

## 4. `VersionsService`

- Dépendances ajoutées par `setImpactSources({ traceability, campaigns })` (comme `GraphService.setVersions`) :
  `TraceabilityService` (`loadWorkingTreeSnapshot`, `buildImpactTreesFromSnapshot`), `CampaignsService.list`.
- `analysis(repo, id, ws)` : version released avec `analysis` → la renvoie (`frozen: true`) ; sinon
  calcul live : racines = `page().rows` à catégorie connue (ID unique), snapshot du workspace.
- `setImpact(repo, id, elementId, status, comment?)` : version en cours seulement (`NOT_IN_PROGRESS`),
  repo modifiable ; met à jour `impacted` (statut par défaut + pas de commentaire → entrée retirée).
- `testsToRun(repo, id, ws)` : analyse (figée ou live) + snapshot courant + campagnes du repo ; refusé
  pour une version abandonnée (`NOT_IN_PROGRESS`… → code `VERSION_ABANDONED`).
- `release` : calcule l'analyse live juste avant le gel et l'écrit (`analysis`, `frozen: true`) dans le
  même commit.

## 5. IPC, graphe, MCP

- Channels `versions:analysis`, `versions:set-impact` (écriture, invalidation du graphe),
  `versions:tests` — masqués au client web (`WEB_HIDDEN`).
- Graphe : `GraphVersion.impacted` (`[{ id, status, comment }]`) et `GraphVersion.analysis`
  (`{ computedAt, rows: [{ id, status, comment, reached, sources }] } | null`, sans les arbres) ;
  `polenta.d.ts` régénéré, manifeste v12.
- MCP (`tools/versions.tools.ts`) : `get_version_impact { id, component? }`, `get_version_tests { id, component? }`.

## 6. Renderer (sprint 2)

- `components/versions/VersionAnalysisSection.tsx` : tableau des lignes (ID lien, type, label, statut
  — sélecteur des 8 statuts + commentaire si version en cours, source « racine → … » avec « +n »), puis
  les racines repliables avec `ImpactTreeView` (statut éditable sur les nœuds, `onUpdateStatus` →
  `setImpact`). Lecture seule si released.
- `components/versions/VersionTestsSection.tsx` : liste cochable (test, amené par, « Déjà dans »),
  non couvertes, « Créer une campagne » (`/campaign/new?testCaseIds&instances&title`) et « Ajouter à … »
  (`/campaign/$id?addTests&instances`), encodage des instances repris de GH207.
- Page `version.$versionId.tsx` : deux sections repliables sous « Changements », état mémorisé par
  poste (`localStorage`, clé `polenta:versionSections`).

## 7. Alternatives rejetées

- Lien campagne ↔ version (Q1 de la spec).
- Arbres dans le graphe : volumineux, reconstructibles ; le graphe garde les lignes.
- Snapshot au `freeze.sha` de chaque repo pour une version released : l'analyse est figée au passage.
