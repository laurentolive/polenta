# GH197 — Design : grille d'historique des exécutions

Spec : `specs/GH197.md`. Deux sprints. Travail direct sur `milestone-D`.

## 1. Types (`packages/types/src/execution-history.ts`)

```ts
export type ExecutionHistoryTarget = { testId: string } | { requirementId: string }
export interface ExecutionHistoryRow {
  key: string                       // id du run, ou `pending:<campagne>:<entrée>`
  kind: 'run' | 'pending'
  testCaseId: string; testTitle: string; objectTypeRef: string
  run?: TestRun                     // kind 'run'
  campaign?: { id: string; title: string; status: CampaignStatus; baselineRef?: string; fields: Record<string, unknown> }
  entry?: { entryId: string; requirementId?: string; paramValues?: Record<string, string>;
            resolvedParams?: Record<string, string>; testVersion?: number; carriedFrom?: unknown }
  removed?: boolean                 // entrée retirée (GH73)
  campaignMissing?: boolean         // run rattaché à une campagne introuvable
}
export interface ExecutionHistory {
  rows: ExecutionHistoryRow[]
  /** Champs d'exécution / d'étape par type de test présent (`objectTypeRef`). */
  runFieldDefs: Record<string, { runFields: SchemaField[]; stepFields: SchemaField[] }>
}
export function sortExecutionHistory(rows): ExecutionHistoryRow[]   // pending en tête, puis executedAt décroissant
```

## 2. Main

`execution-history.service.ts` (`ExecutionHistoryService.history(repoPath, target, workspaceDir)`) :
tests visés (le test, ou ceux reliés à l'exigence — tout lien test ↔ exigence, sens indifférent,
`matchCoverageLink`), runs (`TestsService.findRuns`, filtre T179 pour une exigence), campagnes
(`CampaignsService.list`) : entrée retrouvée dans `runs` ou `removedRuns` (`removed`), entrées
`pending` sans run des campagnes ouvertes, types (`TestsService.typeDefFor`). Canal
`executions:history` (desktop, web : `channel-policy`), `api.executions.history`.

## 3. Renderer

- `components/executions/ExecutionHistoryGrid.tsx` : colonnes déclarées dans `executionColumns.ts`
  (`{ key, group, label, render(row, defs) }` : groupes Exécution, Campagne, Entrée, Test, champs
  `run:<nom>` dynamiques) ; tri par en-tête ; chevron → sous-lignes d'étapes (verdict, commentaire,
  `stepFields`) ; ID cliquable (Q5) ; rendu des valeurs partagé avec `RunFieldValues` (#196).
- Colonnes : bouton ⚙️ → `ExecutionColumnsPanel` (cases par groupe, Réinitialiser) ; préférence
  `fieldVisibility[<type>].executions` (`FieldVisibilityPref.executions`) ; défaut : verdict, date,
  testeur, campagne, entrée + `runFields` `defaultVisible`.
  > Divergence assumée avec la spec globale (« un onglet du ⚙️ ») : le panneau ⚙️ des vues
  > (`FieldConfigModal`) est construit autour des onglets Tableau / Document et des champs d'objet ;
  > un panneau dédié, même gabarit, est plus simple et reste réutilisable par la vue Conformité.
- `components/executions/ExecutionsSection.tsx` : section repliable « Exécutions (N) » (chargement à
  l'ouverture) ; insérée dans `EditView` (test, exigence) entre Liens et Historique, et dans
  `test.$testId` / `req.$reqId`.

## 4. Sprints

1. Types, service, canal, tests unitaires ; grille, colonnes, panneau, section (EditView + pages).
2. e2e, revue de code, mises à jour SPEC.
