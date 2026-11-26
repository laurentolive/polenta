# GH442 — Sprint 1 (unique)

Spec : `specs/GH442.md` · design : `specs/GH442-design.md` · scénarios : `specs/GH442-tests.md`.

## Fichiers modifiés

| Zone | Fichiers |
|---|---|
| Types | `packages/types/src/campaign.ts` (`entryRequirementIds`, `requirementIdsText`, `CampaignEntryRequirements`), `packages/types/src/export.ts` (`entries[].requirements?`) |
| Main | `services/parameters.service.ts` (`coveredRequirementIds`), `services/campaigns.service.ts` (`entryRequirements`), `ipc/index.ts` + `web-server/channel-policy.ts` (canal `campaigns:entry-requirements`), `services/campaign-execution.service.ts` + `export/campaign-execution.xlsx.ts` (classeur), `export/campaign.xlsx.ts`, `export/campaign.docx.ts` |
| API | `packages/api-client/src/types.ts`, `ipc-client.ts` (`campaigns.entryRequirements`) |
| Renderer | `hooks/useEntryRequirements.ts` (nouveau), `routes/campaign.$campaignId.tsx`, `components/campaign/CampaignEntriesGrid.tsx`, `routes/print.campaign-plan.tsx`, `routes/print.campaign-report.tsx`, `lib/campaignTests.ts` (`requirementSuffix`) |
| Tests | `shared/entry-requirements.gh442.test.ts`, `services/parameters.service.gh442.test.ts`, `services/campaigns.service.gh442.test.ts`, `services/export/campaign-requirements.gh442.test.ts`, `e2e-web/gh442-campaign-requirements.spec.ts` ; adaptés : `e2e-web/gh389-campaigns.spec.ts`, `e2e-web/gh64-carry-over.spec.ts` |

## Comportement implémenté

- Colonne « Exigence » de la grille des entrées : exigence de l'instance (test itérant) sinon exigences
  non terminales liées au test, tri naturel, texte « R1, R2 », liens d'élément, `data-requirement-source`.
  Calcul côté main à l'état courant ; relu à chaque retour sur la page.
- Mêmes exigences dans le cahier (xlsx, docx, pdf), le rapport (docx, pdf) et le classeur d'exécution
  (colonne en lecture seule). Le payload des exports est relu au clic ; les routes d'impression reçoivent
  `workspaceDir` pour résoudre les mêmes exigences que la grille.
- « Reportée depuis » n'est plus dans les colonnes visibles par défaut ; reste dans 👁 Colonnes.
  Les préférences enregistrées sont conservées.

## Divergences par rapport au design

- Pas d'infobulle (Q5) : un `title` sur la cellule recouvrirait la popup d'aperçu des liens (GH250,
  leçon du 2026-11-03 sur les info-bulles). La source est dans `data-requirement-source`. Spec, design et
  scénarios mis à jour.
- Hook placé dans `renderer/hooks/` (et non `lib/`).
- U10 (texte de la grille) et E3 (filtre de colonne) ne sont pas des tests dédiés : la grille lit
  `getText` = `requirementIdsText(requirements)`, déjà couvert par U1 ; l'affichage l'est par E1. E5
  (exports en e2e) est couvert au niveau unitaire (U7–U9) : un export téléchargé n'ajoute rien de plus.
  E7 (préférence conservée) repose sur `useGridPrefs` (liste enregistrée prioritaire sur les défauts),
  non modifié.

## Mises à jour SPEC

- `SPEC-TESTS.md` §4.2 : paragraphe « Colonne “Exigence” des entrées (GH442) » (règle, état courant,
  exports, colonne « Reportée depuis » masquée par défaut). `SPEC-INDEX.md` : MAJ de la ligne §4.1–4.2 → GH442.

## Comment tester à la main

1. Campagne contenant un test non itérant lié à 2 exigences, un test sans lien, un test itérant
   (`{req.…}`) : la colonne Exigence affiche `R1, R2`, rien, puis une exigence par instance.
2. Créer un lien de couverture sur le test sans lien (vue Tests), revenir sur la campagne : l'exigence apparaît.
3. Exporter le cahier (xlsx, docx, pdf), le rapport et le classeur d'exécution : même texte que la grille.
   Le PDF est à vérifier à l'œil (mise en page).
4. Workspace avec un composant en repo séparé : une exigence du composant, liée au test, s'affiche dans la grille et le PDF.
5. Ouvrir une campagne avec des entrées reportées : pas de colonne « Reportée depuis » ; 👁 Colonnes la propose.
