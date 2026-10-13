# GH73 — Design technique

Spec : `specs/GH73.md`. **Un seul sprint** (modèle + 3 services + 1 écran inchangé + e2e).

## 1. Types (`packages/types`, `packages/zod-schemas`)

### `packages/types/src/campaign.ts`

```ts
/** GH73 — référence à une entrée de campagne (campagne + instance). */
export interface CampaignEntryRef {
  campaignId: string
  entryId: string
}

/** GH64 — entrée d'une autre campagne dont une instance a été reportée. */
export type CarriedFrom = CampaignEntryRef          // était une interface de même forme

export interface CampaignTestRun {
  …
  status: TestRunStatus
  /** GH73 — instant d'ajout de l'entrée dans la campagne. Absent : entrée antérieure à GH73. */
  addedAt?: string
  …
  /** GH73 — instant du retrait ; présent uniquement sur les entrées de `TestCampaign.removedRuns`. */
  removedAt?: string
}

export interface TestCampaign {
  …
  runs: CampaignTestRun[]
  /** GH73 — entrées retirées (`removeEntries`), conservées avec `removedAt`. Absent si aucune. */
  removedRuns?: CampaignTestRun[]
  …
}
```

`CarriedEntrySelection extends CarriedFrom` reste valide (alias de type).

### `packages/types/src/test.ts`

`TestRun.campaignRunId: string | null` est **retiré** et remplacé par :

```ts
/** GH73 — entrée de campagne dont le run est l'exécution. Absent : exécution isolée, ou run
 *  antérieur à GH73 (les anciens fichiers portent `campaignRunId: null`, ignoré). */
campaignEntry?: CampaignEntryRef
```

`import type { CampaignEntryRef } from './campaign'` (cycle de types seulement — `campaign.ts`
importe déjà `TestCase` de `test.ts`).

### `packages/zod-schemas/src/test.schema.ts`

`ExecuteTestCaseSchema` reçoit `campaignEntry: z.object({ campaignId: z.string().min(1), entryId: z.string().min(1) }).optional()`.

## 2. Écriture du rattachement

| Fichier | Modification |
|---|---|
| `apps/desktop/src/main/services/tests.service.ts` (`execute`) | `campaignRunId: null` supprimé ; `...(dto.campaignEntry && { campaignEntry: { campaignId, entryId } })` (copie explicite des deux clés, pas de champ parasite venant du renderer) |
| `apps/desktop/src/renderer/routes/campaign.$campaignId_.execute.$testId.tsx` | `api.tests.execute(…, { …, campaignEntry: { campaignId, entryId } })` |
| `apps/desktop/src/main/services/campaign-execution.service.ts` (`apply`) | idem avec `{ campaignId, entryId: inst.entryId }` |
| `apps/desktop/scripts/check-gh34.ts` | fixture : `campaignRunId: null` retiré (sinon erreur TS) |

## 3. `CampaignsService`

### 3.1 Allocateur d'entrées (numérotation + `addedAt`)

Aujourd'hui `buildNewRuns` et `buildCarriedRuns` calculent chacun `lastEntrySuffixes(existingRuns)`
et le passent à `makeRun`. On remplace ce `counts` par un petit objet qui porte aussi la date :

```ts
/** GH73 — attribution des nouvelles entrées d'une écriture : suffixes (GH66) calculés sur les
 *  entrées actives ET retirées — un entryId n'est jamais réutilisé —, date d'ajout commune. */
interface EntryAllocator { counts: Map<string, number>; addedAt: string }

function entryAllocator(runs: CampaignTestRun[], removed: CampaignTestRun[] | undefined, addedAt: string): EntryAllocator {
  return { counts: lastEntrySuffixes([...runs, ...(removed ?? [])]), addedAt }
}
```

- `makeRun(alloc, …)` : `entryId` depuis `alloc.counts` (inchangé), et `addedAt: alloc.addedAt`
  posé juste après `status`.
- `buildNewRuns(existingRuns, alloc, …)` et `buildCarriedRuns(…, existingRuns, alloc, …)` reçoivent
  l'allocateur au lieu de le construire. `existingRuns` sert toujours à la déduplication (T179,
  `carryKey`) — **uniquement les entrées actives** : une entrée retirée ne bloque pas le ré-ajout.
- **Un seul allocateur par écriture**, partagé entre `buildNewRuns` et `buildCarriedRuns` (création,
  `addTests`) : les suffixes attribués par le premier sont vus par le second. Aujourd'hui
  `buildCarriedRuns` recalcule depuis `campaign.runs` déjà complété, ce qui revient au même ; le
  partage le rend explicite.
- Appelants :
  - `create()` : `const now = new Date().toISOString()` ; `createdAt: now` et
    `entryAllocator([], undefined, now)` → `addedAt` des entrées initiales = `createdAt` (critère 4) ;
  - `addTests()` : `entryAllocator(campaign.runs, campaign.removedRuns, new Date().toISOString())` ;
  - `duplicateTest()` : idem.

### 3.2 `removeEntries()`

```ts
const removedAt = new Date().toISOString()
const removedRuns = campaign.runs.filter(r => toRemove.has(r.entryId))
campaign.runs = campaign.runs.filter(r => !toRemove.has(r.entryId))
if (removedRuns.length > 0) {
  campaign.removedRuns = [...(campaign.removedRuns ?? []), ...removedRuns.map(r => ({ ...r, removedAt }))]
}
// testCaseIds : inchangé
```

Aucune écriture de `removedRuns: []`. Garde `completed`/`abandoned` inchangée. Un `entryId` absent
de `runs` (dont un déjà retiré) n'est pas trouvé → ignoré.

### 3.3 `updateRun()`

Signature : `updateRun(repoPath, campaignId, entryId, status: TestRunResult, runId: string, meta?)`
(`TestRunResult` = `PASS|FAIL|BLOCKED|INCOMPLETE`, déjà exporté de `@polenta/types`).

Garde **à l'exécution** (l'IPC est non typé) en tête, avant toute lecture :

```ts
if (!runId) throw new Error(`A test run is required to record a result on ${entryId}`)
if (!RESULTS.includes(status)) throw new Error(`Invalid result ${status} for ${entryId}`)
```

Le spread conditionnel `...(runId && { runId })` devient `runId`.

### 3.4 `ensureEntryIds`

Inchangé (ne touche que `runs`). Vérifié : `get()` remplace `campaign.runs` par la version
backfillée, que `persist` écrit — une campagne pré-T97 dont on retire une entrée fige les
`entryId` de toutes les autres à la réécriture.

## 4. IPC / client

| Fichier | Modification |
|---|---|
| `apps/desktop/src/main/ipc/index.ts` (`campaigns:update-run`) | cast vers `TestRunResult` au lieu de `TestRunStatus` ; la garde est dans le service |
| `packages/api-client/src/types.ts` | `updateRun(repoPath, campaignId, entryId, status: TestRunResult, runId: string)` |
| `packages/api-client/src/ipc-client.ts` | inchangé (transmet les arguments) |
| `apps/desktop/src/web-server/channel-policy.ts` | inchangé |
| `apps/desktop/scripts/check-gh36.ts` | mock `updateRun` : signature alignée si nécessaire au typecheck |

La page d'exécution passe déjà `run.id` ; `mapResultToStatus(globalResult)` renvoie un résultat —
vérifier que son type de retour est compatible avec `TestRunResult` (sinon l'ajuster).

## 5. Lecteurs de `runs` : rien à modifier

Par construction (`removedRuns` séparé), page campagne, liste, exécution, relecture, exports,
classeur GH36, report GH64 (`buildCarriedRuns` lit `source.runs`), sélecteur, `carryOver.ts`,
`campaignTests.ts`, `query-engine` (`campaign_entries`), traçabilité ignorent les entrées
retirées. MCP `list_campaigns` renvoie l'objet complet (`removedRuns` inclus) — voulu (données
brutes).

## 6. Renumérotation GH37 (« Garder les deux »)

`MergeResolutionService.rewriteLeft` réécrit par texte (`renumberText`) **tous les fichiers du côté
gauche modifiés depuis la base, dans le repo fusionné**. Conséquences :
- campagne `CAMP-x` renumérotée : les runs du même repo créés sur la branche (donc modifiés depuis
  la base) ont leur `campaignEntry.campaignId` réécrit — cohérent ;
- test `TEST-x` renuméroté : `entryId` (`TEST-x-n`) et `campaignEntry.entryId` réécrits de même ;
- run écrit dans **un autre repo** (test d'un composant) référençant une campagne renumérotée du
  produit : non réécrit. **Limite connue**, documentée dans SPEC-TESTS §3.2 ; pas de développement.

## 7. Tests e2e existants (spec §4)

Nouvel utilitaire `apps/desktop/e2e-web/support/campaign.ts` :

```ts
/** GH73 — enregistre un résultat comme l'UI : run rattaché à l'entrée, puis statut de l'entrée. */
export async function recordResult(s: Session, repoPath: string, campaign: { id: string; runs: Array<{ entryId: string; testCaseId: string; requirementId?: string }> }, entryId: string, result: TestRunResult): Promise<TestCampaign>
```

Il appelle `tests:execute` (`stepResults: []`, `result`, `requirementId` de l'entrée,
`campaignEntry`) puis `campaigns:update-run` avec `run.id`. Remplace les 14 appels
`campaigns:update-run` sans run de `gh64-carry-over`, `gh65-campaigns`, `gh65-navigation`,
`gh69-matrix`, `gh71-progress`. Effet de bord accepté : ces specs créent de vrais fichiers
`test-runs/` dans le projet de test (la couverture des exigences peut changer — vérifier que
leurs assertions ne dépendent pas de l'absence de run ; GH69 (matrice) et GH71 sont à relire).

Tests unitaires existants : `history.writes.test.ts:201-202` appelle `updateRun` sans `runId` →
passer `'RUN-1'` / `'RUN-2'`.

## 8. Documentation (dernier sprint = sprint 1)

- `SPEC-TESTS.md` §3.2 (`campaignEntry`, limite renumérotation cross-repo), §4.1 (`removedRuns`),
  §4.2 (`addedAt`, `removedAt`, « Retirer un test », numérotation, « faits pour la
  reconstruction » = §6 de la spec), §4.5 (run rattaché à l'instance) ;
- `SPEC-INDEX.md` : colonne MAJ → GH73 pour ces lignes, mots-clés `addedAt`, `removedRuns`,
  `removedAt`, `campaignEntry`, `historique daté` ;
- `AGENTS.md` / générateur AGENTS (si la structure des fichiers de campagne/run y est décrite —
  à vérifier : `grep -n "campaignRunId\|runs:" ` dans le gabarit généré).

## 9. Alternatives écartées

- **Entrées retirées dans `runs` avec `removedAt`** : ~14 lecteurs à filtrer, risque de régression
  sur chaque oubli (décision de cadrage).
- **`campaignRunId` en chaîne `CAMP/ENTRY`** : format à parser, illisible dans le graphe #74.
- **`updateRun` crée un run minimal** : runs « vides » dans l'historique du test.
- **Rattrapage calculé dans Polenta** : aucune fonction de Polenta ne l'utilise (GH79).
- **`addedAt` passé en paramètre supplémentaire de `makeRun`/`buildNewRuns`/`buildCarriedRuns`** :
  listes de paramètres déjà longues ; l'allocateur regroupe ce qui est commun à une écriture.
- **Vérifier dans `updateRun` que le fichier `runId` existe et pointe sur l'entrée** : le run peut
  vivre dans un autre repo (composant) ; la cohérence est assurée par les deux seuls appelants.

## 10. Découpage

Un sprint : §1 → §8. Ordre conseillé : types → `tests.service` → `CampaignsService` (+ tests
unitaires) → appelants (renderer, Excel) → e2e (utilitaire + specs existantes + `gh73-*.spec.ts`)
→ SPEC.
