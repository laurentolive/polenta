# T179 — Design technique : `{req.<champ>}` et une instance par exigence liée

Réf. : `specs/T179.md`. S'appuie sur le code T171 (`parameter-refs.ts`, `ParametersService.previewForTests`,
`CampaignsService.buildNewRuns`, `testParams.ts`, `ParamRefContext`).

## 1. Vue d'ensemble

```
renderer (panneau d'ajout / campaign.new)
   │  preview-params (étendu)            addTests / create (+ reqInstances)
   ▼                                      ▼
CampaignsService ──► ParametersService.previewForTests ──► ReqRefResolver (nouveau)
   │                        (base T171)                     liens + exigences à la source
   └─ buildNewRuns : N instances { requirementId, resolvedParams['req.x'] }
                                  │
execute ─► TestsService.execute(dto.requirementId) ─► TestRun.requirementId
                                  │
TraceabilityService.computeCoverage : dernier run par couple (test, exigence)
```

Principe : **aucune nouvelle mécanique de stockage**. Les valeurs `{req.x}` vont dans
`resolvedParams` (clé `req.x`), les non résolues dans `unresolvedParams` ; la substitution à
l'affichage (`substituteRunParams`) marche donc sans changement dès que la grammaire reconnaît
`req.x`.

## 2. Types (`packages/types`)

### `parameter-refs.ts`
- Étendre la grammaire unique :
  `paramRefRegExp()` → `/\{(?:(NAME)::)?((?:req\.)?NAME)\}/g`, soit une clé `req.<champ>` possible
  **sans** nœud (`{x::req.y}` non reconnu, reste littéral).
- `ParamRef` gagne `kind: 'param' | 'req'` ; `name` = `<champ>` pour `kind: 'req'`, `key` = `req.<champ>`.
- Constante `REQ_REF_PREFIX = 'req.'` + helper `isReqRefKey(key)`.
- `extractTestParamRefs` inchangé (renvoie aussi les clés `req.*`) ; nouveau
  `extractTestReqRefs(tc): string[]` (champs `<champ>` distincts) pour savoir si un test « itère ».
- `extractFieldParamRefs` (exigences) : **filtrer** les clés `req.*` (littérales dans une exigence,
  spec §2) — l'usage « Utilisé par » et la résolution T171 des exigences n'en voient donc aucune.
- `formatReqFieldValue(value: unknown): string | null` — règles spec §6 (string tel quel, number/boolean
  en texte, tableau joint par `, `, objet → YAML une ligne via `JSON.stringify`-like flow ; vide → `null`).
  Pas de dépendance `js-yaml` dans `packages/types` : objet sérialisé en JSON compact (écart assumé,
  cas marginal, noté §9).

### `campaign.ts`
- `CampaignTestRun.requirementId?: string`.
- `UnresolvedParamReason` += `'no_linked_requirement'`.
- `ParamResolutionPreview` gagne :
  ```ts
  /** T179 — présent si le test contient au moins une `{req.x}`. */
  requirements?: Array<{
    requirementId: string
    title: string
    resolved: Record<string, string>      // clés req.* (+ paramètres imbriqués déjà substitués)
    unresolved: UnresolvedParam[]         // missing | empty | tag_not_found pour cette exigence
  }>
  ```
  Si le test itère mais n'a aucune exigence liée : `requirements: []` et les clés `req.*` sont dans
  `unresolved` (raison `no_linked_requirement`). `manual` n'inclut jamais de clé `req.*`.
- `CreateCampaignDto.reqInstances?: ReqInstanceSelection` avec
  ```ts
  /** Par test itérant : exigences retenues, et valeurs saisies à la main par instance. */
  export type ReqInstanceSelection = Record<string, Array<{ requirementId: string; paramValues?: Record<string, string> }>>
  ```
  Absent pour un test → toutes les exigences liées, `paramValuesByTest[testId]` appliqué à chaque
  instance (appels MCP / chemins existants).

### `test.ts`
- `TestRun.requirementId?: string` ; `ExecuteTestCaseDto.requirementId?: string`.

### `export.ts`
- Ligne de run de `CampaignExportPayload` : `requirementId?: string` (+ titre).

## 3. Main process

### 3.1 `ReqRefResolver` (nouveau, `main/services/req-refs.service.ts`)
Service sans état, injecté dans `ParametersService` (DI dans `main/index.ts` / `ipc`).

```ts
interface ReqSourceSnapshot {
  requirements: Map<string, { req: Requirement; repoPath: string }>   // hors terminaux exclus plus tard
  links: ObjectLink[]
  tagMissingRepos: Set<string>
}
class ReqRefResolver {
  loadSource(repoPaths: string[], tag?: string): Promise<ReqSourceSnapshot>
  linkedRequirements(snap, testId, schemaByRepo): Array<{ req, repoPath }>   // matchCoverageLink, 2 sens, non terminaux, tri naturel
  fieldValue(req, champ): unknown                                            // système > dérivé > fields
}
```
- **État courant** : `RequirementsIndexService.findAll` + `findAllLinks` sur tous les repos du
  workspace (`resolveWorkspaceRepoPaths`, comme `TraceabilityService.getMatrix`) — champs dérivés déjà
  présents (index, T112/T142).
- **Au tag** : par repo, résolution du tag (réutiliser la logique de `readYamlAtTag` : extraire
  `GitService.resolveTagOid(repo, tag): Promise<string | null>`) puis `readYamlDirAtRef(requirements)` +
  `readYamlRef(links/links.yaml)`. Champs dérivés : `GitService.fileHistoryMap(repo, 'requirements', ref)`
  — ajout d'un paramètre `ref` optionnel (défaut `'HEAD'`). Repo sans tag → `tagMissingRepos`.
- `matchCoverageLink` est **exporté** de `traceability.service.ts` (aujourd'hui local) pour garantir la
  même définition du lien de couverture. Les IDs de tests = `tcIds` réduit au test courant.
- Terminal : `schema.statuses[].isTerminal` du type de l'exigence (`findObjectTypeDef`), repli
  `status === 'obsolete'` comme `parameters.service.ts:406`.
- Tri naturel des IDs : `localeCompare(…, undefined, { numeric: true })`.

### 3.2 `ParametersService.previewForTests`
Pour chaque test :
1. clés `req.*` écartées de la boucle T171 (jamais `manual`) ;
2. si `extractTestReqRefs(tc)` non vide : snapshot source (chargé **une fois** par appel, mémoïsé
   comme `bases`) → `linkedRequirements` → pour chaque exigence, pour chaque champ :
   - repo de l'exigence dans `tagMissingRepos` → `tag_not_found` ;
   - `fieldValue === undefined` → `missing` ; `formatReqFieldValue === null` → `empty` ;
   - sinon, **paramètres imbriqués** : `substituteMarkdownParamRefs(valeur, lookup)` avec la base du
     repo de l'exigence (même `baseOf`, même tag) et ses composants visibles ; non résolus : littéraux,
     non signalés (spec §6).
3. aucune exigence liée → `requirements: []` + `unresolved` `no_linked_requirement` pour chaque clé ;
   sauf si le tag est introuvable dans **tous** les repos du workspace (liens illisibles) : même forme,
   raison `tag_not_found`.

### 3.3 `CampaignsService`
- `create(dto)` / `addTests(…, reqInstances?)` / `duplicateTest(…, requirementId?)` — nouveau paramètre
  optionnel en fin de signature (IPC `campaigns:add-tests`, `campaigns:duplicate-test`, `campaigns:create`
  via le DTO ; `packages/api-client` `ipc-client.ts` + `types.ts`).
- `buildNewRuns` : si `preview.requirements` est défini **et non vide**, une instance par exigence
  retenue (`reqInstances[tc]` filtré sur les exigences liées ; absent → toutes), dans l'ordre du
  preview :
  `requirementId`, `resolvedParams = { ...preview.resolved, ...req.resolved }`,
  `unresolvedParams = [...preview.unresolved, ...req.unresolved]`, `paramValues` manuel propre à
  l'instance. `entryId` = `${tc}-${n}` inchangé.
  `requirements: []` → une instance sans `requirementId` (unresolved déjà dans `preview.unresolved`).
- **Déduplication `addTests`** : aujourd'hui `newIds = ids ∉ testCaseIds`. Devient :
  - test non itérant : inchangé ;
  - test itérant : garder les couples (test, exigence) sans instance existante
    (`runs.some(r => r.testCaseId === tc && r.requirementId === req)`). Un test déjà présent reste
    donc ajoutable. `testCaseIds` reçoit une occurrence par instance ajoutée (cohérent avec
    `duplicateTest`/`removeEntries`).
- `duplicateTest(…, requirementId)` : snapshot + preview recalculés, puis une seule instance pour cette
  exigence (valeurs `req.*` relues à la source — cohérent avec un nouvel ajout).

### 3.4 Exécution et couverture
- `TestsService.execute` : `run.requirementId = dto.requirementId` si fourni.
- `TestsIndexService` : nouvelle méthode `getRunsMap(repoPath): Map<tcId, TestRun[]>` (triés desc,
  déjà la structure interne `runsByTestCase`).
- `TraceabilityService.computeCoverage(requirements, links, tcMap, latestRunMap, runsMap?)` : si `runsMap`
  est fourni, pour la cellule (req, tc) : `runs.find(r => !r.requirementId || r.requirementId === req.id)`
  ; sinon comportement actuel. Appelants : `getMatrix` et `query-engine.service.ts` passent `runsMap`
  (fusion multi-repo comme `latestRunMap`).
  Écart assumé : `latestRunMap` reste utilisé ailleurs (ex. `testCases` columns « dernier résultat »),
  inchangé.

## 4. Renderer

### 4.1 Campagne
- `lib/testParams.ts` : `manualKeysForRun` exclut `req.*` ; nouveau `isIteratingPreview(p)`.
- **Panneau d'ajout** (`campaign.$campaignId.tsx`) et **création** (`campaign.new.tsx`) — composant
  partagé nouveau `components/campaign/ReqInstancePicker.tsx` : sous un test itérant sélectionné, liste
  cochable des `preview.requirements` (ID + titre, valeurs `req.*` en lecture seule, non résolues avec
  raison), et, si `manual` non vide, les champs de saisie **par exigence cochée**.
  État local : `reqSelection: Record<testId, Record<reqId, Record<key,string>>>` (présence = cochée).
  `isParamsComplete` étendu : pour un test itérant, complétude sur chaque exigence cochée ; aucune
  cochée ⇒ test ignoré (spec §5).
  Disponibilité d'un test (ligne 209) : ajoutable si non inclus, s'il a des références à saisir, **ou**
  s'il reste une exigence liée sans instance (calcul sur `campaign.runs` + preview). Les exigences déjà
  instanciées sont affichées grisées « déjà présente ».
  Soumission : les tests itérants passent tous par `addTests(…, reqInstances)` (plus par
  `duplicateTest`).
- **Liste des tests** de la campagne : suffixe ` · <requirementId>` cliquable (ouvre `req.$reqId`) ;
  « Dupliquer » passe `run.requirementId`.
- **Exécution / relecture** : bandeau d'en-tête « Exigence : ID — titre » si `run.requirementId` ;
  `execute` envoie `requirementId` dans le DTO. `UnresolvedParamsBanner` : libellé i18n de
  `no_linked_requirement`.
- Exports campagne (`print.campaign-plan/report`, construction du `CampaignExportPayload`,
  `campaign.docx.ts`, `campaign.xlsx.ts`) : colonne/mention de l'exigence de l'instance.

### 4.2 Rendu de `{req.x}` hors campagne
- La grammaire étendue fait que `markdownParamRefs.ts`, `ParamRefDecoration.ts` et `ParamRefText.tsx`
  **voient** désormais les clés `req.*`. Dans `ParamRefContext.resolve`, une clé `req.*` renvoie un
  nouveau statut `{ status: 'req', key, field }` → rendu littéral `{req.x}` avec la classe
  `param-ref param-ref--req` (tokens de thème existants, variante « info ») ; pas de double-clic.
- **Survol avec valeurs** : un `ReqRefProvider` optionnel (fiche test `test.$testId.tsx` et éditeur
  du test) fournit `linkedValues(field): Array<{ id, display }>` à partir d'un nouvel IPC
  `tests:linked-requirements(repoPath, testId, workspaceDir)` → `ReqRefResolver` état courant. Hors
  provider (vues Word/Excel, recherche, impressions) : titre générique « Champ `x` de l'exigence liée ».
  **Écart vs spec §7** (valeurs au survol aussi en Word/Excel/recherche) : éviter un appel par test
  dans des listes de centaines d'éléments ; à valider.
- `ParamPicker` : section « Champ de l'exigence liée » (champs système + dérivés, puis union des champs
  des types `category: requirement` du schéma), insère `{req.<champ>}`.
- Exigences : `extractFieldParamRefs` filtre `req.*`, et une clé `req.*` écrite dans une exigence est
  rendue en **texte brut** (spec §2 : littérale, sans style). Nouvelle prop `reqRefs?: boolean` sur
  `RichTextViewer` / `RichTextField` / `StaticRichTextViewer` (défaut `false`), passée à `true` par les
  seuls rendus de champs de test ; à `false`, le plugin markdown et la décoration Tiptap ignorent les
  clés `req.*`.

## 5. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/parameter-refs.ts` | grammaire `req.`, `kind`, `extractTestReqRefs`, `formatReqFieldValue`, filtrage exigences |
| `packages/types/src/campaign.ts`, `test.ts`, `export.ts` | champs §2 |
| `packages/api-client/src/ipc-client.ts`, `types.ts` | signatures `addTests`/`duplicateTest`, `tests.linkedRequirements` |
| `apps/desktop/src/main/services/req-refs.service.ts` | **nouveau** |
| `apps/desktop/src/main/services/git.service.ts` | `resolveTagOid`, `fileHistoryMap(…, ref)` |
| `apps/desktop/src/main/services/parameters.service.ts` | preview `req.*` |
| `apps/desktop/src/main/services/campaigns.service.ts` | génération, dédup, duplicate |
| `apps/desktop/src/main/services/tests.service.ts`, `tests-index.service.ts` | `requirementId` du run, `getRunsMap` |
| `apps/desktop/src/main/services/traceability.service.ts`, `query-engine.service.ts` | `matchCoverageLink` exporté, couverture par couple |
| `apps/desktop/src/main/ipc/index.ts`, `main/index.ts` (DI) | canaux, injection |
| `renderer/lib/testParams.ts`, `hooks/useParamPreview.ts` | exclusion `req.*`, complétude |
| `renderer/components/campaign/ReqInstancePicker.tsx` | **nouveau** |
| `renderer/routes/campaign.$campaignId.tsx`, `campaign.new.tsx`, `campaign.$campaignId_.execute.$testId.tsx`, `campaign.$campaignId_.run.$testId.tsx` | §4.1 |
| `renderer/routes/print.campaign-plan.tsx`, `print.campaign-report.tsx`, `main/services/export/campaign.docx.ts`, `campaign.xlsx.ts` | exigence de l'instance |
| `renderer/contexts/ParamRefContext.tsx`, `lib/markdownParamRefs.ts`, `tiptap/ParamRefDecoration.ts`, `components/parameters/ParamRefText.tsx`, `ParamPicker.tsx`, `routes/test.$testId.tsx` | §4.2 |
| `renderer/components/UnresolvedParamsBanner.tsx`, i18n FR/EN | raison `no_linked_requirement`, libellés |

## 6. Décisions techniques et alternatives rejetées

- **Clés `req.*` dans `resolvedParams`** plutôt qu'un champ `resolvedReqFields` : la substitution,
  l'affichage figé et les exports de campagne fonctionnent sans modification. Rejeté : second
  dictionnaire (double chemin de substitution partout).
- **Extension de la grammaire unique** plutôt qu'une regex séparée : une seule définition partagée
  main/renderer (principe T171) ; le préfixe `req.` ne peut entrer en collision avec aucun nom existant
  (le point est hors grammaire).
- **`TestRun.requirementId`** plutôt que relier via `campaignRunId` → campagne → instance : le
  moteur de traçabilité n'a pas à lire les campagnes ; `campaignRunId` reste `null` (hors scope).
- **Couverture par `find` dans la liste triée** plutôt qu'un nouvel index par couple : un seul
  parcours, liste déjà triée par l'index.
- **Snapshot source chargé une fois par preview** (et non par test) : un ajout groupé de N tests ne
  relit pas N fois `requirements/` au tag.
- **Paramètres imbriqués non signalés** dans `unresolvedParams` : la clé figée est `req.x` ; une
  référence imbriquée non résolue reste visible dans la valeur figée.
- Rejeté : générer les instances à l'exécution (valeurs non figées, contraire à T171 §7).

## 7. Découpage en sprints

**Sprint 1 — modèle, main, couverture** (testable par script de service, sans UI)
- §2 types, §3 entièrement (resolver, preview, génération, dédup, duplicate, execute, couverture),
  IPC et api-client.
- Script de test de service dans le scratchpad (même approche que T171/T175 : appels directs des
  services sur un repo fixture temporaire, commits et tags réels), non versionné.

**Sprint 2 — renderer, exports, SPEC**
- §4.1 et §4.2, i18n, exports, mises à jour SPEC (Refs SPEC de `specs/T179.md`) et `SPEC-INDEX.md`.

## 8. Risques
- `fileHistoryMap` au tag parcourt tout l'historique jusqu'au tag : coût déjà accepté à HEAD (T142),
  mémoïsé par (repo, tag) dans le preview.
- Tests existants dont le texte contient littéralement `{req.xxx}` : deviennent des références (non
  résolues, raison `no_linked_requirement` ou valeur de l'exigence). Probabilité faible ; critère 16
  vérifié sur la fixture T171.

## 9. Points à valider
1. Survol avec valeurs limité à la fiche test et à l'éditeur (écart §4.2).
2. Objet structuré sérialisé en JSON compact plutôt qu'en YAML une ligne (§2).
3. `duplicateTest` relit les valeurs `req.*` à la source au moment du duplicata.
