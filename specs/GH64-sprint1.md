# GH64 — Sprint 1 : modèle et main

Spec : `specs/GH64.md` — Design : `specs/GH64-design.md` §2, §3, §4.4 (mention ↩) — Tests :
`specs/GH64-tests.md` S1–S12.

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `packages/types/src/campaign.ts` | `CampaignTestRun.carriedFrom`, `CarriedFrom`, `CarriedEntrySelection`, `CreateCampaignDto.carried`, fonction `carryKey` |
| `apps/desktop/src/main/services/campaigns.service.ts` | extraction de `makeRun` (ex-closure de `buildNewRuns`), helper `storedParamValues`, nouvelle méthode `buildCarriedRuns`, branchée dans `create()` et `addTests()` (nouveau paramètre `carried` en dernière position) |
| `apps/desktop/src/main/ipc/index.ts` | `campaigns:add-tests` transmet `carried` |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | signature `addTests(…, reqInstances?, carried?)` |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | mention `↩ CAMP-ID` (lien vers la campagne source) sur les instances reportées |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `campaignPage.carriedFrom` (infobulle) |
| `apps/desktop/src/main/services/campaigns.service.carry.test.ts` | nouveau — 17 tests |

## Comportement implémenté

- `create(dto)` et `addTests(…, carried)` créent une instance `pending` par entrée reportée, après
  les instances de l'onglet Tests, avec `carriedFrom: { campaignId, entryId }`.
- Le main relit la campagne source (lectures en parallèle) : test et exigence viennent de l'entrée
  source, seules les saisies de l'étape 2 viennent du renderer.
- Copie du test (T49) dans son état actuel ; paramètres de base relus à la `baselineRef` de la
  **cible** (T171) ; exigence T179 gardée si encore liée, sinon entrée ignorée ; entrée sans
  exigence d'un test devenu itérant → une instance par `reqInstances` retenue.
- Doublon (`carryKey` : test, exigence, valeurs saisies normalisées) contre l'existant et les
  instances déjà créées dans l'appel → ignoré.
- Sélection invalide ignorée sans erreur : campagne source absente, `entryId` absent, campagne
  cible elle-même, id de campagne non simple (pas de chemin), test supprimé.
- Campagne source **illisible** (YAML invalide…) → erreur remontée (pas de report vide silencieux).
- Sans `ParametersService` (MCP) : comportement T97, exigence et valeurs de la source conservées.
- Campagne source jamais réécrite.

## Divergences par rapport au design

- `buildCarriedRuns` lit les campagnes source directement (`readYaml` + `ensureEntryIds`) au lieu
  de `this.get(...).catch(() => null)` : distingue « absente » (ignorée) de « illisible » (erreur)
  — retour de revue de code.
- Le lien `↩ CAMP-ID` ouvre la source sans `component`/`level` (ceux de la cible ne
  s'appliquent pas forcément à la source) — retour de revue de code.
- Ajout du helper `storedParamValues`, partagé par `makeRun` et le calcul de la clé de doublon.

## Revue de code — points non retenus

- `entryId` en doublon après `removeEntries` puis ajout : bug antérieur → issue **#66**.
- Pas de contrôle d'approbation côté main : cohérent avec l'existant (gating dans le renderer,
  sprint 2).
- Règle de doublon différente entre onglet Tests (`buildNewRuns`) et report : voulu par la spec
  (onglet Tests inchangé).

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 189 tests desktop + 34 merge-core, tous verts (dont `channel-policy.test.ts` —
  `ROOT_ARGS` inchangée).
- `pnpm --filter @polenta/desktop test:e2e:web` : 28 passés, 13 ignorés (forge / déploiement
  requis), 0 échec.
- Pas de script `lint` dans le dépôt.

## Mises à jour SPEC

Aucune à ce sprint (prévues au sprint 2, dernier sprint).

## Tester manuellement

L'interface de sélection arrive au sprint 2 ; au sprint 1, seul l'affichage est testable :

1. Dans un projet, éditer à la main une campagne non clôturée et ajouter sur une entrée
   `carriedFrom: { campaignId: CAMP-0001, entryId: TEST-0001-1 }`.
2. Ouvrir la campagne : la ligne affiche `↩ CAMP-0001` ; l'infobulle donne l'entrée source ; le
   clic ouvre CAMP-0001.
3. Ajouter / exécuter / exporter la campagne : comportement inchangé.
