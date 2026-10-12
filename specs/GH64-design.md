# GH64 — Design : ajouter des tests depuis une autre campagne (report)

Spec : `specs/GH64.md`. Issue : #64.

## 1. Vue d'ensemble

Le renderer construit la liste des entrées reportables (lecture seule, à partir de
`api.campaigns.list`), le responsable choisit, et le main crée les instances. Le main ne fait
**pas confiance** au renderer pour le contenu : il ne reçoit que des références
`(campaignId, entryId)` + les valeurs saisies à l'étape 2, relit les campagnes source, et
applique les mêmes règles (exigence encore liée, doublons) de façon défensive.

```
TestPickerModal ─ onglet « Tests » (GH33, inchangé) ─────────────┐
               └ onglet « Depuis une campagne » (CampaignCarryPanel) ─┤→ PickerResult { testIds, paramValues, reqSel, carried[] }
                                                                     ↓
campaign.new.tsx  → campaigns.create(dto + carried)
campaign.$id.tsx  → campaigns.addTests(…, carried)
                                                                     ↓
CampaignsService.buildCarriedRuns → instances avec carriedFrom
```

## 2. Types (`packages/types/src/campaign.ts`)

```ts
export interface CampaignTestRun {
  // … existant …
  /** GH64 — instance reportée depuis une autre campagne (entrée source). Absent : ajout normal. */
  carriedFrom?: CarriedFrom
}

export interface CarriedFrom {
  campaignId: string
  entryId: string
}

/** GH64 — entrée source retenue pour un report, avec les saisies de l'étape 2. */
export interface CarriedEntrySelection extends CarriedFrom {
  /** Valeurs saisies à la main (pré-remplies depuis la source, éditées à l'étape 2). */
  paramValues?: Record<string, string>
  /** Entrée source sans exigence d'un test devenu itérant : exigences retenues à l'étape 2,
   *  une instance chacune (même forme que `ReqInstanceSelection`). Ignoré sinon. */
  reqInstances?: Array<{ requirementId: string; paramValues?: Record<string, string> }>
}

export interface CreateCampaignDto {
  // … existant …
  /** GH64 — entrées reportées depuis d'autres campagnes. */
  carried?: CarriedEntrySelection[]
}
```

Pas de nouveau statut, pas de champ sur la campagne source (spec §4.5).

## 3. Main — `apps/desktop/src/main/services/campaigns.service.ts`

### 3.1 Refactor préalable de `buildNewRuns`

La closure `newRun(tcId, given, requirementId)` est extraite en méthode privée
`makeRun(counts, tcId, given, requirementId, snapshots, previews)` (même corps), pour être
partagée par `buildNewRuns` et `buildCarriedRuns`. Comportement inchangé.

### 3.2 Nouvelle méthode `buildCarriedRuns`

```ts
private async buildCarriedRuns(
  repoPath: string,
  targetId: string | undefined,       // undefined à la création
  existingRuns: CampaignTestRun[],    // runs de la cible + instances de l'onglet Tests
  carried: CarriedEntrySelection[],
  baselineRef: string | undefined,
  workspaceDir: string | undefined,
): Promise<CampaignTestRun[]>         // nouvelles instances uniquement
```

1. Ignore les sélections dont `campaignId === targetId`.
2. Charge chaque campagne source une fois (`this.get`, cache local à l'appel) ; source ou
   `entryId` introuvable → sélection ignorée.
3. `snapshotsFor` + `previewsFor` sur les `testCaseId` des entrées (baseline **cible**) ; test
   introuvable → ignoré.
4. Exigence :
   - entrée source avec `requirementId` et test itérant → conservée si encore liée
     (`preview.requirements`), sinon sélection ignorée ;
   - test non itérant → instance sans exigence ;
   - entrée source sans `requirementId`, test itérant → une instance par
     `sel.reqInstances` encore liée (absent : toutes les exigences liées, comme `buildNewRuns`).
5. Doublon : clé `carryKey(testCaseId, requirementId, paramValuesSaisis)` (§3.3) comparée à
   `existingRuns` + instances déjà construites dans l'appel → ignorée si présente.
6. `makeRun(…)` puis `run.carriedFrom = { campaignId, entryId }`.

Comme pour `addTests`, une sélection invalide est **ignorée silencieusement** (le renderer l'a
déjà grisée ; cas de course seulement), sans faire échouer le reste.

### 3.3 Clé de doublon — `packages/types/src/campaign.ts`

Fonction pure partagée renderer/main :

```ts
export function carryKey(testCaseId: string, requirementId: string | undefined,
                         paramValues: Record<string, string> | undefined): string
```

`paramValues` normalisées : clés triées, valeurs `trim()`, valeurs vides retirées.

Pour un test **sans** référence à saisir, la clé se réduit à `(test, exigence)` — on retrouve la
règle actuelle « une seule inclusion d'un test sans paramètre ».

### 3.4 `create()` et `addTests()`

- `create(repoPath, dto, workspaceDir)` : après `buildNewRuns`, ajoute
  `buildCarriedRuns(repoPath, undefined, runs, dto.carried ?? [], dto.baselineRef, workspaceDir)`.
- `addTests(…, reqInstances?, carried?: CarriedEntrySelection[])` : nouveau paramètre en
  **dernière position** (pas de décalage des index `ROOT_ARGS` de `channel-policy.ts`). Garde
  `completed`/`abandoned` inchangée. Le court-circuit `if (newIds.length === 0) return campaign`
  devient « rien de l'onglet Tests **et** rien de reporté ».
- `testCaseIds` de la campagne : une occurrence par instance créée (règle existante).
- Ordre dans `runs[]` : existantes, puis onglet Tests, puis reportées.

**Priorité entre onglets** (spec §4.4 « l'entrée reportée l'emporte ») : appliquée par le
renderer, qui retire de `testIds`/`reqSel` ce que couvre une entrée reportée (§4.2). Le main
reste défensif dans l'autre sens : une entrée reportée en doublon d'une instance de l'onglet
Tests est ignorée — le résultat est donc toujours une seule instance.

### 3.5 IPC / API

| Fichier | Changement |
|---------|------------|
| `apps/desktop/src/main/ipc/index.ts` | `campaigns:add-tests` : argument `carried` en fin de liste |
| `packages/api-client/src/types.ts` | signature `addTests(…, reqInstances?, carried?)` |
| `packages/api-client/src/ipc-client.ts` | transmission de `carried` |
| `apps/desktop/src/web-server/*` | rien (canal déjà autorisé, `carried` n'est pas un chemin) — vérifier `channel-policy.test.ts` |
| MCP (`bulk-import.tools.ts`) | rien : `carried` optionnel |

## 4. Renderer

### 4.1 Logique pure — `apps/desktop/src/renderer/lib/carryOver.ts` (nouveau)

```ts
export type CarryUnavailable = 'deleted' | 'notApproved' | 'outOfScope' | 'reqUnlinked' | 'alreadyPresent'

export interface CarryRow {
  key: string                    // carryKey(...)
  campaignId: string             // source retenue (la plus récente)
  entryId: string
  otherSources: string[]         // autres campagnes ayant la même clé
  testCaseId: string
  requirementId?: string
  paramValues: Record<string, string>   // saisies de la source
  status: TestRunStatus
  executedAt?: string
  executedBy?: string
  sourceVersion?: number         // testSnapshot.version de la source
  liveVersion?: number
  unavailable?: CarryUnavailable
}

export function buildCarryRows(input: {
  sources: TestCampaign[]                       // campagnes cochées
  statuses: Set<TestRunStatus>
  testsById: Map<string, TestCase>              // état live
  isEligible: (tc: TestCase) => 'ok' | 'notApproved' | 'outOfScope'
  previews: Map<string, ParamResolutionPreview>
  targetKeys: Set<string>                       // clés des instances de la cible (vide à la création)
}): CarryRow[]
```

- Dédoublonnage entre sources : la plus récente gagne (`executedAt`, sinon `createdAt` de la
  campagne) ; les autres vont dans `otherSources`.
- `reqUnlinked` : `requirementId` présent, test itérant, exigence absente de
  `preview.requirements` (le preview est lu à la baseline cible → spec §4.1).
- Ordre : campagne source (plus récente d'abord), puis ordre des `runs[]`.

Autres helpers : `targetKeysOf(runs)`, `toCarriedSelection(row, step2Values)`.

### 4.2 Composant — `apps/desktop/src/renderer/components/campaign/CampaignCarryPanel.tsx` (nouveau)

Contenu de l'onglet (spec §3) : liste des campagnes (cases, pastilles de statuts — réutiliser les
classes de `CampaignListView`), cases de filtre de statut, filtre texte, tableau des lignes
(`buildCarryRows`), case d'en-tête. Contrôlé : `checked: Set<key>` et `onChange` remontés au
`TestPickerModal`. Les lignes `unavailable` sont grisées, motif traduit.

Coche par défaut : une ligne disponible **jamais vue** est cochée à sa première apparition ; un
`Set<key>` « vues » dans le panel garde les choix quand campagnes/filtre changent (spec §3.3).

Données : `useQuery(['campaigns', repoPath], api.campaigns.list)` (clé déjà invalidée par
`useLiveFileSync`).

### 4.3 `TestPickerModal.tsx`

- Onglets à l'étape 1 : `source: 'tests' | 'campaign'` ; l'onglet Tests rend l'UI actuelle sans
  modification.
- Nouveaux props : `targetCampaignId?: string`, `targetRuns?: CampaignTestRun[]` (ajout),
  `isEligible(tc)` (fourni par l'appelant : approbation à l'ajout, filtre composant/niveau à la
  création — mêmes règles que `candidates`).
- État : `carriedChecked: Set<key>`, `carriedValues: Record<key, Record<string,string>>`
  (pré-rempli depuis `row.paramValues`, filtré sur `preview.manual`), `carriedReqSel` pour les
  entrées sans exigence d'un test devenu itérant.
- `previewIds` : candidats ∪ présélection ∪ `testCaseId` de **toutes** les entrées des campagnes
  listées — une seule requête de prévisualisation (pas une par coche).
- Priorité onglets (§3.4) : à la validation, retire de `testIds` les tests non itérants sans
  référence à saisir couverts par une entrée reportée ; pour un test itérant, les exigences
  couvertes sont traitées comme « présentes » (`presentOf` étendu) → plus proposées à l'étape 2.
- Étape 2 : un bloc par entrée reportée nécessitant une saisie (en-tête
  `TEST-ID · ↩ CAMP-ID · REQ-ID`) → `TestParamFields` (valeurs pré-remplies) ou
  `ReqInstancePicker` (sans exigence + test itérant). Pas de picker d'exigence pour une entrée
  qui a un `requirementId`.
- Complétude / compteur : `isAddComplete` et `countInstances` de l'onglet Tests + équivalent
  pour les reportées (helpers dans `carryOver.ts`).
- `PickerResult` gagne `carried: CarriedEntrySelection[]` et `carriedRows: CarryRow[]`
  (affichage du récapitulatif de création) ; `EMPTY_PICKER_RESULT` mis à jour ; `isDirty`
  tient compte de `carried`.

### 4.4 `routes/campaign.$campaignId.tsx`

- Passe `targetCampaignId`, `targetRuns`, `isEligible = isTestApproved`.
- `handleConfirmAdd` : transmet `carried` à `addTestsMutation` (appel aussi quand seul
  `carried` est non vide).
- Liste des tests : mention `↩ CAMP-ID` (lien vers `/campaign/$campaignId` de la source) sur
  les instances avec `carriedFrom` (spec §4.6).

### 4.5 `routes/campaign.new.tsx`

- État `carried` + `carriedRows`, réinitialisés comme la sélection (resync T46).
- Récapitulatif : lignes reportées après les tests sélectionnés (`TEST-ID titre ↩ CAMP-ID`,
  exigence, valeurs).
- `paramsComplete` : inclut les reportées (`useParamPreview` sur leurs tests ; un changement de
  `baselineRef` après la modale peut rendre une saisie incomplète → message existant).
- `createMutation` : `carried` dans le DTO.

### 4.6 i18n

`apps/desktop/src/renderer/i18n/locales/` (fr + en) : `campaignPage.picker.tabTests`,
`tabCampaign`, `carry.*` (titres de colonnes, filtres, motifs `deleted`/`notApproved`/
`outOfScope`/`reqUnlinked`/`alreadyPresent`, avertissement de version, « aussi dans … »,
liste vide, mention `↩`).

## 5. Décisions et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|----------|---------------------|--------|
| Le renderer envoie des références `(campaignId, entryId)` | Envoyer `testCaseId`/`requirementId` directement via `testCaseIds`/`reqInstances` | `addTests` déduplique par `testCaseId` (une instance par test non itérant) et ne porte pas `carriedFrom` ; le main doit relire la source pour garantir la traçabilité |
| Nouveau paramètre en fin de `addTests` | Nouveau canal `campaigns:carry` | Une seule écriture atomique (file `enqueue`) pour les deux onglets ; pas de nouveau canal à déclarer côté web |
| `carryKey` dans `@polenta/types` | Dupliquer la règle | Même règle de doublon des deux côtés |
| Liste construite à partir de `campaigns.list` | Nouveau canal « entrées reportables » côté main | Les données sont déjà chargées ; le calcul de disponibilité dépend de l'état du sélecteur (mode, baseline saisie) |
| Sélection invalide ignorée en silence côté main | Erreur | Cohérent avec `addTests`/`snapshotsFor` (test supprimé entre affichage et appel) |

## 6. Découpage en sprints — 2 sprints

**Sprint 1 — modèle et main**
- Types (§2), `carryKey`, refactor `makeRun`, `buildCarriedRuns`, `create`/`addTests`, IPC/API.
- Mention `↩ CAMP-ID` dans la liste des tests de la campagne (§4.4, dernier point).
- Tests unitaires `campaigns.service.carry.test.ts` (scénarios S1–S10 de `GH64-tests.md`).

**Sprint 2 — sélecteur**
- `carryOver.ts` + `carryOver.test.ts`, `CampaignCarryPanel`, `TestPickerModal`, pages création
  et ajout, i18n.
- e2e web `e2e-web/gh64-carry-over.spec.ts` (scénarios U1–U6).
- Mise à jour SPEC (`SPEC-TESTS.md` §4.1–4.2) et `SPEC-INDEX.md`.
