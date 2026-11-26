# GH442 — Design technique

Spec : `specs/GH442.md` (décisions Q1–Q8). Un seul sprint : le changement est transverse mais mince
(un calcul partagé, quatre consommateurs).

## Principe

Une seule règle, calculée **côté main**, consommée par la grille, les exports et le classeur :

```
exigences affichées d'une entrée = [run.requirementId]            si l'instance en a un (test itérant)
                                 = exigences non terminales liées au test, tri naturel   sinon
```

La seconde moitié existe déjà : `ReqRefsService.linkedRequirements(source, testId)` (T179 — même
définition du lien que la matrice, `matchCoverageLink`, deux sens, terminales exclues, tri naturel).
On la réutilise telle quelle ; rien de nouveau côté définition du lien.

## Fichiers

| Fichier | Changement |
|---|---|
| `packages/types/src/campaign.ts` | `entryRequirementIds(run, covered?)` (règle ci-dessus, pure) et `CampaignEntryRequirements = Record<entryId, string[]>` |
| `packages/types/src/export.ts` | `CampaignExportPayload.entries[].requirements?: string[]` (liste affichée ; absente = repli sur `run.requirementId`) |
| `main/services/parameters.service.ts` | `coveredRequirementIds(campaignRepo, testIds, { workspaceDir })` → `Map<testId, string[]>` : `workspaceCtx` + `reqRefs.loadSource` + `linkedRequirements` (une lecture pour tous les tests). C'est là que vivent déjà `workspaceCtx` (repos du workspace) et `reqRefs` |
| `main/services/campaigns.service.ts` | `entryRequirements(repoPath, campaignId, workspaceDir?)` → `CampaignEntryRequirements` pour toutes les entrées de la campagne (`entryRequirementIds` + `coveredRequirementIds` pour les seules entrées sans `requirementId`) |
| `main/ipc/index.ts`, `web-server/channel-policy.ts`, `api-client` (`types.ts`, `ipc-client.ts`) | canal `campaigns:entry-requirements` (args `[0, 2]` : repo, workspace), liste blanche web |
| `main/services/campaign-execution.service.ts`, `export/campaign-execution.xlsx.ts` | classeur d'exécution : `ExecutionSheetEntry.requirements: string[]`, la ligne d'instance porte `requirement` = texte joint (colonne inchangée, lecture seule ; l'import n'y lit rien) |
| `main/services/export/campaign.xlsx.ts`, `campaign.docx.ts` | `entryRequirementIds(run, entry.requirements)` dans la colonne / le titre d'instance |
| `renderer/lib/useEntryRequirements.ts` (nouveau) | `useQuery(['campaign-entry-requirements', repoPath, campaignId, workspaceDir])` → `api.campaigns.entryRequirements` |
| `renderer/routes/campaign.$campaignId.tsx` | appelle le hook ; le passe à la grille ; ajoute `requirements` aux entrées des payloads plan et rapport ; ajoute `workspaceDir` à `getPrintParams` |
| `renderer/components/campaign/CampaignEntriesGrid.tsx` | prop `entryRequirements` ; colonne `requirement` : `getText` = IDs joints par « , », `render` = liens d'élément, `title` = infobulle (Q5) ; `DEFAULTS` sans `carried` (Q7) |
| `renderer/routes/print.campaign-plan.tsx`, `print.campaign-report.tsx` | rechargent déjà campagne et tests par `campaignId` : ajoutent `workspaceDir` à `validateSearch` et la même requête que la grille |
| `renderer/i18n/locales/{fr,en}.json` | `campaignPage.requirementIterated`, `campaignPage.requirementsCovered` |

## Décisions techniques

- **Pourquoi un canal dédié, pas `preview-params`** : `previewForTests` résout des paramètres et ne charge
  les exigences que pour un test à `{req.…}` ; l'ajouter à tous les tests ferait lire exigences et
  liens à chaque ajout de test en campagne, où la valeur ne sert pas.
- **Pourquoi côté main** : le classeur d'exécution est construit en main (aucun renderer) ; une seule
  fonction évite que grille et exports divergent (critère 7).
- **Fraîcheur** : état courant à chaque appel (index des exigences et des liens). La requête de la page
  est relancée au retour sur la page (défaut de `useQuery`) ; pas d'invalidation croisée avec les
  mutations de liens.
- **Export de la grille (DataGrid)** : lit `getText`, donc suit sans autre changement.
- **Instance dont le test est introuvable** (copie figée seule) : liens cherchés par `testCaseId`,
  donc normalement vides ; l'exigence itérée reste affichée.
- **Alternative rejetée** : stocker les exigences couvertes dans l'entrée à l'ajout. Figerait un état
  qui change (liens ajoutés après coup), contredit Q2, et migrerait toutes les campagnes.
- **Colonne « Reportée depuis »** : on retire `'carried'` de `DEFAULTS`. `prefs.defaults` n'est lu que
  sans préférence enregistrée (`useGridPrefs`) : les profils réglés gardent leur liste.

## E2E existants à adapter

`gh389-campaigns.spec.ts` (l. 162) et `gh64-carry-over.spec.ts` (`carryLinks`, U4) lisent la colonne
`carried` de la grille : elles l'affichent d'abord par 👁 Colonnes.
