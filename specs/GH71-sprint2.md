# GH71 — Sprint 2 : renderer

Design : `specs/GH71-design.md` §4, §6, §7 (sprint 2).

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `renderer/components/dashboard/widgets/progressPresentation.ts` (nouveau) | `progressPresenter(schema, t)` : ordre canonique, libellés (schéma, i18n), couleurs `--chart-progress-*` |
| `renderer/index.css` | Jetons `--chart-progress-prep-1..4`, `-ready`, `-incomplete`, `-blocked`, `-fail`, `-pass` (clair + sombre) |
| `renderer/components/dashboard/widgets/BarWidget.tsx` | Préréglage `campaignProgress` : ordre, libellés, couleurs ; clé brute conservée pour le drill-down |
| `renderer/components/dashboard/widgets/WidgetRenderer.tsx`, `DashboardGrid.tsx`, `WidgetConfigModal.tsx` | Prop `repoPath` jusqu'au widget barre ; select « Présentation des séries » (barre avec série) |
| `renderer/lib/campaignProgress.ts` (nouveau) | `runProgress`, `progressPills` |
| `renderer/lib/campaignApproval.ts` (+ test) | Délègue à `progressSubject` ; paramètre `campaignOpen` (correction GH68 : campagne clôturée jugée sur la copie) |
| `renderer/routes/campaign.$campaignId.tsx` | Paramètre d'URL `progress` (prioritaire sur `status`) ; pastilles par étape ; filtre ; libellé « Filtre : … » |
| `renderer/routes/campaign.$campaignId_.execute.$testId.tsx` | **Correctif GH68** : version affichée figée pour la session ; bandeau « la copie a changé » + bouton pour afficher la nouvelle version |
| `renderer/lib/rowNavigation.ts` | `RowTarget.progress` → `search.progress` |
| `renderer/i18n/locales/{fr,en}.json` | `campaignProgress.ready`, `dashboard.widgetModal.preset*`, `campaignPage.executeTestChanged*` |
| `renderer/lib/campaignProgress.test.ts` (nouveau) | C1, C4, W1, W4, teintes |
| `e2e-web/gh71-progress.spec.ts` (nouveau) | W1, W2, N1, C1–C3 |
| `e2e-web/gh65-navigation.spec.ts` | 2.1 (légende « Échoué »), 2.4/2.7 (`progress=ready`), 2.9 (pastilles par étape) |
| `specs/SPEC-DASHBOARDS.md`, `specs/SPEC-TESTS.md`, `specs/SPEC-INDEX.md`, `specs/GH71.md` | Voir « Mises à jour SPEC » |

## Divergences par rapport au design / à la spec

- **Pastilles à 0** : la spec §15 supposait qu'elles étaient affichées « comme aujourd'hui » ; le code
  GH65 les masque. Comportement conservé (étape sans entrée → pas de pastille, sauf l'étape
  filtrée) ; spec §15 et CA9 corrigés.
- **Correctif GH68 (saisie perdue)** ajouté à ce sprint, comme proposé en fin de sprint 1. La
  version figée côté page n'empêche pas que le résultat soit enregistré alors que la copie
  enregistrée est plus récente : le bandeau le signale, sans bloquer.
- **Bandeau / liste** : les lignes d'entrées gardent le statut d'entrée (« En attente ») ; seules les
  pastilles passent aux étapes (spec §15–18, rien de plus demandé).

## Corrections après revue de code (branche GH71)

La revue lancée sur le sprint 1 portait par erreur sur le dossier principal (autre ticket en cours) ;
relancée sur la branche `GH71` à ce sprint, elle a relevé et fait corriger :
- **Seed GH65 interrompu puis repris** : le nouveau widget était créé sur l'ancienne requête et la
  mise à niveau marquée faite → widget vide. Le marqueur `done` ne pose plus la marque ; la mise à
  niveau (appelée juste après) traite aussi ce cas (D10).
- **Mise à niveau non reprenable** (requête modifiée puis échec sur un widget) : une requête déjà au
  nouveau SQL est reconnue, seuls les widgets à l'ancien mapping sont mis à jour (D9).
- **`progressRank`** : position dans le type du test → plus petite position parmi les types du schéma
  (même ordre que le renderer ; une étape a un seul rang).
- **Titre de la requête mise à niveau** : actualisé s'il est encore celui d'origine.
- **Ouverture d'une ligne** : reprend la colonne `progress` de la ligne si elle existe (même valeur
  que le widget, sans relecture des repos).
- Page campagne : étape calculée une fois par entrée et par rendu ; type `IsApproved` dédoublonné.
Non retenu : mutualiser `statusLabels` (présentation) et `testStatusLabel` (règles différentes :
libellé d'une étape commune à plusieurs types vs libellé du type d'un test).
Limite connue : pour un test d'un composant dans un autre repo, la page campagne juge le statut sur
la copie (elle ne lit que les tests de son repo) ; la vue Suivi, elle, lit le test live — les deux
peuvent différer pour une instance resynchronisable.

## Mises à jour SPEC

- `SPEC-DASHBOARDS.md` §2.1 (colonnes `progress`, `progressRank`, `testStatus` ; `progressRank` hors
  builder), §2.2 (`resolveRowTarget` → `progress`), §4.1b (nouveau : préréglage), §5.1b (widget sur
  `progress`, mise à niveau des seeds GH65).
- `SPEC-TESTS.md` §4.2 (GH68 : campagne ouverte ; version figée pendant l'exécution), §4.3 (étapes,
  pastilles, filtre `progress`, compatibilité `status`).
- `SPEC-INDEX.md` : SPEC-TESTS §4+ et §4.1–4.2, SPEC-DASHBOARDS §2, §4, §5 → MAJ GH71.
- `specs/GH71.md` : §15 et CA9 (pastilles à 0).

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 30 fichiers / 317 tests desktop + merge-core OK.
- `pnpm test:e2e:web` (après les corrections de revue) : 43 réussis, 13 ignorés (gh57-consent,
  s3-oidc, s4-deployed : exigent `POLENTA_E2E_SSH`), 0 échec — dont les 2 nouveaux GH71, GH65
  navigation mis à jour, GH64 et GH68 inchangés. Captures : `e2e-web/.results/gh71-*.png`.
- `/code-review` sur la branche `GH71` : corrections listées ci-dessus.
- Scénarios non automatisés : W3 (éditeur), W5 (impression), C5 (couvert en unitaire), D-scénarios
  et Q/T (unitaires), R2 (KPI inchangés : requêtes non modifiées).

## Test manuel

1. Créer deux tests (brouillon, en revue) et une campagne avec eux + 3 tests approuvés ; saisir un
   PASS et un FAIL.
2. Page campagne : pastilles « 1 Brouillon · 1 En revue · 1 Prêt à exécuter · 1 Échoué · 1 Passé » ;
   clic sur « En revue » → liste filtrée, URL `progress=prep:review` ; re-clic → retrait.
3. Vue Suivi → dashboard Campagnes : la barre de la campagne empile ces étapes dans cet ordre, gris /
   gris clair / bleu / rouge / vert ; clic sur « En revue » → détail ; clic sur la ligne → campagne
   filtrée sur « En revue ».
4. Éditer le widget : « Présentation des séries » → Standard / Avancement de campagne.
5. Dashboard Campagnes créé avant cette version (requête non modifiée) : bascule automatiquement.
6. Exécution d'un test brouillon pendant qu'un autre utilisateur exporte le classeur Excel : la
   saisie est conservée, un bandeau propose d'afficher la nouvelle version.
