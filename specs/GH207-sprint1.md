# GH207 — Sprint 1 (unique) : campagnes issues d'un changeset

## Fichiers modifiés

- `packages/types` : `ChangeTestToRun`, `LinkedCampaign`, `ChangeTestsToRun` ; `TestCampaign.changeset`,
  `CreateCampaignDto.changeset` ; `GraphCampaign.changeset`.
- `main/services/change-tests.util.ts` (nouveau) : `computeTestsToRun`, `linkedCampaigns`.
- `main/services/changes.service.ts` : `testsToRun`, `assertOpen`, `linkCampaign`.
- `main/services/campaigns.service.ts` : crochet `ChangesetLinker` (contrôle avant l'ID, lien après
  écriture) ; champ `changeset`.
- Conteneurs main / MCP, IPC `changesets:tests-to-run`, politique web, api-client.
- Graphe : `GraphCampaign.changeset` ; `polenta.d.ts`, manifeste v9 ; fixtures de test du graphe.
- MCP : `get_changeset` → `testsToRun` ; `bulk_import_campaigns` → `changeset`.
- Renderer : `ChangeCampaignsSection` (section Campagnes du changeset), `/campaign/new`
  (`changeset`, `instances`), page d'une campagne (`addTests`, `instances` → sélecteur pré-coché ;
  lien « Changeset » dans l'en-tête), `lib/reqInstances.decodeInstances` ; i18n fr / en.

## Comportement

Conforme à `specs/GH207.md`. Les conditions de clôture sont reportées dans #206 (Q3).

## Divergences avec le design

- « Tests à ajouter » est jugé au niveau du **test** (présent dans une campagne liée ouverte, quelle
  que soit l'instance) ; une instance d'exigence manquante pour un test déjà présent n'est pas
  signalée. Simplification assumée ; le sélecteur de la campagne montre les instances manquantes.

## Mises à jour SPEC

- `SPEC-REQ-requirements.md §10` : campagnes d'un changeset.
- `SPEC-TESTS.md §4.1` : champ `changeset`, paramètres `/campaign/new` et page d'une campagne.
- `SPEC-MCP-SERVER.md §4` : `testsToRun`, `bulk_import_campaigns.changeset`.
- `SPEC-DASHBOARDS.md §1–§3` : `GraphCampaign.changeset`, manifeste v9.
- `SPEC-INDEX.md` : MAJ → GH207 pour ces sections.

## Tests

- Unitaires `change-campaigns.gh207.test.ts` : T1–T6.
- E2E `e2e-web/gh207-campaigns.spec.ts` : C1/C2, C4, C5.

## Comment tester manuellement

1. Changeset avec une exigence à modifier couverte par un test ; section Campagnes : « 1 test à
   exécuter » → « Créer une campagne » → formulaire pré-rempli → campagne liée des deux côtés.
2. Passer un test impacté à « impact à tester » : « 1 test à ajouter » → « Ajouter à CAMP-… » ouvre
   le sélecteur pré-coché ; valider.
3. Test itérant couvrant deux exigences dont une seule dans le changeset : seule son instance cochée.
4. Clore la campagne : seul « Créer une campagne » reste.

## Retour de validation du 2026-10-31 (corrections)

Voir `specs/GH207.md` §10bis : tests proposés = tous les identifiés sauf « pas d'impact réel » ; Campagnes sous l'analyse ; impactés déclarés seuls dans la liste ; libellé du lien par nœud dans les arbres (`ImpactNode.parentIsTarget`) ; éléments changés réduits au diff. Tests adaptés : GH199-1 (statut saisi sur le nœud), GH199-B6 (élément déclaré), GH200-A8 (trace lue par l'API), T2.
