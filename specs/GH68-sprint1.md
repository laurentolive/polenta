# GH68 — Sprint 1 : main et plumbing

Design : `specs/GH68-design.md` §7 (sprint 1).

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `packages/types/src/schema.ts` | `isApprovalStatus(typeDef, status)` : statut `isApproval` du type, repli sur `approved` |
| `packages/types/src/campaign-execution-sheet.ts` | Type `ExecutionImportWarning` ; nouveau warning `test_not_approved { entryId, status }` |
| `apps/desktop/src/main/services/campaigns.service.ts` | `refreshEntries(repoPath, campaignId, entryIds)` ; `approvalPredicate(repoPath)` (public) ; helper `toPlain` |
| `apps/desktop/src/main/services/campaign-execution.service.ts` | `exportSheet` : resynchronise les instances pending avant de construire le classeur ; `preview` : passe le prédicat d'approbation |
| `apps/desktop/src/main/services/export/campaign-execution-import.ts` | `ExecutionImportContext.isApproved` ; warning `test_not_approved` sur chaque instance importable dont la copie n'est pas approuvée |
| `apps/desktop/src/main/ipc/index.ts`, `packages/api-client/src/{ipc-client,types}.ts`, `apps/desktop/src/web-server/channel-policy.ts` | Canal `campaigns:refresh-entries` (exposé au web, repo en argument 0) |
| `apps/desktop/src/renderer/components/campaign/ExecutionImportModal.tsx` + `i18n/locales/{fr,en}.json` | Rendu du nouveau warning (`campaignPage.executionSheet.testNotApproved`) — avancé du sprint 2, requis par le typecheck (l'union de warnings n'a plus toujours `row`) |
| `apps/desktop/scripts/check-gh36.ts` | Faux `CampaignsService` complété (`refreshEntries`, `approvalPredicate`) |
| `apps/desktop/src/main/services/campaigns.service.refresh.test.ts` (nouveau) | U1–U2, R1–R12 |
| `apps/desktop/src/main/services/campaign-execution.gh68.test.ts` (nouveau) | X1–X7 |

## Comportement implémenté

- `refreshEntries` : pour chaque instance demandée qui est `pending`, a une copie et dont la copie
  n'est pas approuvée → recopie depuis `TestsService.findOne`. Comparaison profonde sur la forme
  sérialisée (clés `undefined` retirées) ; écriture seulement si une copie change. Campagne clôturée,
  entrée pré-T49, test supprimé, id inconnu : sans effet. Sérialisé par `enqueue` comme les autres
  mutations. Paramètres de l'instance non touchés.
- Export Excel : la campagne réécrite par `refreshEntries` est celle exportée.
- Aperçu/import Excel : avertissement `test_not_approved`, import non refusé.

## Divergences par rapport au design

- **Rendu du warning d'import** fait dès ce sprint (cf. tableau) ; le sprint 2 n'a plus à le faire
  (design §5.4). Le statut est affiché par son nom (`draft`), pas par son libellé de schéma.
- **Design §2, justification** : la validation d'import ne compare pas les étapes à `testSnapshot`
  mais aux ordres d'étapes enregistrés **dans le classeur** à l'export (`instances[].orders`). La
  décision reste valable : sans resynchronisation à l'export, les résultats importés seraient
  enregistrés contre une copie (ancien brouillon) différente du contenu remis au testeur.
- **Test de type composant** (`objectTypeRef` d'un nœud d'un autre repo) : le schéma lu est celui du
  repo de la campagne ; un type introuvable retombe sur `approved` (même limite que l'actuel
  `isTestApproved` côté renderer). Non traité.

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 25 fichiers / 276 tests desktop + merge-core OK (dont les 22 nouveaux).
- `tsx scripts/check-gh36.ts` : 67 PASS, 0 FAIL.
- Lint : aucune configuration ESLint dans le repo (`turbo lint` n'exécute rien).
- `/code-review` : aucune remarque sur le diff du sprint ; les remarques remontées portent sur du
  code GH64/GH65 déjà mergé (moteur de requêtes, seed dashboard, drill-down, `carryKey`) — hors
  périmètre.

## Mises à jour SPEC

Aucune (sprint final : sprint 2).

## Test manuel

Pas d'effet visible avant le sprint 2, sauf :
1. Campagne avec un test `draft` ajouté (via YAML ou après sprint 2), test modifié ensuite.
2. Exporter le classeur d'exécution → le classeur contient la version actuelle ; `campaigns/<id>.yaml`
   a la nouvelle copie.
3. Remplir et réimporter → aperçu avec « TEST-…-1 : test non approuvé (draft) », import accepté.
