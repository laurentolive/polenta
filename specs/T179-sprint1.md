# T179 — Sprint 1 : modèle, main process, couverture

Réf. : `specs/T179.md`, `specs/T179-design.md` §2–§3, `specs/T179-tests.md` (N1–N12, L1–L11).

## Fichiers modifiés

**Types partagés**
- `packages/types/src/parameter-refs.ts` — grammaire étendue à `{req.<champ>}` (jamais préfixée
  d'un nœud : `{x::req.y}` reste littéral), `REQ_REF_PREFIX`, `isReqRefKey`, `ParamRef.kind`,
  `extractTestReqRefs`, `formatReqFieldValue` ; `extractFieldParamRefs` ignore les clés `req.*`
  (littérales dans une exigence).
- `packages/types/src/campaign.ts` — `CampaignTestRun.requirementId`, raison
  `no_linked_requirement`, `ParamResolutionPreview.requirements`, `ReqInstancePreview`,
  `ReqInstanceSelection`, `CreateCampaignDto.reqInstances`.
- `packages/types/src/test.ts` — `TestRun.requirementId`.
- `packages/zod-schemas/src/test.schema.ts` — `ExecuteTestCaseDto.requirementId`.
- `packages/api-client/src/{types,ipc-client}.ts` — `addTests(…, reqInstances)`,
  `duplicateTest(…, requirementId)`.

**Main process**
- `services/req-refs.service.ts` (nouveau) — `ReqRefsService` : exigences + liens du workspace à
  l'état courant (index) ou au tag (lecture git, champs dérivés sur l'historique jusqu'au tag) ;
  `linkedRequirements` (même `matchCoverageLink` que la matrice, deux sens, tout type, terminales
  exclues, orphelins ignorés, tri naturel) ; `reqFieldValue` (système/dérivés prioritaires sur
  `fields`, `needsRevalidation` absent = `false`, `jiraLinks` = clés Jira).
- `services/git.service.ts` — `resolveTagOid` (extrait de `readYamlAtTag`), `fileHistoryMap(…, ref)`.
- `services/parameters.service.ts` — `previewForTests` : résolution `{req.<champ>}` par exigence
  liée (source chargée une fois par appel), paramètres de base imbriqués résolus dans le repo de
  l'exigence ; les clés `req.*` ne sont jamais `manual`.
- `services/campaigns.service.ts` — `buildNewRuns` : une instance par exigence retenue ;
  déduplication par couple (test, exigence) dans `addTests` ; `duplicateTest(…, requirementId)` ;
  `testCaseIds` = une occurrence par instance créée.
- `services/tests.service.ts` — `execute` écrit `requirementId` sur le `TestRun`.
- `services/tests-index.service.ts` — `getRunsMap`.
- `services/traceability.service.ts` — `matchCoverageLink` exporté, `mergeRunsMaps`,
  `latestRunForRequirement` ; `computeCoverage(…, runsMap)`, `getImpactReport` et
  `generateTestPlan` retiennent le dernier run pertinent pour l'exigence.
- `services/query-engine.service.ts` — couverture du dataset avec `runsMap`.
- `container.ts`, `ipc/index.ts` — injection de `ReqRefsService`, nouveaux arguments IPC.

## Comportement implémenté

- `{req.<champ>}` dans un test : à l'ajout en campagne, une instance par exigence liée (ou par
  exigence retenue via `reqInstances`), avec `requirementId` et les valeurs figées dans
  `resolvedParams` (clés `req.<champ>`). Tous les champs de l'exigence sont accessibles
  (personnalisés, système, dérivés).
- Test sans exigence liée : une instance, `{req.…}` en `no_linked_requirement` ; tag introuvable
  partout : `tag_not_found`.
- Campagne avec baseline : exigences, liens et champs dérivés lus au tag.
- Couverture : un run d'instance ne compte que pour son exigence ; un run sans exigence compte
  pour toutes (comportement antérieur).

## Divergences par rapport au design

1. **`duplicateTest` durci** (relevé par `/code-review`) : si l'exigence demandée n'est plus liée,
   erreur explicite au lieu d'un duplicata silencieusement vide ; duplicata *sans* exigence d'un
   test devenu itérant : une seule instance, `{req.…}` en `no_linked_requirement` (sinon elles
   seraient apparues comme références à saisir).
2. **Rapport d'impact et plan de test** (`getImpactReport`, `generateTestPlan`) alignés sur la
   règle de couverture par exigence — non prévu au design, relevé par `/code-review`.
3. `create` recalcule `testCaseIds` depuis les instances créées.

## Constat hors périmètre (préexistant)

`getImpactReport` : un test relié par un lien **test → exigence** est d'abord mis en file comme
*exigence* (`traceability.service.ts`, boucle `links.filter(l => l.targetId === reqId)`), marqué
visité, puis ignoré — il n'apparaît pas dans le rapport. Sans lien avec T179, non corrigé ;
à ouvrir en ticket séparé si souhaité.

## Vérifications

- `npm run typecheck` (desktop), `tsc` de `apps/api`, `packages/api-client`, `packages/types` :
  aucune erreur.
- Script de service (scratchpad, non versionné ; repo git temporaire avec commits et tag réels) :
  37/37 — N1–N12, L1–L11, plus R1–R3 (correctifs de revue).
- `/code-review` (medium) : 3 constats, corrigés (divergences 1 et 2).

## Non couvert (sprint 2)

- Le renderer n'envoie pas encore `reqInstances` ni `requirementId` (exécution, duplicata). En
  attendant, un ajout depuis l'UI crée une instance par exigence liée avec les mêmes valeurs
  saisies, et un run exécuté depuis l'UI n'a pas d'exigence (couverture comme avant T179).
- Rendu de `{req.x}` hors campagne (aujourd'hui affiché avec le style « non résolue » de T171),
  panneau d'ajout, exports, i18n, mises à jour SPEC.

## Comment tester manuellement

Dans l'app : ajouter à une campagne un test contenant `{req.<champ>}` et lié à deux exigences.
Deux instances apparaissent, et chacune affiche à l'exécution les valeurs de son exigence.
