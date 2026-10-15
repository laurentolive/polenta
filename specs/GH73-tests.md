# GH73 — Scénarios de test

Réfs : `specs/GH73.md` (critères d'acceptation §8), `specs/GH73-design.md`.
U = test unitaire (vitest, `apps/desktop/src/main/services/campaigns.service.gh73.test.ts` sauf
mention), E = e2e web (`apps/desktop/e2e-web/gh73-campaign-history.spec.ts`), M = manuel.

## 1. Rattachement run → entrée

| # | Type | Scénario | Attendu |
|---|---|---|---|
| 1.1 | U (`tests.service`) | `execute(…, { stepResults, result: 'PASS', campaignEntry: { campaignId: 'CAMP-0001', entryId: 'TEST-0001-1' } })` | Le YAML `test-runs/TEST-0001/<run>.yaml` contient `campaignEntry` avec exactement ces deux clés ; pas de clé `campaignRunId` |
| 1.2 | U (`tests.service`) | `execute` sans `campaignEntry` (exécution isolée) | Ni `campaignEntry` ni `campaignRunId` dans le fichier |
| 1.3 | U (`tests.service`) | `campaignEntry` avec une clé supplémentaire (`{ campaignId, entryId, foo }`) | Seules `campaignId` et `entryId` sont écrites |
| 1.4 | U (`campaign-execution`) | Import d'un classeur avec 2 instances remplies | Chaque run créé porte le `campaignEntry` de son instance (`CAMP`, `entryId`) |
| 1.5 | E | Créer une campagne, exécuter une entrée par l'UI (page d'exécution) | Le run (`tests:runs` / lecture du fichier) porte `campaignEntry = { campaign.id, entryId }` (critère 1) |
| 1.6 | E | Exécuter deux fois la même entrée | Deux runs avec le même `campaignEntry` ; `runs[].runId` = le second (critère 3) |
| 1.7 | U | Lecture d'un ancien run `campaignRunId: null` (fixture) par l'index des tests / traçabilité | Aucune erreur ; couverture inchangée (critère 9) |

## 2. `addedAt`

| # | Type | Scénario | Attendu |
|---|---|---|---|
| 2.1 | U | `create()` avec 2 tests | Les 2 entrées ont `addedAt === campaign.createdAt` |
| 2.2 | U | `addTests()` sur une campagne existante | Les nouvelles entrées ont un `addedAt` ≥ `createdAt`, identique entre elles ; les anciennes inchangées |
| 2.3 | U | `addTests()` d'un test itérant (T179, 2 exigences) | Les 2 instances ont `addedAt` |
| 2.4 | U | `duplicateTest()` | La nouvelle instance a `addedAt` ; l'instance dupliquée garde le sien |
| 2.5 | U | Report GH64 (`create` avec `carried`, et `addTests` avec `carried`) | Instance reportée : `addedAt` = date du report, **pas** celui de l'entrée source |
| 2.6 | U | `updateRun`, `updateRunParams`, `refreshEntries` (GH68) sur une entrée avec `addedAt` | `addedAt` inchangé |
| 2.7 | U | Campagne sans `addedAt` (fixture pré-GH73) : `get()`, puis `updateRun` | Pas de `addedAt` ajouté aux entrées existantes à la réécriture (critère 9) |

## 3. Entrées retirées

| # | Type | Scénario | Attendu |
|---|---|---|---|
| 3.1 | U | Campagne neuve, `get()` / fichier | Pas de clé `removedRuns` |
| 3.2 | U | `removeEntries(['TEST-0002-1'])` sur une entrée exécutée (PASS, `runId`) | Sortie de `runs`, présente en fin de `removedRuns` avec tous ses champs (`status`, `runId`, `testSnapshot`, `addedAt`…) et `removedAt` ; `testCaseIds` perd une occurrence (critère 5) |
| 3.3 | U | Retirer deux entrées en deux appels | `removedRuns` dans l'ordre des retraits, `removedAt` distincts |
| 3.4 | U | `removeEntries` d'un `entryId` déjà retiré, ou inconnu | Aucun changement de `removedRuns` (pas de doublon, `removedAt` non réécrit) |
| 3.5 | U | Retrait de `TEST-0002-1` et `TEST-0002-2`, puis `duplicateTest` / `addTests` / report de `TEST-0002` | Nouvelle instance `TEST-0002-3` dans les trois cas (critère 6) |
| 3.6 | U | Retrait d'un test sans paramètre puis `addTests` du même test | Ré-ajout accepté (non dédoublonné contre `removedRuns`), nouvel `entryId`, nouvel `addedAt` |
| 3.7 | U | Retrait d'une instance T179 (test, REQ-A) puis `addTests` du test itérant | Une instance pour REQ-A est recréée |
| 3.8 | U | Report GH64 : la source a une entrée retirée | L'entrée retirée n'est pas reportable (sélection ignorée) |
| 3.9 | U | Campagne pré-T97 (runs sans `entryId`), retrait de la 1ʳᵉ instance d'un test à 2 instances | La 2ᵉ garde `TEST-x-2` dans le fichier réécrit ; la retirée est `TEST-x-1` dans `removedRuns` |
| 3.10 | U | `removeEntries` sur campagne `completed` | Refus (inchangé) |
| 3.11 | E | Retirer une entrée depuis la page campagne | Elle disparaît de la liste et des pastilles ; le fichier a `removedRuns` (critère 7) |
| 3.12 | E | Après retrait : `queries:execute` sur `campaign_entries` de la campagne | L'entrée retirée n'y figure pas (critère 7) |
| 3.13 | U (`campaign-execution`) | Export du classeur après retrait ; import d'un classeur exporté **avant** le retrait, avec l'instance retirée remplie | Export sans l'instance ; import : erreur par instance « absente de la campagne », aucun run créé pour elle, les autres importées |
| 3.14 | M | Exports plan/rapport (xlsx/docx/pdf) après retrait | L'instance retirée n'apparaît pas |

## 4. Saisie sans run

| # | Type | Scénario | Attendu |
|---|---|---|---|
| 4.1 | U | `updateRun(…, 'PASS', undefined)` / `''` | Erreur ; fichier de campagne inchangé (pas de passage `in_progress`) (critère 8) |
| 4.2 | U | `updateRun(…, 'pending', 'RUN-1')` | Erreur ; fichier inchangé |
| 4.3 | U | `updateRun(…, 'FAIL', 'RUN-1')` | Statut, `runId`, `executedAt` écrits ; `planned` → `in_progress` (inchangé) |
| 4.4 | E | `campaigns:update-run` sans `runId` via le canal IPC/web | Rejet (erreur remontée) |

## 5. Non-régression

| # | Type | Scénario | Attendu |
|---|---|---|---|
| 5.1 | U | Suite existante : `campaigns.service.carry`, `campaigns.service.refresh`, `campaign-execution.gh68`, `history.writes` (adapté : `runId` fourni), `query-engine.campaigns`, `dashboard-seed.campaigns` | Vert |
| 5.2 | E | `gh64-carry-over`, `gh65-campaigns`, `gh65-navigation`, `gh69-matrix`, `gh71-progress`, `gh68-unapproved`, `gh77-history`, `gh80-execute-switch` (utilitaire `recordResult`) | Vert, assertions inchangées |
| 5.3 | — | `pnpm -r typecheck` (dont `scripts/check-gh34.ts`, `check-gh36.ts`), lint | Zéro erreur nouvelle |
| 5.4 | M | Ouvrir une campagne existante du projet de démo (sans `addedAt`, runs `campaignRunId: null`), l'exécuter, relire un run, exporter | Aucun changement visible (critère 9) |
| 5.5 | M | Client web : exécuter une entrée, retirer une entrée | Même comportement que desktop |

## 6. Critères d'acceptation ↔ scénarios

| Critère (spec §8) | Scénarios |
|---|---|
| 1 | 1.1, 1.5 |
| 2 | 1.4 |
| 3 | 1.6 |
| 4 | 2.1–2.5 |
| 5 | 3.1, 3.2 |
| 6 | 3.5 |
| 7 | 3.11–3.14, 3.6–3.8 |
| 8 | 4.1, 4.2, 4.4 |
| 9 | 1.7, 2.7, 5.4 |
| 10 | 5.1–5.3 |
