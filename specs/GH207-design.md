# GH207 — Design : campagnes issues d'un changeset

Spec : `specs/GH207.md`. Base : `milestone-D` @ b4ac443. **Un sprint.**

## 1. Main

### 1.1 Tests à exécuter — `change-tests.util.ts` (nouveau)

```ts
export function computeTestsToRun(input: {
  change: Change
  rows: ChangeImpactRow[]            // analyse courante ou figée (#199)
  snapshot: ImpactSnapshot           // même snapshot que l'analyse (exigences, tests, liens)
}): ChangeTestsToRun
```

- Sources : `toModify` (Q1) + lignes `impacted` au statut `impact_a_tester` / `modification_a_tester`.
- Test → lui-même ; exigence → tests couvrants par `matchCoverageLink` (sens indifférent) ; pour
  chaque test, l'ensemble des exigences sources qui l'ont amené (instances T179).
- Sortie : `{ tests: [{ testId, requirementIds: string[], sources: string[] }], uncovered: string[] }`.
  `requirementIds` vide = le test vient lui-même (toutes ses instances).

`ChangesService.testsToRun(repoPath, id)` : analyse (`analysis()`, figée ou calculée) + snapshot
(même lecture que `computeAnalysis`), puis `computeTestsToRun` ; enrichi de
`linked: LinkedCampaign[]` et `toAdd: string[]` (tests absents de toute campagne liée **ouverte**,
`planned | in_progress`, entrée active). Type `ChangeTestsToRun` dans `packages/types/src/change.ts`.

### 1.2 Campagnes liées

`LinkedCampaign = { id, title, status, passed, total, changesetTests, missing }` — lu par
`campaigns.list(repoPath)` (déjà injecté dans `ChangesService`) ; `missing: true` si l'ID n'existe plus.

### 1.3 Lien campagne ↔ changeset

- `TestCampaign.changeset?: string`, `CreateCampaignDto.changeset?: string`.
- `CampaignsService.create` : si `dto.changeset`, contrôle avant l'ID (changeset ouvert du repo,
  via un crochet `setChangesetLinker({ assertOpen, link })` posé dans les conteneurs) ; écrit
  `changeset` ; après écriture, `link(repo, changesetId, campaignId)` ajoute l'ID à `campaigns`
  (`ChangesService.linkCampaign`, sans doublon). Même schéma que le tracker de #200.
- IPC `changesets:tests-to-run` ; api-client ; politique web.

### 1.4 Graphe, MCP

- `GraphCampaign.changeset: string | null` ; `polenta.d.ts` régénéré, manifeste.
- MCP `get_changeset` : `testsToRun` ; `bulk_import_campaigns` : `changeset` par entrée (schéma
  d'entrée local étendu).

## 2. Renderer

- `components/changes/ChangeCampaignsSection.tsx` (nouveau) dans la page d'un changeset, à la place
  de la ligne « Campagnes : — » :
  - tableau des campagnes liées (ID lien, titre, statut, PASS / total, tests du changeset) ;
  - « Tests à exécuter : N » (+ « non couvertes : … ») ;
  - bandeau « N tests à ajouter » + « Ajouter à CAMP-… » (menu si plusieurs liées ouvertes) ;
  - « Créer la campagne ».
- `/campaign/new` : nouveaux paramètres `changeset` (écrit dans le DTO, affiché « Changeset : ID »)
  et `instances` (`TEST-1:SW-1|SW-2,TEST-2`) → état initial `reqSel` (seules les instances listées
  cochées). Le titre et `testCaseIds` existent déjà.
- `/campaign/$id` : paramètres `addTests` + `instances` → ouvre le sélecteur « Ajouter » avec
  `initial = { testIds, reqSel }` (pré-coché, validation de l'utilisateur).
- En-tête d'une campagne : « Changeset : NC-0004 » (lien) si `changeset`.

## 3. Alternatives rejetées

- Calcul des tests côté renderer : le MCP doit renvoyer la même liste (`testsToRun`).
- Ajout direct sans sélecteur : la spec exige une validation (paramètres, instances).
