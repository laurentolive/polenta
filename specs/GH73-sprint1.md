# GH73 — Sprint 1 (unique)

Spec : `specs/GH73.md` · Design : `specs/GH73-design.md` · Scénarios : `specs/GH73-tests.md`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/campaign.ts` | `CampaignEntryRef` (et `CarriedFrom` en alias), `CampaignTestRun.addedAt`, `TestCampaign.removedRuns`, `RemovedCampaignTestRun` (= entrée + `removedAt`) |
| `packages/types/src/test.ts` | `TestRun.campaignRunId` retiré, `campaignEntry?: CampaignEntryRef` |
| `packages/zod-schemas/src/test.schema.ts` | `ExecuteTestCaseSchema.campaignEntry` |
| `packages/api-client/src/types.ts` | `updateRun(…, status: TestRunResult, runId: string)` |
| `apps/desktop/src/main/services/tests.service.ts` | `execute` écrit `campaignEntry` (deux clés), refuse une référence incomplète ; plus de `campaignRunId` |
| `apps/desktop/src/main/services/campaigns.service.ts` | `EntryAllocator` (suffixes sur `runs` + `removedRuns`, `addedAt` commun) utilisé par `create` / `addTests` / `duplicateTest` / report ; `removeEntries` déplace vers `removedRuns` ; `updateRun` exige un `runId` chaîne et un résultat de run |
| `apps/desktop/src/main/services/campaign-execution.service.ts` | import Excel : `campaignEntry` de l'instance |
| `apps/desktop/src/main/ipc/index.ts` | `campaigns:update-run` : `runId` obligatoire, `TestRunResult` |
| `apps/desktop/src/renderer/routes/campaign.$campaignId_.execute.$testId.tsx` | `campaignEntry` passé à l'exécution ; `mapResultToStatus` (identité) supprimé |
| `scripts/demo-lave-linge/generate.mjs` | runs de campagne avec `campaignEntry`, entrées avec `addedAt`, plus de `campaignRunId` (démo non régénérée) |
| `apps/desktop/scripts/check-gh34.ts`, `check-gh36.ts` | fixture sans `campaignRunId` ; assertion `campaignEntry` à l'import, `runId` obligatoire dans le mock |
| `apps/desktop/src/main/services/campaigns.service.gh73.test.ts` | nouveau — 29 tests (scénarios §1–§4) |
| `apps/desktop/src/main/services/history.writes.test.ts` | `updateRun` avec `runId` |
| `apps/desktop/e2e-web/support/campaign.ts` | nouveau — `recordResult` (run rattaché puis `update-run`) |
| `apps/desktop/e2e-web/gh64/65/69/71-*.spec.ts` | 14 appels `update-run` sans run → `recordResult` |
| `apps/desktop/e2e-web/gh73-campaign-history.spec.ts` | nouveau — scénarios 1.5, 1.6, 3.11, 3.12, 4.4 |
| `specs/SPEC-TESTS.md`, `specs/SPEC-INDEX.md` | voir ci-dessous |

## Comportement implémenté

- Tout run créé depuis une entrée (page d'exécution, import Excel) porte
  `campaignEntry: { campaignId, entryId }` ; une exécution isolée n'en a pas. Une référence incomplète
  est refusée (le run est immuable).
- Toute entrée créée porte `addedAt` (à la création : `= createdAt` ; report GH64 : date du report).
- `removeEntries` conserve l'entrée retirée, complète, dans `removedRuns` avec `removedAt` ; aucun
  lecteur de `runs` ne la voit ; un `entryId` n'est jamais réutilisé.
- `updateRun` sans `runId` (ou non-chaîne), ou avec `pending` : refus sans écriture.

## Divergences par rapport au design

- **Type `RemovedCampaignTestRun`** (revue de code) : `removedAt` n'est pas un champ optionnel de
  `CampaignTestRun` mais un type dédié à `removedRuns` — le type garantit sa présence.
- **Validation de `campaignEntry` dans `TestsService.execute`** (revue de code) : le canal IPC ne
  valide pas le DTO avec zod ; la garde est dans le service.
- **`mapResultToStatus` supprimé** (identité depuis que `updateRun` prend un `TestRunResult`).
- **Générateur de démo** mis à jour (non prévu au design) pour ne plus produire l'ancien format.

## Revue de code — points écartés

- Position de repli de `lastEntrySuffixes` pour un `entryId` non numérique, calculée sur
  `runs + removedRuns` : sans effet sur l'unicité (un nouvel `entryId` est toujours numérique ; une
  position surévaluée ne fait qu'augmenter le suffixe).
- Migrations de copies (`testSnapshot`) qui ne parcourent que `runs` : aucune n'existe sur `main` ;
  signalé sur #82 (renommage de statut / valeur d'enum), qui devra inclure `removedRuns`.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TESTS.md` §3.2 | `campaignRunId` → `campaignEntry` (posé par exécution et import, immuable, sans chemin de repo, limite de renumérotation GH37 entre repos) ; exemple YAML de TestRun (§5) |
| `SPEC-TESTS.md` §4.1 | `removedRuns` ; ligne `history` : chronologie des entrées portée par `addedAt` / `removedAt` / runs |
| `SPEC-TESTS.md` §4.2 | `addedAt`, `removedAt`, `runId` = dernier run ; « Retirer un test » (conservation, numérotation) ; nouveaux paragraphes « Saisie d'un résultat (GH73) » et « Historique daté (GH73) » (faits, repli des données antérieures côté projet, fuseau, étapes de préparation) |
| `SPEC-TESTS.md` §4.5 | run importé rattaché à l'instance |
| `SPEC-INDEX.md` | lignes SPEC-TESTS §2–3, §4.5, §4.1–4.2 : MAJ → GH73, mots-clés |

`SPEC-TECH-stack.md` §1.1 et `SPEC-REQ-requirements.md` §4.4 (consultées) : pas de divergence.

## Tests

- `pnpm test` : merge-core 38, desktop 454 (dont 29 GH73) — verts.
- `pnpm -r typecheck` : zéro erreur. `check-gh36.ts` : 68 PASS.
- E2E web (suite complète) : 78 passés, 13 ignorés (OIDC / déploiement, sans hôte SSH), 0 échec ;
  specs campagnes relancés après les corrections de revue.

## Tester manuellement

1. Ouvrir une campagne, exécuter une entrée : le fichier `test-runs/<TEST>/<run>.yaml` contient
   `campaignEntry` ; retester → second run, même `campaignEntry`.
2. Retirer une entrée (icône corbeille) : elle disparaît de la page, des pastilles, du classeur Excel
   et des exports ; le YAML de la campagne a `removedRuns` avec `removedAt`.
3. Ré-ajouter le même test : nouvel `entryId` (suffixe suivant), nouvel `addedAt`.
4. Ouvrir une campagne ancienne (sans `addedAt`, runs `campaignRunId: null`) : affichage, exécution,
   relecture et exports inchangés.
5. Client web : mêmes scénarios 1 et 2.
