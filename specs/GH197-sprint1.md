# GH197 — Sprint 1 : historique des exécutions (données, grille, sections)

## Fichiers modifiés

- `packages/types/src/execution-history.ts` : `ExecutionHistoryTarget`, `ExecutionHistoryRow`,
  `ExecutionHistory`, `sortExecutionHistory` ; `api-client` : `executions.history`,
  `FieldVisibilityPref.executions`.
- Main : **`execution-history.service.ts`** (runs du test ou des tests reliés à l'exigence, règle
  T179, campagne et entrée de chaque run — entrée retirée, campagne introuvable —, entrées en attente
  des campagnes ouvertes, champs d'exécution par type) ; canal `executions:history` (desktop, web).
- Renderer : **`components/executions/`** — `executionColumns.ts` (colonnes par groupe, défaut,
  tri), `ExecutionHistoryGrid.tsx` (grille, tri, étapes dépliables, panneau de colonnes, préférence
  `executions`, ouverture Q5), `ExecutionsSection.tsx` (section repliable, chargement à l'ouverture) ;
  insérée dans `EditView` et les pages `test.$testId` / `req.$reqId` ; `RunFieldValue` exporté
  (#196) ; i18n `executionHistory`.
- Tests : `execution-history.gh197.test.ts` (2) ; e2e `gh197-execution-history.spec.ts`.

## Divergence

Panneau de colonnes dédié (même gabarit que ⚙️) plutôt qu'un onglet de `FieldConfigModal`,
construit autour des vues Tableau / Document et des champs d'objet (design §3).

## Revue de code et sprint 2 (finalisation)

Corrigé : grille rafraîchie sur changement de `tests/`, `test-runs/`, `links/`, `campaigns/`
(`useLiveFileSync`) ; run remplacé par un nouvel essai : campagne et `entryId` gardés, données d'entrée
et ouverture non reprises (`superseded`) ; projet transmis (vue Édition, pages de détail :
`workspaceDir` pour le type d'un test de composant, `projectId` pour la navigation) ; erreur de lecture
des campagnes remontée ; tri numérique ; ordre des colonnes conservé à l'ajout ; en-têtes non triables
(notes, équipement, paramètres, report) ; statuts « ouverts » partagés (`isOpenCampaignStatus`) ;
lectures en parallèle. Reporté : exigence couverte par un test d'un autre repo du workspace (portée
du repo ouvert, documentée).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| SPEC-SYSTEM-VIEW §Vue Édition | section « Exécutions », grille, colonnes, préférence, ouverture, limite |
| SPEC-TESTS §3.2 | renvoi vers l'historique des exécutions |

## Comment tester manuellement

`specs/GH197-tests.md` scénarios 9–10 : ID d'une ligne (campagne ouverte → exécution, clôturée →
consultation) ; préférence de colonnes retrouvée, Réinitialiser.
