# GH81 — Design : resynchronisation des copies à la saisie, plus d'écriture sur consultation

Spec : `specs/GH81.md`. **Un seul sprint.**

## 1. Principe

La resynchronisation GH68 (`refreshEntries`, qui **écrit** la campagne) disparaît. Elle est
remplacée par :

1. une **résolution en lecture seule** de la *version effective* de chaque instance
   (`CampaignsService.effectiveTests`) — utilisée par l'export et l'import ;
2. un **gel à l'écriture du résultat** : `updateRun` accepte la version à figer et remplace la
   copie d'une instance resynchronisable dans la même écriture que le résultat ;
3. une **empreinte** de la version exportée dans `_polenta`, comparée à l'import.

Côté page d'exécution, la règle « resynchronisable » (déjà calculée par le renderer depuis GH80)
choisit entre la copie et le test live ; la version affichée (figée pour la session, GH71) est
envoyée à la saisie.

## 2. Fichiers à modifier

### 2.1 `packages/types`

- `campaign-execution-sheet.ts`
  - `EXECUTION_SHEET_FORMAT_VERSION = 2` ; nouvelle constante
    `EXECUTION_SHEET_SUPPORTED_VERSIONS = [1, 2]` (v1 : pas d'empreinte).
  - `ExecutionImportInstanceError` : `| { code: 'test_changed_since_export'; testCaseId: string }`.
- Pas de nouveau type partagé pour l'empreinte : elle n'est calculée que dans le main.

### 2.2 Main — `campaigns.service.ts`

- **Supprimer** `refreshEntries`.
- Nouveau prédicat interne `isResyncable(campaign, run, isApproved)` : campagne `planned` /
  `in_progress`, `run.status === 'pending'`, `run.testSnapshot` présent, `!isApproved(run.testSnapshot)`.
  Même règle qu'aujourd'hui, extraite pour être partagée.
- Nouvelle méthode publique, lecture seule :
  ```ts
  /** GH81 — version effective par entrée : test live (sans history) pour une instance
   *  resynchronisable, copie sinon, test live pour une entrée pré-T49 ; absent si introuvable. */
  async effectiveTests(repoPath: string, campaign: TestCampaign):
    Promise<Map<string /* entryId */, { test: TestCase; resyncable: boolean }>>
  ```
  Un seul `approvalPredicate` + un `snapshotsFor` sur les ids nécessaires (resynchronisables et
  pré-T49). Test resynchronisable supprimé : copie existante, `resyncable: false`.
- `updateRun(..., meta?)` : `meta` gagne `testSnapshot?: TestCase`. Dans la file `enqueue`,
  avant toute mutation :
  - `testSnapshot` fourni et `testSnapshot.id !== run.testCaseId` → `throw` (rien n'est écrit dans
    la campagne) ;
  - si `isResyncable(campaign, run, isApproved)` → `run.testSnapshot = withoutHistory(testSnapshot)` ;
  - sinon la version fournie est ignorée.
  Le prédicat d'approbation n'est lu que si `testSnapshot` est fourni (pas de surcoût pour les
  autres appels). Une seule `persist` comme aujourd'hui.
- Helper exporté (module `campaign-snapshot.util.ts`, nouveau, main) :
  `testFingerprint(test: TestCase): string` = sha256 hex de la sérialisation canonique
  (`withoutHistory`, clés `undefined` retirées, clés d'objet triées récursivement, ordre des
  tableaux conservé). `toPlain` de `campaigns.service.ts` y migre si utile.

### 2.3 Main — `campaign-execution.service.ts`

- `exportSheet` : plus d'appel à `refreshEntries`, **aucune écriture**. Les entrées sont construites
  avec `effectiveTests` (remplace `liveTestsWithoutSnapshot`, supprimée) ; chaque entrée du modèle
  porte `fingerprint: testFingerprint(test)` (absent si test introuvable).
- `preview` : calcule `effectiveTests` et le passe au contexte de validation (remplace
  `liveTests`). Méthode interne `previewWithTests` qui retourne aussi la map, réutilisée par `apply`.
- `apply` : pour chaque instance importée, `updateRun(..., { executedAt, executedBy, testSnapshot })`
  avec `testSnapshot` = version effective **seulement si** le classeur porte une empreinte (v2) ;
  classeur v1 : pas de `testSnapshot` → copie actuelle conservée (spec §4.2).

### 2.4 Main — `export/campaign-execution.xlsx.ts`

- `instances[]` du modèle : champ `fingerprint?: string`.
- Feuille `_polenta` : en-tête `['entryId', 'testCaseId', 'orders', 'testFound', 'fingerprint']`,
  5ᵉ colonne renseignée.

### 2.5 Main — `export/campaign-execution-import.ts`

- `RawExecutionSheet.instances[]` : `fingerprint?: string` (5ᵉ colonne, vide → absent).
- `fatalOf` : accepte toute version de `EXECUTION_SHEET_SUPPORTED_VERSIONS` (aujourd'hui égalité
  stricte : un classeur v1 serait refusé `unsupported_version`, contraire à CA8).
- `ExecutionImportContext` : `liveTests` remplacé par
  `effectiveTests?: Map<string, { test: TestCase; resyncable: boolean }>` + `fingerprint?: (t) => string`
  (injecté, pour garder le module pur et testable sans crypto).
- `validateInstance` : après `test_not_found`, **avant** `steps_mismatch` (message plus
  explicite pour le cas #75) : si `meta.fingerprint` présent, version effective présente et
  `fingerprint(test) !== meta.fingerprint` → `{ code: 'test_changed_since_export', testCaseId }`.
- Avertissement `test_not_approved` : jugé sur la version effective (remplace
  `run.testSnapshot ?? liveTests`).

### 2.6 IPC / API / web

- `ipc/index.ts` : supprimer `campaigns:refresh-entries` ; `campaigns:update-run` reçoit un 6ᵉ
  argument optionnel `displayed?: TestCase`, transmis comme `meta.testSnapshot` (le renderer ne
  peut toujours pas fournir `executedAt` / `executedBy`).
- `packages/api-client` (`types.ts`, `ipc-client.ts`) : retirer `refreshEntries` ;
  `updateRun(repoPath, campaignId, entryId, status, runId?, displayed?: TestCase)`.
- `web-server/channel-policy.ts` : retirer `campaigns:refresh-entries` de la liste blanche et de
  `ROOT_ARGS`. `campaigns:update-run` inchangé (chemin en argument 0). `bodyLimit` 50 Mo : un test
  complet tient largement.

### 2.7 Renderer

- `hooks/useResolvedCampaignTest.ts` : 4ᵉ paramètre `opts?: { live?: boolean }`. `live` → la
  requête `['test', repoPath, id]` est activée même avec copie, et le test live (sans `history`)
  est retourné en priorité ; erreur / introuvable → copie. Sans `live` : comportement actuel (page
  de relecture inchangée). `isLoading` couvre le chargement live.
- `routes/campaign.$campaignId_.execute.$testId.tsx` :
  - supprimer la mutation `refreshMutation` et l'effet associé, ainsi que le message
    `campaignPage.refreshFailed` (clé i18n retirée si plus utilisée) ;
  - `resyncable = refreshCandidate && schemaKnown && !isTestApproved(entry.testSnapshot, schema)`
    (schéma illisible : `isTestApproved(..., undefined)` → repli `approved`, comme le main) ;
  - `useResolvedCampaignTest(repoPath, testCaseId, entry?.testSnapshot, { live: resyncable })` ;
    la version n'est verrouillée (`lockedTest`, GH71) qu'une fois le schéma connu et le live chargé
    (remplace `refreshing`) ;
  - soumission : `api.campaigns.updateRun(..., run.id, resyncable ? testCase : undefined)` —
    `testCase` = version verrouillée affichée (D3) ;
  - bandeau GH71 `testChanged` inchangé : il compare désormais la version verrouillée au test live
    (rafraîchi par l'invalidation de la requête `['test', …]` ou le refetch au focus).
- `components/campaign/ExecutionImportModal.tsx` : message pour `test_changed_since_export`.
- `i18n/locales/{fr,en}.json` : `campaignPage.executionSheet.error.testChangedSinceExport`
  (« Le test {{testCaseId}} a changé depuis l'export du classeur — réexportez le classeur pour
  cette instance. »).

## 3. Décisions techniques et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Version affichée envoyée par la page (contenu complet) | Envoyer seulement l'empreinte et figer le live si égale | D3 : figer ce qui a été vu même si le test a changé ; impossible sans le contenu. |
| Contrôle main limité à `id` + retrait de `history` | Vérifier que la version envoyée correspond à une version git du test | Un utilisateur qui peut saisir un résultat peut déjà modifier le test ; une version non commitée n'a pas de trace git. |
| Gel dans `updateRun` (une écriture) | Nouvel appel « freeze » avant `updateRun` | Deux écritures, et un état intermédiaire (copie figée sans résultat) si le second échoue. |
| Empreinte sha256 de la forme canonique | `test.version` | D2 : aveugle aux modifications hors application. |
| Empreinte calculée dans le main seulement | Calcul partagé dans `@polenta/types` | Seuls export et import (main) en ont besoin ; évite `crypto` côté renderer. |
| Suppression de `refreshEntries` et de son channel | Le garder sans appelant | Code mort qui écrit sur consultation ; le web n'expose plus ce channel. |
| Classeur v1 accepté sans contrôle | Refus `unsupported_version` | CA8 ; un classeur v1 a été produit par un export qui avait déjà écrit la copie. |
| Vérification d'empreinte avant `steps_mismatch` | Après | Une étape insérée (#75) donnerait sinon un `steps_mismatch` moins compréhensible. |

## 4. Divergence assumée par rapport à la spec

- **CA10** (« rien d'écrit ») : la page appelle `tests.execute` (écrit le `TestRun`) **avant**
  `updateRun`. Un `id` incohérent fait échouer `updateRun` sans toucher la campagne, mais le
  `TestRun` déjà créé reste — comme pour tout échec de `updateRun` aujourd'hui. Ce cas ne se
  produit que sur un appel forgé ou un bug ; un channel combiné « exécuter une instance » est hors
  périmètre. CA10 est vérifié sur le fichier de campagne.

## 5. Impacts

- Tests existants à adapter : `campaigns.service.refresh.test.ts` (R1–R12 → `effectiveTests` et
  gel par `updateRun`), `campaign-execution.gh68.test.ts` (X1 : plus d'écriture ; X7 : devient
  le cas d'erreur `test_changed_since_export`), e2e `gh68-unapproved.spec.ts` (E1 : plus
  d'écriture à l'ouverture ; appel `campaigns:refresh-entries` retiré), `gh80-execute-switch.spec.ts`
  (X1 : affichage live sans écriture), éventuels tests de liste blanche du serveur web.
- MCP : aucun outil n'appelle `refreshEntries` / `updateRun` — sans impact.
- SPEC à mettre à jour au dernier sprint : SPEC-TESTS §4.1–4.2 (« Tests non approuvés »), §4+
  (page d'exécution), §4.5 (export / import, `_polenta` v2, nouvelle erreur) ; SPEC-WEB (liste
  blanche) si elle cite le channel.
