# GH36 — Sprint 1 : export du classeur d'exécution

Spec : `specs/GH36.md` · Design : `specs/GH36-design.md` · Tests : `specs/GH36-tests.md`

Branche `GH36` **rebasée sur `GH34` (28184e5)**, qui n'est pas encore mergé (réutilisation de
`markdownToPlainText`) : **GH34 doit être mergé avant GH36**. Si GH34 bouge encore, rebaser GH36.

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `packages/types/src/campaign-execution-sheet.ts` | nouveau — colonnes, libellés FR/EN du classeur, `parseStepVerdict`/`parseGlobalVerdict`, types d'aperçu/résultat d'import (utilisés au sprint 2) |
| `packages/types/src/index.ts` | export du module |
| `packages/types/src/parameter-refs.ts` | + `runParamLookup`, `isT171Run`, `substituteRunParams` (déplacés du renderer) |
| `apps/desktop/src/renderer/lib/testParams.ts` | helpers déplacés → ré-exportés depuis `@polenta/types` |
| `apps/desktop/src/main/services/export/campaign-execution.xlsx.ts` | nouveau — `buildExecutionSheetModel` (pur), `buildExecutionWorkbook` / `writeExecutionWorkbook` (exceljs) |
| `apps/desktop/src/main/services/campaign-execution.service.ts` | nouveau — `exportSheet()` |
| `apps/desktop/src/main/container.ts` | instanciation `CampaignExecutionService` |
| `apps/desktop/src/main/ipc/index.ts` | canal `campaigns:execution-sheet-export` (dialogue d'enregistrement + écriture) |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | `api.campaigns.executionSheet.export` |
| `apps/desktop/src/renderer/components/campaign/ExecutionSheetMenu.tsx` | nouveau — bouton « Excel d'exécution » + popover (entrée Export) |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | menu inséré dans le header, masqué si campagne clôturée |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `campaignPage.executionSheet.*` |
| `apps/desktop/scripts/check-gh36.ts` | nouveau — script de contrôle (E1–E10 + verdicts + refus campagne clôturée) |

## Comportement implémenté

- Page campagne, header : bouton **« Excel d'exécution »** → « Exporter le classeur d'exécution… »
  → dialogue d'enregistrement (`CAMP-xxxx_execution_<AAAA-MM-JJ>.xlsx`) → popover « Exporté vers… »
  avec Ouvrir le dossier / Ouvrir le fichier. Bouton absent sur une campagne `completed`/`abandoned`
  (et export refusé côté main).
- Classeur : lignes 1–3 = titre, date d'export et baseline, bandeau ; en-têtes ligne 5 (volet figé,
  filtre auto) ; une ligne d'instance (fond bleu, gras) puis une ligne par étape (repliable, niveau
  de plan 1). Colonnes A–L conformes au design (A = clé masquée).
- Texte des étapes, pré- et postconditions : valeurs figées de l'instance substituées
  (`substituteRunParams`), Markdown → texte brut (`markdownToPlainText` de #34), blocs image/draw.io
  et images inline remplacés par `[image]` / `[diagramme]`.
- Saisie : seules Verdict/Testeur/Date/Commentaire (instance) et Verdict/Commentaire (étape) sont
  déverrouillées ; listes déroulantes de verdicts (globale : 4 valeurs, étape : 5) dans la langue
  de l'UI ; feuille protégée sans mot de passe.
- Feuille `_polenta` très masquée : `formatVersion`, `campaignId`, `exportedAt`, `locale`, puis
  `entryId | testCaseId | orders` par instance.
- Test source introuvable : ligne d'instance « (test introuvable) » sans étape.

## Vérifications

- `pnpm --filter @polenta/desktop exec tsx scripts/check-gh36.ts` : **34 PASS, 0 FAIL**.
- Typecheck desktop : 0 erreur. `pnpm build` (desktop) : OK.
- Ouverture dans **Excel 16** (COM) du fichier produit par le script : **pas de réparation**,
  feuille protégée, I6 déverrouillée / D6 verrouillée, listes `Passé;Échoué;Bloqué;Incomplet` et
  `…;Ignoré;Non exécuté`, `_polenta` très masquée (`Visible = 2`), plan et filtre actifs.
- `/code-review` : aucun bug. Point noté pour le sprint 2 : la clé `entryId#order` suppose des
  `order` uniques dans un test. L'éditeur les renumérote toujours de 1 à n
  (`test.$testId.tsx`, `test.new.tsx`), mais un fichier écrit par MCP ou par import en masse
  pourrait avoir des doublons → à traiter à l'import (`steps_mismatch`), voire à l'export.

## Divergences par rapport au design

- Libellés des verdicts du classeur alignés sur ceux de l'écran d'exécution : `SKIP` = « Ignoré » /
  « Skipped » (et non « Sauté »).
- Ajout de `EXECUTION_SHEET_COLUMNS`, `EXECUTION_SHEET_HEADER_ROW`, `EXECUTION_SHEET_META_NAME` et
  `runStatuses` dans `@polenta/types` : constantes partagées entre l'export et l'import.
- `CampaignExecutionService` ne reçoit pour l'instant que `CampaignsService` et `TestsService`.
  `AuthService` (testeur de repli) sera ajouté au sprint 2, quand l'import en aura besoin.
- Le script accepte `GH36_OUT_DIR` pour conserver les fichiers produits (contrôle manuel dans Excel).

## Mises à jour SPEC

Aucune (prévues au sprint 2, dernier sprint).

## Comment tester manuellement

1. Lancer l'app (`pnpm --filter @polenta/desktop dev`) et ouvrir le projet de démo lave-linge.
2. Ouvrir une campagne `planned` ou `in_progress` contenant un test paramétré et, si possible, un
   test itérant (`{req.…}`).
3. **E14 / E13** : « Excel d'exécution » → « Exporter le classeur d'exécution… » ; vérifier le nom
   proposé ; annuler une fois (aucun message), puis enregistrer.
4. **E11** : ouvrir le fichier dans Excel. Il doit s'ouvrir sans réparation. Vérifier : les
   lignes d'étape se replient sous leur instance ; les cellules grisées et bleues ne sont pas
   modifiables ; la liste déroulante du Verdict fonctionne ; le filtre d'une colonne fonctionne ;
   les paramètres sont substitués.
5. **E10** : passer l'UI en anglais, réexporter, vérifier les libellés anglais.
6. **E12** : clôturer une campagne → le bouton « Excel d'exécution » disparaît.
7. **E15** (non-régression) : « Exporter » (cahier xlsx/docx/pdf, rapport) et l'exécution d'un
   test dans l'outil (affichage des paramètres) fonctionnent comme avant.
