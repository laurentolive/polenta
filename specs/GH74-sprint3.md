# GH74 — Sprint 3 : expérience d'édition, seeds, bandeau

Périmètre (`specs/GH74-design.md` §9, sprint 3) : bibliothèque de départ copiée et bandeau des
mises à jour, seeds en modèles complets (étapes `entryStep`, « Avancement dans le temps »), page
campagne en statuts bruts et retrait du code GH71, finitions d'édition (confirmations, lecture seule).
Une partie du sprint 3 prévu avait été avancée au sprint 2 (mise à niveau des seeds SQL, éditeurs
Modèle / Code, vue Requêtes, impression et exports alimentés par les scripts) : voir
`specs/GH74-sprint2.md`.

## Fichiers

### Nouveaux

| Fichier | Rôle |
|---|---|
| `main/services/suivi-updates.service.ts` | `SuiviUpdatesService` : liste / application / « Ignorer » des propositions du bandeau (`library`, `seed-widget`, `template`) |
| `renderer/components/sidebar/SuiviUpdatesBanner.tsx` | Bandeau en tête du panneau Suivi : liste à cocher, Appliquer, Ignorer ; sans « Appliquer » sur branche en lecture seule |
| `main/services/suivi-updates.test.ts` | 12 tests : copie de la bibliothèque (B1–B3), bandeau (M1–M5), seed Campagnes (S1–S3, S2b) |
| `renderer/components/dashboard/vegaTheme.test.ts` | Couleurs de série portées par les lignes, ligne d'origine d'un datum Vega |
| `e2e-web/gh74-suivi.spec.ts` | T1 (aire empilée, drill-down par relance `polenta.drill`), B1/U1 (bibliothèque copiée, fichier proposé puis appliqué) |

### Supprimés

`packages/types/src/campaign-progress.ts`, `main/services/campaign-progress.test.ts`,
`renderer/lib/campaignProgress.ts` (+ test), `renderer/components/dashboard/widgets/progressPresentation.ts`.
L'équivalence de `entryStep` avec l'ancienne règle reste vérifiée par les références figées (L1, L1b).

### Modifiés (principaux)

| Fichier | Changement |
|---|---|
| `dashboard-library.service.ts` | `seedIfAbsent` (copie unique, notée au marqueur même si interrompue), `listLibraryUpdates`, `writeShipped` |
| `dashboard-seed.service.ts` | Bibliothèque copiée après le seed Status ; marqueur `.seeded.yaml` étendu (`library`, `queries`, `dashboardId`, `seededAt` seul juge du seed Status) ; « Avancement par campagne » sur `entryStep` ; nouveau widget « Avancement dans le temps » ; widgets proposés aux seeds existants (`proposedSeedWidgets`, `addProposedSeedWidget`) |
| `packages/types/src/suivi-templates.ts` | « Entrées de campagne » : option `withStep` (colonnes `step`, `stepLabel`, `stepRank`, `stepColor`, via `lib/campaign.js`) ; « Barres » : `seriesOrder`, `seriesColor` ; « Aire empilée » : symboles de légende opaques |
| `packages/types/src/dashboard.ts` | `SuiviUpdate`, `SuiviUpdatesList` |
| `ipc/index.ts`, `channel-policy.ts`, `api-client` | `suivi:updates-list`, `suivi:updates-apply`, `suivi:updates-ignore` |
| `routes/campaign.$campaignId.tsx`, `lib/campaignApproval.ts` | Pastilles et filtre par statut brut (`status`, comportement GH65) ; `progress` ignoré ; règle GH68 du test jugé (`approvalSubject`) gardée localement |
| `components/dashboard/vegaTheme.ts`, `VegaView.tsx` | Convention `usermeta.polenta.seriesColors` ; lignes injectées par `view.data` sur des copies, clic → ligne d'origine retrouvée par contenu |
| `DashboardGrid.tsx`, `routes/dashboard.tsx`, `ReorderableSidebarSection.tsx` | Dashboard en lecture seule : ni portée, ni ajout, ni modification, ni suppression, ni réordonnancement ; badge « SQL » / « Lecture seule » dans le panneau |
| `WidgetConfigModal.tsx`, `routes/query.tsx` | « Revenir au modèle » avec confirmation ; requête : modification détectée par comparaison au texte chargé |
| `script-sandbox.ts` | Module `lib/…` introuvable : message renvoyant au bandeau des mises à jour |
| `mcp-server/tools/suivi-script.tools.ts` | Contrat : conventions `usermeta.polenta` (`view`, `seriesColors`) |
| `hooks/useLiveFileSync.ts` | Bandeau rafraîchi sur `dashboards/`, `queries/` et le `.pref` |
| e2e `gh71-progress`, `gh65-navigation`, `gh65-campaigns` | Étapes en Vega (légende, segments par libellé), pastilles par statut brut, 6 widgets au seed |

## Comportement implémenté

- **Bibliothèque de départ** (§6.2) : au premier accès à Suivi sur une branche inscriptible, si
  `dashboards/lib/` est absent, copie des fichiers livrés (modification à publier), notés dans
  `dashboards/.seeded.yaml` (`library`). Un fichier supprimé ensuite n'est jamais recréé ni proposé.
  `dashboards/lib/` déjà présent (bibliothèque du projet) : rien n'est écrasé, les fichiers livrés
  absents sont proposés.
- **Bandeau** (§6.3) : « Mises à jour disponibles (N) », repliable, une ligne par proposition
  (fichier ou widget, version actuelle → nouvelle ou « nouveau », résumé, mention « à publier »),
  cases à cocher, « Appliquer », « Ignorer » (masque cette version pour l'utilisateur, `.pref`).
  Toutes les propositions sont vérifiées avant la première écriture (liste périmée : rien
  n'est appliqué). Branche en lecture seule : liste sans bouton, application refusée côté main.
- **Seed Campagnes** (§8) : « Avancement par campagne » = barres empilées sur l'étape
  (`entryStep`), étapes dans l'ordre canonique et couleurs GH71 (jetons `--chart-progress-*`) ;
  nouveau widget « Avancement dans le temps » (aire empilée des statuts d'entrée, jour par jour,
  campagnes en cours ; clic sur un point → entrées de ce jour et ce statut). Seeds existants : le
  widget est proposé dans le bandeau, ajouté sur « Appliquer » (rien de silencieux).
- **Propositions de version de modèle** : objets des seeds (Status, Campagnes de l'utilisateur)
  restés au code de leur modèle, quand le modèle a une version plus récente (aucune aujourd'hui :
  tous les modèles sont en v1).
- **Page campagne** (§11) : pastilles et filtre sur les statuts bruts d'entrée ; une URL portant
  `progress` est ignorée ; « Non approuvé » (GH68) conservé.
- **Lecture seule** : dashboard d'un format plus récent → bandeau, titre non modifiable, aucune
  action d'écriture (export et drill-down disponibles) ; badges dans le panneau latéral.

## Divergences par rapport au design

| Design | Implémenté | Raison |
|---|---|---|
| Couleurs d'une spec par jetons `var(--…)` uniquement dans la spec | + convention `usermeta.polenta.seriesColors` : échelle de couleur construite par l'hôte depuis les lignes | Les étapes de préparation viennent du schéma du projet : leurs valeurs ne sont pas connues à l'écriture de la spec. Vega-Lite ne sait pas associer une couleur portée par la donnée à une série sans décalage (vérifié : `range: { field }` trie les couleurs indépendamment du domaine ; un domaine explicite écarte les valeurs absentes) |
| Rendu : `view.data('rows', …)` | + copies des lignes et recherche de la ligne d'origine par contenu au clic | Vega analyse les dates en place et dérive des copies de tuples : le datum cliqué n'est plus la ligne du script ; la relance `polenta.drill` doit recevoir les colonnes d'origine (bug trouvé par l'e2e T1) |
| `campaign-progress.ts` retiré | `approvalSubject` (règle GH68 du test jugé) déplacée dans `renderer/lib/campaignApproval.ts` | La page campagne l'utilise encore pour « Non approuvé » |
| Seed de la bibliothèque si `dashboards/lib/` absent | + fichiers livrés absents d'une bibliothèque projet proposés comme « nouveaux » | Un projet doté de sa propre bibliothèque peut quand même obtenir `campaign.js` (requis par les widgets du seed Campagnes) |
| Marqueur `upgrades: ['gh74']` pour la réécriture des seeds | Reconnaissance par contenu à chaque `dashboards:list` (sprint 2), idempotente | Pas de marqueur nécessaire : une requête réécrite n'est plus en SQL |

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 558 tests desktop et 38 tests merge-core, tous verts.
- e2e web : **87 passés, 13 ignorés (antérieurs à GH74), 0 échec** — dont `gh74-suivi` (nouveau),
  `gh71-progress` W1/W2/N1 réactivés.
- `/code-review` : 10 constats ; 9 corrigés, 1 sans objet. Corrigés :
  - application partielle du bandeau ;
  - copie de la bibliothèque interrompue non notée ;
  - message d'import absent sans piste ;
  - faux « code modifié » dans la vue Requêtes ;
  - widget proposé perdu après un échec ;
  - bandeau non rafraîchi sur `queries/` ;
  - domaine de couleurs typé en chaîne ;
  - champ technique visible dans les infobulles ;
  - helper dupliqué.

  Sans objet : version du modèle « Aire empilée » inchangée, car aucun modèle GH74 n'a encore été livré.

## Reste pour le sprint 4

- Corpus de non-régression CI (démo, projet minimal, ×50), budgets de performance.
- e2e GH74 complémentaires (matrice partagée par deux widgets, thème clair / sombre, format plus
  récent, MCP).
- SPEC (§7 du design), `SPEC-INDEX.md`, tutoriel, AGENTS.md régénéré.
- Projet de démo (`demo-lave-linge`) : requêtes SQL utilisateur à réécrire (voir sprint 2).
