# GH243 — Sprint 1 (unique) : retrait du changeset, réouverture uniforme

## Divergences avec le design

- **Un seul sprint** au lieu de deux : main et renderer partagent un seul `tsconfig` (typecheck
  commun) ; les retraits côté types cassaient les deux à la fois.
- **Entrées du panneau Version** : « Impact à vérifier (N) » et « Modifications locales (N) » sont des
  entrées sous l'en-tête, affichées quand elles ont un contenu (comme dans l'ancien panneau
  Changesets), plutôt que des icônes d'en-tête : comportement inchangé (§4 de la spec).
- **Statut éditable sur un élément verrouillé en vue Word** : le sélecteur de statut restait masqué
  sur un élément approuvé (seul le bouton « Rouvrir » permettait d'en sortir) ; il est maintenant
  affiché, c'est le chemin de réouverture.
- **Retour de revue** : `versionBump` n'incrémente pas entre deux statuts `isApproval` ; les fichiers
  `changesets/` restants comptent dans l'allocation des IDs (`id-counter.util`), pour qu'un nouveau
  type reprenant leur préfixe ne réémette pas un ID.
- Gardés sans appelant, pour #202 / #245 : option de tag de `ParametersService.previewForTests`,
  paramètres `instances` / `addTests` des pages campagne.

## Fichiers modifiés

- **Supprimés** : `packages/types/src/change.ts` ; `changes.service`, `change-tracking.service`,
  `change-analysis.util`, `change-tests.util`, `export/impact-analysis.xlsx` et leurs tests ;
  `mcp-server/tools/changes.tools` ; `renderer/components/changes/*`, `sidebar/ChangesPanel`,
  `contexts/ApprovalGateContext`, `hooks/useBacklog`, `lib/changesetPrefs`, routes `changeset*`,
  `changesets*`, `print.impact-analysis` ; e2e `gh198-*`, `gh199-*`, `gh200-*`, `gh207-*` ; gabarit
  `Analyse des impacts.xlsx`.
- **Déplacés** : `changesets_.local` → `local-impact.tsx`, `changesets_.revalidation` →
  `revalidation.tsx` ; entrées dans `VersionPanel` ; bouton Constellation dans `SystemPanel`
  (catégorie exigence) ; `AppLayout.deducePanel`, `TabsContext`, `ActivityBar`, `Sidebar`.
- **Règle de version** : `approved-lock.util.versionBump` ; `requirements.service` (`openDraft` =
  alias de `transition`), `tests.service` (`openDraft` = alias de `update({ status })`).
- **Schéma** : `schema.service.dropRemovedChangesets` (type `changeset` et `changeTracking` ignorés à la
  lecture) ; `ObjectCategory`, `schema-refs`, `schema-delete`, `type-rename`, éditeur de schéma,
  préférences.
- **Campagne** : `changeset` et `baselineRef` retirés (types, service — retirés à la lecture d'un
  ancien fichier —, formulaire, page, liste, report, prévisualisation des paramètres, historique
  d'exécution, exports xlsx / modèles, Suivi, graphe) ; gabarits livrés régénérés (Cahier et Rapport
  de campagne, Plan de campagne), « Référence des balises ».
- **IPC / web / api-client / MCP** : canaux `changesets:*`, `changesetId`, `unassigned`, `kind:
  changeset` retirés ; `AGENTS.md` v8.
- **Graphe** : `GraphChangeset`, `GraphCampaign.changeset` / `baselineRef` retirés ; `polenta.d.ts`
  régénéré (manifeste v10).
- **i18n** : clés `changes.*`, préférences, baseline de campagne, `reopenDraft` retirées ;
  `impactAnalysisPage.revalidation.noFlagged`.
- `id-counter.util` : fichiers `changesets/` pris en compte dans l'allocation.

## Tests

- Unitaires `version-rule.gh243.test.ts` : U1, U2, U2bis, U3–U6, U11, U13 ; `campaigns.service.carry`
  S8 (ancien `baselineRef` / `changeset` ignorés et retirés à l'écriture) ; suites adaptées
  (`dashboard-lib`, `suivi-corpus`, `schema-delete`, `activityBarLayout`). Monorepo : typecheck et
  tests verts.
- E2E `e2e-web/gh243-changeset-removal.spec.ts` : E1 (vue document : pas de « Rouvrir », statut →
  brouillon, version + 1), E4 (plus de Changesets, Modifications locales dans Version, Constellation
  dans Exigences), E5 (plus de baseline à la création de campagne). E2E adaptés : `gh145`, `gh183`,
  `gh56`, `gh83`, `t173-revalidation`, `t173-verif`.

## Mises à jour SPEC

- `SPEC-REQ-requirements.md` §5.3 (réouverture par le statut), §10 (changesets retirés ; verrou et
  règle de version).
- `SPEC-TESTS.md` §4.1–4.2 (`baselineRef`, `changeset` retirés ; paramètres à l'état courant).
- `SPEC-TRACEABILITY.md` §4.1 (moteur conservé, écrans déplacés, export retiré ; ex-§4.2–4.6 retirés).
- `SPEC-TEMPLATES.md` §1–4 (préférence `changeTracking` retirée).
- `SPEC-MCP-SERVER.md` §4.7 (outils changeset retirés).
- `SPEC-DASHBOARDS.md` §1–§3 (retraits du contrat, manifeste v10).
- `SPEC-FORKS-BRANCHES-BASELINES.md` §5 (paramètres de campagne à l'état courant).
- `SPEC-ELECTRON-DESKTOP.md` §2–3 (formulaire de campagne, `campaigns:preview-params`, kinds de gabarit).
- `SPEC-INDEX.md` : MAJ → GH243 pour ces sections.

## Comment tester manuellement

1. Exigence approuvée, vue document : pas de bouton « Rouvrir » ; changer le statut en brouillon →
   version + 1, contenu éditable ; aucune question de changeset. Idem vue tableau (colonne Statut),
   page de l'exigence, page d'un test.
2. Barre d'activité : plus d'entrée Changesets. Panneau Version : « Impact à vérifier (N) » et
   « Modifications locales (N) » quand il y a lieu. Panneau Exigences : icône Constellation.
3. Nouvelle campagne : plus de champ Baseline ; une campagne existante avec baseline s'ouvre
   normalement.
4. Repo avec un ancien type de changeset dans `schema.yaml` : absent de l'éditeur de schéma, aucune
   erreur ; enregistrer le schéma le retire du fichier.
