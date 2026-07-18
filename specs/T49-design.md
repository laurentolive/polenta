# T49 — Design technique

Voir [T49.md](T49.md) pour la spec fonctionnelle validée.

## 1. Découpage

Un seul sprint. Le changement est cohérent et indivisible : le nouveau champ
`testSnapshot` n'a de sens que si son écriture (services main) et sa lecture
(tous les points d'affichage/exécution/export renderer) arrivent ensemble —
livrer l'un sans l'autre laisserait soit un champ jamais lu, soit des pages
qui tentent de lire un champ qui n'existe pas encore. Pas de découpage en
plusieurs sprints.

## 2. Fichiers à modifier

### 2.1 `packages/types/src/campaign.ts`

Ajout du champ, optionnel (pas de migration — voir T49.md § Hors scope, les
entrées créées avant ce ticket n'en ont pas) :

```ts
import type { TestCase } from './test'

export interface CampaignTestRun {
  entryId: string
  testCaseId: string
  /** Copie complète du TestCase au moment de l'inclusion dans la campagne
   *  (T49) — fige contenu/statut, indépendamment des modifications
   *  ultérieures de la source. Absent sur les entrées créées avant T49
   *  (pas de backfill rétroactif, décision de cadrage). */
  testSnapshot?: TestCase
  status: TestRunStatus
  runId?: string
  executedAt?: string
  executedBy?: string
  paramValues?: Record<string, string>
}
```

### 2.2 `packages/types/src/export.ts`

`CampaignExportPayload.tests: TestCase[]` est remplacé par un tableau qui
porte l'association run↔test (nécessaire dès qu'un même `testCaseId` peut
apparaître plusieurs fois — voir bug latent identifié en §3) :

```ts
export interface CampaignExportPayload {
  campaign: TestCampaign
  entries: { run: CampaignTestRun; test: TestCase }[]
}
```

`entries` est construit côté renderer (même principe que l'existant :
"données déjà chargées/filtrées côté vue, envoyées telles quelles au main
process") via `resolveCampaignRuns()` (§2.3), filtré aux runs dont un test
est effectivement résolvable (snapshot ou fallback live) — une entrée sans
test résolu (source supprimée **et** entrée pré-T49 sans snapshot) est
omise, comme aujourd'hui.

### 2.3 `apps/desktop/src/renderer/lib/campaignTests.ts`

Remplace `resolveCampaignTests(campaign, tests): TestCase[]` (résolution par
`testCaseId` unique, incompatible avec les instances multiples T97 sprint 2)
par une résolution indexée par `run` :

```ts
export interface ResolvedCampaignRun {
  run: CampaignTestRun
  test: TestCase
}

/** Résout chaque `CampaignTestRun` de la campagne vers son `TestCase` —
 *  `testSnapshot` en priorité (T49, fige le contenu à l'inclusion), sinon
 *  repli sur l'état live (entrées créées avant T49, pas de migration).
 *  Une entrée dont ni l'un ni l'autre n'est disponible (test source
 *  supprimé et entrée pré-T49 sans snapshot) est omise. */
export function resolveCampaignRuns(campaign: TestCampaign, tests: TestCase[]): ResolvedCampaignRun[] {
  const map = new Map(tests.map(t => [t.id, t]))
  return campaign.runs
    .map(run => ({ run, test: run.testSnapshot ?? map.get(run.testCaseId) }))
    .filter((r): r is ResolvedCampaignRun => !!r.test)
}
```

Les 4 sites qui importent aujourd'hui `resolveCampaignTests` (vérifié par
recherche, aucun autre consommateur) basculent sur `resolveCampaignRuns` :

### 2.4 `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx`

- Liste des tests de la campagne (ligne ~473-475) : remplacer
  `const tc = testMap.get(tcId)` par la résolution snapshot-first
  (`run.testSnapshot ?? testMap.get(tcId)`), utilisée pour le titre affiché,
  `hasParams`/`extractTestParameters`, et les deux panneaux `TestParamFields`
  (édition de paramètres, duplication) — tous doivent voir le **même** objet
  figé, sinon les paramètres détectés à l'édition pourraient diverger de ceux
  affichés.
- Construction du payload d'export xlsx/docx (lignes 267, 282) :
  `getPayload={() => ({ campaign, entries: resolveCampaignRuns(campaign, tests) })}`
  au lieu de `{ campaign, tests: resolveCampaignTests(campaign, tests) }`.
- Le panneau "Ajouter des tests" (`availableTests`, ligne 184-186, filtré par
  `isTestApproved`) reste **inchangé** — il doit continuer à interroger l'état
  *live* des tests (c'est le mécanisme qui détermine quoi proposer à l'ajout,
  pas ce qui est déjà figé dans la campagne).

### 2.5 `apps/desktop/src/renderer/routes/campaign.$campaignId.execute.$testId.tsx`

- Remplacer la query live `api.tests.get(repoPath, testCaseId!)` (ligne 78-82)
  par la lecture directe de `entry.testSnapshot`, avec repli sur un fetch live
  uniquement si `testSnapshot` est absent (entrée pré-T49) :
  ```ts
  const { data: liveTest } = useQuery({
    queryKey: ['test', repoPath, testCaseId],
    queryFn: () => api.tests.get(repoPath, testCaseId!),
    enabled: !!repoPath && !!testCaseId && !entry?.testSnapshot,
  })
  const testCase = entry?.testSnapshot ?? liveTest
  ```
- Le reste de la page (rendu des étapes, préconditions/postconditions,
  substitution `{label}` via `paramValues`) ne change pas — elle consomme déjà
  `testCase` sans distinguer sa provenance.
- La mutation d'exécution (`api.tests.execute(repoPath, testCaseId!, …)`)
  n'est **pas** modifiée : `TestsService.execute()` ne valide pas les `order`
  de `stepResults` contre les étapes live du test (vérifié dans
  `tests.service.ts`), donc utiliser les étapes du snapshot pour construire le
  formulaire ne casse pas l'écriture du `TestRun`.

### 2.6 `apps/desktop/src/renderer/routes/campaign.$campaignId.run.$testId.tsx`

Même changement qu'en 2.5 (page de relecture) : `entry.testSnapshot` en
priorité, repli sur `api.tests.get()` seulement si absent.

### 2.7 `apps/desktop/src/renderer/routes/print.campaign-plan.tsx` et `print.campaign-report.tsx`

- `const resolved = resolveCampaignTests(campaign, tests)` →
  `const resolved = resolveCampaignRuns(campaign, tests)`.
- `resolved.map(t => …)` → `resolved.map(({ run, test }) => …)`, `key={t.id}`
  → `key={run.entryId}` (corrige au passage la clé React dupliquée pour un
  test inclus plusieurs fois — voir §3).
- `print.campaign-report.tsx` : `campaign.runs.find(r => r.testCaseId === t.id)`
  (ligne 43) disparaît — `run` est déjà la bonne instance, plus besoin de la
  retrouver par recherche.

### 2.8 `apps/desktop/src/main/services/export/campaign.docx.ts` et `campaign.xlsx.ts`

- `const { campaign, tests } = payload` → `const { campaign, entries } = payload`.
- `for (const t of tests)` → `for (const { run, test: t } of entries)`.
- `campaign.docx.ts` (rapport, ligne 60) : `campaign.runs.find(r => r.testCaseId === t.id)`
  supprimé, `run` est directement disponible dans la boucle.

### 2.9 `apps/desktop/src/main/services/campaigns.service.ts`

- Constructeur : ajoute une dépendance à `TestsService`
  (`constructor(private readonly gitService: GitService, private readonly testsService: TestsService)`).
- Nouvelle aide privée :
  ```ts
  private async snapshotsFor(repoPath: string, testCaseIds: string[]): Promise<Map<string, TestCase>> {
    const uniqueIds = [...new Set(testCaseIds)]
    const found = await Promise.all(uniqueIds.map(id => this.testsService.findOne(repoPath, id)))
    return new Map(uniqueIds.map((id, i) => [id, found[i]]))
  }
  ```
- `buildNewRuns()` reçoit ce `Map<string, TestCase>` en paramètre
  supplémentaire et pose `testSnapshot: snapshots.get(tcId)` sur chaque
  nouvelle entrée (le test est garanti trouvé — `findOne` lève sinon, ce qui
  fait légitimement échouer l'ajout plutôt que de créer une entrée sans
  snapshot).
- `create()`, `addTests()`, `duplicateTest()` appellent `snapshotsFor()` avant
  `buildNewRuns()` et lui passent le résultat. **Aucune vérification de statut
  n'est ajoutée côté serveur** — le gating "test approuvé" reste une
  contrainte purement côté renderer (`isTestApproved` dans le panneau
  d'ajout), inchangé, cohérent avec le fait que `campaign.new.tsx` (création)
  n'applique déjà aujourd'hui aucun filtre d'approbation (incohérence
  préexistante avec le panneau d'ajout d'une campagne existante — non
  introduite ni corrigée par ce ticket).
- Pas d'`omitAuditFields()` sur le `TestCase` copié dans `testSnapshot` —
  volontairement différent de `tests.service.ts` où ces 4 champs sont dérivés
  du log git du fichier `tests/TEST-xxx.yaml` et donc exclus de l'écriture.
  Ici, `testSnapshot` vit dans `campaigns/{id}.yaml`, qui n'a pas de
  mécanisme de dérivation équivalent : les valeurs `createdAt`/`createdBy`/
  `updatedAt`/`updatedBy` telles que retournées par `findOne()` au moment de
  l'ajout doivent être écrites telles quelles pour rester figées — c'est
  exactement l'esprit de "copier tout l'objet".

### 2.10 `apps/desktop/src/main/container.ts`

`const campaigns = new CampaignsService(git, tests)` — `tests` est déjà
construit avant cette ligne (ligne 42 vs. 45), pas de réordonnancement
nécessaire, pas de cycle d'import (`TestsService` n'importe pas
`CampaignsService`).

## 3. Constat additionnel (effet de bord du refactor, pas un fix indépendant)

En traçant les 3 consommateurs de `resolveCampaignTests`, un bug latent
préexistant a été identifié : pour un test inclus plusieurs fois dans une
campagne (T97 sprint 2, instances paramétrées), `campaign.runs.find(r =>
r.testCaseId === t.id)` (utilisé dans `campaign.docx.ts` et
`print.campaign-report.tsx`) retourne toujours la **première** instance
trouvée, quelle que soit celle qu'on essaie d'afficher — le rapport exporté
attribue le même statut d'exécution à toutes les instances d'un même test.
`print.campaign-report.tsx`/`print.campaign-plan.tsx` utilisent en plus
`key={t.id}` (React), dupliqué dans ce cas.

Le passage à une résolution indexée par `run` (§2.3, §2.7, §2.8) corrige ce
problème *mécaniquement*, parce que la correspondance run↔test devient 1:1
par construction — mais ce n'est pas un fix recherché pour lui-même : c'est
une conséquence nécessaire du modèle par `entryId` requis pour T49
(le snapshot est par instance, pas par `testCaseId`). À mentionner dans
`T49-sprint1.md` comme changement de comportement constaté, pas comme
correctif volontaire séparé.

## 4. Alternatives rejetées

- **Backfill à la lecture des anciennes campagnes** (même mécanisme que
  `ensureEntryIds()` pour `entryId`) : rejeté — décision de cadrage explicite
  "pas de migration". Les entrées pré-T49 gardent le comportement actuel
  (résolution live), sans snapshot ni immuabilité rétroactive.
- **Ajouter le gating d'approbation côté serveur** dans `addTests`/
  `duplicateTest`/`create` (puisque `campaigns.service.ts` a maintenant de
  toute façon accès au `TestCase` complet via `TestsService`) : rejeté pour ce
  ticket — hors périmètre de T49 (copie, pas contrôle d'accès), et
  `campaign.new.tsx` n'a de toute façon aucun gating aujourd'hui ; l'ajouter
  uniquement pour `addTests`/`duplicateTest` créerait une incohérence
  nouvelle entre les deux points d'entrée. Amélioration possible dans un
  ticket séparé.
- **Champ `testSnapshot` non optionnel avec valeur par défaut `null`** :
  rejeté — `null` obligerait à réécrire *toutes* les anciennes campagnes au
  premier chargement pour respecter le type, ce qui revient à une migration
  déguisée. Le champ optionnel (`?`) reflète honnêtement "absent sur les
  entrées anciennes".
- **Garder `CampaignExportPayload.tests: TestCase[]` et faire porter la
  correspondance run↔test par la position dans le tableau** (parallèle à
  `campaign.runs`) plutôt que `entries: { run, test }[]` : rejeté — plus
  fragile (un `filter()` mal placé désynchronise silencieusement les deux
  tableaux), alors que `{ run, test }[]` reste correct quel que soit le
  filtrage appliqué en amont.

## 5. Risques identifiés pour le sprint Dev

- Le changement de `CampaignExportPayload` (types partagés `@polenta/types`)
  doit être fait **dans le même commit** que ses 3 producteurs renderer et 2
  consommateurs main — sinon la compilation casse entre les deux.
- Vérifier qu'aucun autre appelant de `TestsService.findOne()` ne suppose
  qu'il ne peut être appelé qu'avec un id déjà connu du composant courant —
  `campaigns.service.ts` l'appelle maintenant avec des ids potentiellement
  d'un autre composant (`objectTypeRef` cross-composant), à vérifier que
  `findOne`/`resolveComponentRepoPath` gère bien ce cas (déjà le cas
  aujourd'hui pour l'exécution, `tests.service.ts:execute()`, donc a priori
  oui, mais à confirmer en testant avec un projet multi-composants).
- `TestParamFields`/`extractTestParameters` doivent recevoir le test résolu
  (snapshot-first) à **tous** les sites d'utilisation dans
  `campaign.$campaignId.tsx` (affichage, édition de paramètres, duplication)
  — un oubli sur un seul site réintroduirait une divergence.
- Le composant `TestRun` (`executions/…yaml`, `tests.service.ts`) reste
  inchangé et continue de référencer `testCaseId` — **pas** de snapshot dans
  `TestRun` lui-même, seulement dans `CampaignTestRun.testSnapshot`. Bien
  distinguer les deux dans le sprint dev pour ne pas dupliquer la copie à
  deux endroits.
