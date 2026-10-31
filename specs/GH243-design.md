# GH243 — Design : retrait du changeset, réouverture uniforme

## 1. Décision structurante : « conservé » = historique git

La spec §3 garde le moteur d'analyse, le calcul des tests à exécuter, la trace et le backlog, « non
montés ». Ces modules prennent tous le type `Change` en entrée (`computeChangeAnalysis`,
`computeTestsToRun(change, …)`, `trace(repo, change)`, `ChangeCampaignsSection({ change })`) : les
garder compilés obligerait à garder `Change`, ses DTO et le vocabulaire changeset, sans appelant.

**Retenu** : ils sont **retirés du code** et réintroduits, adaptés à la version, par #201 / #245
depuis le commit de référence **`4e06052`** (dernier état complet du changeset). Seul ce qui reste
**vivant** est gardé : verrou de l'approuvé (`approved-lock.util`, `assertContentEditable`), diff
par élément (`sync:diff-element`, `/diff`), composants d'analyse génériques (`impact/ImpactTrees`).
`specs/GH243.md` §3 est mis à jour en ce sens.

Alternative rejetée : garder `Change` renommé en type neutre — refonte de modules sans appelant,
dont la forme dépendra de l'objet version (#201) pas encore spécifié en détail.

## 2. Règle de version unique (spec §1)

- `approved-lock.util.ts` : nouvelle fonction `nextVersion(typeDef, existing, toStatus)` = `version + 1`
  si `existing.status` est `isApproval` et `toStatus !== existing.status`, sinon `version`.
- `RequirementsService.openDraft` / `transition`, `TestsService.openDraft` / `update({ status })` :
  appellent `nextVersion` (plus d'incrément inconditionnel dans `openDraft`).
- Paramètre `changesetId` retiré de `openDraft`, `transition`, `create`, `update` (types, IPC,
  api-client) ; crochet `tracker` et `track()` retirés des deux services.
- `statusModificationKind` et `ModificationKind` retirés.

## 3. Fichiers

### Supprimés

- `packages/types/src/change.ts` (export retiré de `index.ts`)
- main : `changes.service.ts`, `change-tracking.service.ts`, `change-analysis.util.ts`,
  `change-tests.util.ts`, `export/impact-analysis.xlsx.ts` (export d'une analyse de changeset) et
  leurs tests (`changes.gh198`, `changes-backlog.gh199`, `change-analysis.gh199`,
  `change-tracking.gh200`, `mcp-tracking.gh200`, `change-campaigns.gh207`)
- MCP : `tools/changes.tools.ts`
- renderer : `components/changes/*`, `sidebar/ChangesPanel.tsx`, `contexts/ApprovalGateContext.tsx`,
  `hooks/useBacklog.ts`, `lib/changesetPrefs.ts`, routes `changeset.$changeId`, `changeset.new`,
  `changesets`, `changesets_.backlog`, `print.impact-analysis`
- e2e : `gh198-changes`, `gh199-backlog`, `gh199-change-analysis`, `gh200-assign`, `gh200-trace`,
  `gh207-campaigns`

### Déplacés / renommés

- `changesets_.local.tsx` → `local-impact.tsx` (`/local-impact`) ; `changesets_.revalidation.tsx` →
  `revalidation.tsx` (`/revalidation`) — contenu inchangé.
- Boutons : en-tête de `VersionPanel` (Modifications locales, Impact à vérifier) ; en-tête du
  panneau Exigences (Constellation). `AppLayout.routePanel` : `/local-impact`, `/revalidation` →
  `version` ; `/constellation` → `requirements`.

### Modifiés

| Zone | Fichiers | Changement |
|---|---|---|
| Types | `schema.ts` | `ObjectCategory` sans `changeset` ; `preferences.changeTracking` retiré |
| | `campaign.ts`, `graph.ts`, `execution-history.ts`, `suivi-templates.ts`, `export.ts`, `app.ts` (si besoin) | `changeset`, `baselineRef` retirés ; `GraphChangeset`, `GraphObjectCategory` `changeset` retirés |
| Schéma | `schema.service` (lecture) | types de catégorie `changeset` **filtrés** à la lecture (ignorés, disparaissent à la prochaine sauvegarde) ; `changeTracking` idem |
| | `schema-refs.util`, `schema-delete.service`, `type-rename.util` | catégorie `changeset`, dossier `changesets` retirés |
| Services | `requirements.service`, `tests.service`, `approved-lock.util` | §2 |
| | `campaigns.service`, `parameters.service` | `changeset`, `baselineRef` retirés : paramètres et instances lus à l'état courant ; champs présents dans un fichier ignorés à la lecture, non réécrits |
| | `execution-history.service`, `export/campaign-execution.xlsx`, `export/template/*` | colonne / donnée baseline retirée |
| | `graph.service`, `suivi.service`, `history.service` | collection `changesets`, `baselineRef`, kind `changeset` retirés ; manifeste +1 |
| IPC | `ipc/index.ts`, `channels`, `web-server/channel-policy.ts`, `container.ts`, `mcp-server/container.ts`, `api-client` | canaux `changesets:*`, `changeTracking`, `changesetId` retirés |
| MCP | `bulk-import.tools`, `update.tools`, `read.tools` | `changesetId`, `unassigned`, `baselineRef` de campagne, kind `changeset` retirés |
| Renderer | `SystemView`, `SystemViewContext`, `SearchEditPane`, `req.$reqId`, `req.new`, `test.$testId`, `test.new` | appels directs sans porte |
| | `WordView` | bouton « Rouvrir en brouillon » retiré (`onReopenDraft`) |
| | `AppLayout`, `ActivityBar`, `TabsContext`, `__root` (provider) | panneau `changesets` retiré |
| | `campaign.new`, `campaign.$campaignId`, `CampaignListView`, `CampaignCarryPanel`, `TestPickerModal`, `useParamPreview`, `executionColumns`, `ExecutionHistoryGrid` | baseline / changeset retirés |
| | `preferences.tsx`, `objectTypeEditor`, `StructureTab`, `SchemaDeleteConfirmModal`, `HistorySection`, `useProjectSchema`, `useLiveFileSync` | catégorie / préférence changeset retirées |
| | i18n `fr.json`, `en.json` | clés mortes retirées |
| Ressources | `dashboard-lib/polenta.d.ts` | régénéré |
| Scripts | `scripts/check-gh34.ts`, `check-gh36.ts`, `build-export-templates.ts` | `baselineRef` retiré |

## 4. Sprints

1. **Main, types, MCP, graphe** : §2, retraits côté main / MCP / types / graphe, `baselineRef` et
   `changeset` de la campagne, schéma filtré. Typecheck main + tests unitaires verts.
2. **Renderer, e2e, SPEC** : retraits et déplacements renderer, campagne, i18n ; e2e supprimés et
   nouveaux ; mises à jour SPEC (sprint final).
