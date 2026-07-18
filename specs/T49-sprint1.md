# T49 — Sprint 1 (dernier sprint)

Voir [T49.md](T49.md) (spec), [T49-design.md](T49-design.md) (design),
[T49-tests.md](T49-tests.md) (scénarios).

## Fichiers modifiés

- `packages/types/src/campaign.ts` — `CampaignTestRun.testSnapshot?: TestCase`.
- `packages/types/src/export.ts` — `CampaignExportPayload.tests: TestCase[]` →
  `entries: { run: CampaignTestRun; test: TestCase }[]`.
- `apps/desktop/src/main/services/campaigns.service.ts` — injection de
  `TestsService`, nouvelle aide privée `snapshotsFor()`, `buildNewRuns()`
  étendu avec `testSnapshot`, appelé depuis `create()`/`addTests()`/
  `duplicateTest()`.
- `apps/desktop/src/main/container.ts` — `new CampaignsService(git, tests)`.
- `apps/desktop/src/main/services/export/campaign.docx.ts`,
  `campaign.xlsx.ts` — consomment `payload.entries` au lieu de
  `payload.tests` + recherche par `testCaseId`.
- `apps/desktop/src/renderer/lib/campaignTests.ts` — `resolveCampaignTests()`
  remplacée par `resolveCampaignRuns()` (résolution indexée par `run`, pas par
  `testCaseId` unique) ; nouvelle `resolveRunTest()` pour la résolution d'une
  entrée isolée.
- `apps/desktop/src/renderer/hooks/useResolvedCampaignTest.ts` (nouveau) —
  hook partagé `testSnapshot ?? fetch live`, extrait de la duplication
  constatée en revue de code (voir § Divergences).
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` — liste des
  tests de la campagne, payload d'export, panneau "Dupliquer" corrigé (voir
  § Divergences).
- `apps/desktop/src/renderer/routes/campaign.$campaignId.execute.$testId.tsx`,
  `campaign.$campaignId.run.$testId.tsx` — utilisent
  `useResolvedCampaignTest()`.
- `apps/desktop/src/renderer/routes/print.campaign-plan.tsx`,
  `print.campaign-report.tsx` — utilisent `resolveCampaignRuns()`.

## Comportement implémenté

Conforme à `specs/T49.md` : `addTests()`, `duplicateTest()` et la sélection
initiale de `create()` copient l'objet `TestCase` complet dans
`testSnapshot` au moment de l'ajout. Toute lecture ultérieure (liste,
exécution, relecture, exports xlsx/docx/pdf) résout `testSnapshot` en
priorité, avec repli sur l'état live du test uniquement pour les entrées
créées avant ce ticket (pas de migration rétroactive, décision de cadrage).
Le gating "test approuvé" reste basé sur l'état live des tests (panneau
d'ajout), inchangé.

## Divergences par rapport au design

Trois écarts par rapport à `specs/T49-design.md`, tous identifiés lors du
`/code-review` du diff (8 angles) et corrigés dans ce sprint plutôt que
reportés :

1. **`snapshotsFor()` tolérant, pas strict** — le design (§2.9) prévoyait que
   `TestsService.findOne()` puisse légitimement faire échouer tout l'ajout si
   un id ne résout plus. La revue a montré que ça change un comportement
   existant : avant T49, un `testCaseId` invalide n'a jamais empêché
   `addTests`/`create`/`duplicateTest` de réussir (seul l'affichage l'ignorait
   silencieusement) — un id devenu invalide entre le chargement du panneau
   d'ajout côté renderer et l'appel serveur (course bénigne, ex. test
   supprimé entre-temps) aurait fait échouer tout un ajout groupé, y compris
   pour les ids valides du même lot. `snapshotsFor()` intercepte maintenant
   l'échec par id (`.catch(() => undefined)`) : un id non résolu est omis de
   la map plutôt que de propager l'erreur — l'entrée correspondante se
   comporte alors comme une entrée pré-T49 (pas de `testSnapshot`, repli sur
   résolution live). Documenté dans `SPEC-TESTS.md` § "Snapshot à
   l'inclusion".
2. **Panneau "Dupliquer" corrigé pour utiliser l'état live, pas le snapshot
   figé de l'entrée cliquée** — non anticipé par le design. `duplicateTest()`
   capture un *nouveau* snapshot sur l'état live du test au moment de la
   duplication ; mais le panneau (icône, `TestParamFields`, validation avant
   soumission) lisait `tc` (snapshot-first) de l'entrée cliquée, qui peut être
   un ancien snapshot dont les paramètres ont changé depuis. Corrigé en
   introduisant `liveTc`/`hasLiveParams` dans `campaign.$campaignId.tsx`,
   utilisés uniquement pour l'affordance "Dupliquer" (icône + panneau) —
   l'affordance "Modifier les paramètres" d'une instance existante continue
   d'utiliser le snapshot figé de cette instance, qui est correct dans ce cas.
3. **Consolidation de la résolution "snapshot sinon live"**, dupliquée trois
   fois (inline dans `campaign.$campaignId.tsx`, et dans
   `execute.$testId.tsx`/`run.$testId.tsx`) — extraite en `resolveRunTest()`
   (fonction pure, `lib/campaignTests.ts`) et `useResolvedCampaignTest()`
   (hook React Query, `hooks/`), tel que suggéré indépendamment par 3 des 8
   angles de revue (reuse, simplification, altitude).

Aucune autre divergence : le reste de l'implémentation suit le design tel
qu'écrit (types, wiring, export payload, pages de lecture).

## Mises à jour SPEC effectuées

- `SPEC-TESTS.md` §4.1 — note sur `runs[]` embarquant désormais une copie
  figée par entrée.
- `SPEC-TESTS.md` §4.2 — ajout de `testSnapshot` au tableau `CampaignTestRun`,
  nouvelle sous-section "Snapshot à l'inclusion (T49)" (règle de gel, gating
  d'ajout inchangé, comportement de "Dupliquer" sur l'état live, id non
  résolu omis plutôt que bloquant) et sous-section "Compatibilité ascendante
  (`testSnapshot`)" (pas de backfill rétroactif, à la différence du backfill
  d'`entryId`).
- `SPEC-TESTS.md` §4.4 — la substitution des paramètres `{label}` s'appuie
  sur le texte de `testSnapshot` quand présent, plus sur l'état live du test.
- `SPEC-INDEX.md` — colonne `MAJ` des lignes `SPEC-TESTS.md §4+` et
  `SPEC-TESTS.md §4.1–4.2` mise à jour vers `T49`, mots-clés `testSnapshot`/
  `snapshot`/`figé` ajoutés.

## Comment tester manuellement

Suivre les 8 scénarios nominaux et les cas limites de
[T49-tests.md](T49-tests.md). Points à vérifier en priorité suite aux
corrections du sprint :
- Dupliquer une instance d'un test dont les paramètres ont changé depuis son
  ajout initial à la campagne : le panneau de saisie doit proposer les
  paramètres *actuels* du test, pas ceux de l'instance dupliquée.
- Ajouter un lot de tests à une campagne alors qu'un des ids n'est plus
  résolvable (test supprimé juste avant) : l'ajout des autres tests du lot
  doit réussir, l'entrée du test manquant se comporte comme une entrée
  pré-T49 (résolution live, dégradée si le test n'existe plus).

## Vérifications

- `npx turbo typecheck --filter=@polenta/desktop --filter=@polenta/types` :
  0 erreur.
- `/code-review` (effort high, 8 angles) exécuté sur le diff complet ; 3
  correctifs appliqués (voir § Divergences), le reste des candidats écarté
  (nitpicks mineurs sans impact, ou hors périmètre — ex. une race latente
  préexistante dans `tests-index.service.ts` non liée à ce ticket).
