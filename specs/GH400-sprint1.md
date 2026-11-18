# GH400 — Sprint 1 (unique) : vue Exécutions

Spec : `specs/GH400.md` · Design : `specs/GH400-design.md` · Scénarios : `specs/GH400-tests.md`.

## Divergences par rapport au design

- **Un seul sprint au lieu de deux.** Le Document, ses exports et les onglets Document / Popup du 👁
  ont été écrits avec le Tableau : la vue les référence dès le départ, et les découper n'aurait
  rien simplifié.
- **Filtre prérempli par le lien de la campagne** : regex `^<ID> —`, sensible à la casse, au lieu
  d'un mot entier. Le mot entier laissait aussi passer une campagne dont le titre cite l'ID (revue
  de code).
- **Payload docx** : il porte les libellés traduits (`labels`), sans libellé en dur côté main.
- **Retour par la barre d'activité** : l'URL complète de la dernière page du panneau Campagnes est
  rejouée. Le seul paramètre `repo` relançait le choix par défaut du type.
- **`DataGrid`** :
  - réordonner les colonnes n'écrit jamais une colonne seulement forcée (`forceVisible`) ;
  - en mode contrôlé, `useColumnFilters` chaîne deux mises à jour du même tick.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/execution-history.ts` | cible `{ objectTypeRef }` |
| `packages/types/src/export.ts` | kind `executions`, `ExecutionsExportPayload` |
| `packages/api-client/src/types.ts` | `runExcel`, `colWidthsRunExcel`, `freezeColCountRunExcel`, `runWord`, `runPopup` |
| `main/services/execution-history.service.ts` | cible de type, rattachement par `runId` des runs antérieurs à GH73 |
| `main/services/export.service.ts`, `main/services/export/executions.docx.ts` | générateur docx |
| `main/host/print-renderer.ts` | route `/print/executions` |
| `renderer/lib/executionsRoute.ts` | chemin et paramètres de la route |
| `renderer/routes/executions.tsx`, `print.executions.tsx` (+ `routeTree.gen.ts`) | nouvelles routes |
| `renderer/components/executions/executionColumnDefs.tsx` | colonnes extraites de la grille (grille, Document, impression, docx) |
| `renderer/components/executions/ExecutionsView.tsx`, `ExecutionDocument.tsx`, `ExecutionConfigPanel.tsx`, `ExecutionsExportButton.tsx` | la vue |
| `renderer/components/executions/ExecutionHistoryGrid.tsx`, `executionColumns.ts`, `ExecutionsSection.tsx` | props de vue, défauts `runExcel` / `runWord`, `ExecutionSteps` partagé |
| `renderer/components/grid/DataGrid.tsx`, `useColumnFilters.ts` | `columnFilters` contrôlés, `forceVisible` |
| `renderer/contexts/SystemViewContext.tsx` | catégorie test, navigation et sélection mémorisée propres à `/executions` |
| `renderer/components/layout/AppLayout.tsx` | panneau Campagnes pour `/executions`, dernière page rejouée |
| `renderer/components/sidebar/SystemPanel.tsx` | icônes Campagnes / Exécutions, corps réduit sur `/executions` |
| `renderer/routes/campaign.$campaignId.tsx` | lien « Voir les exécutions » |
| `renderer/i18n/locales/{fr,en}.json` | `executionsView.*`, `sidebar.campaignsNav.*` |

## Tests

- **Unitaires** :
  - `execution-history.gh400.test.ts` (U1–U5 et type inconnu) ;
  - `executions.docx.gh400.test.ts` (U8).
  - U6 (défauts) et U7 (filtres contrôlés) ne sont couverts qu'à travers les e2e.
- **E2E** : `e2e-web/gh400-executions.spec.ts`, 7 tests. Correspondance avec les scénarios :

  | Test | Scénarios |
  |---|---|
  | GH400-1 | E1 |
  | GH400-2 | E2, E3 |
  | GH400-3 | E4 |
  | GH400-4 | E5, E6 |
  | GH400-5 | E7 (sans le Ctrl+clic) |
  | GH400-6 | E8 |
  | GH400-7 | E9, E10 |

## Vérifications

| Vérification | Résultat |
|---|---|
| `pnpm typecheck` | OK |
| `pnpm lint` | aucune tâche définie dans le repo (pas de configuration ESLint) |
| `pnpm test` (lancé avant les corrections de la revue) | 199 fichiers, 2069 tests passés |
| Unitaires ciblés, relancés après les corrections | 47 passés |
| E2E, avant les corrections : GH400, GH197, GH389-executions, GH389-campaigns, GH229-element-links, GH228-navigation, GH144 | 22 passés |
| E2E, après les corrections : GH400, GH389-campaigns, GH389-executions, GH197 | 17 passés |
| Suite e2e complète (niveau 3) | non lancée : elle attend le « Validé » |

## Mises à jour SPEC

- `SPEC-SYSTEM-VIEW.md` :
  - nouvelle section **§ Vue Exécutions (GH400)** ;
  - § Grilles communes : préférence `runExcel`, ligne du tableau des grilles ;
  - § Historique des exécutions : rattachement par `runId`.
- `SPEC-TESTS.md` §3 : renvoi vers la vue.
- `SPEC-INDEX.md` :
  - MAJ → GH400 pour SPEC-TESTS §4+ et SPEC-SYSTEM-VIEW § Grilles communes ;
  - nouvelle ligne § Vue Exécutions.

## Tester à la main

1. Barre d'activité **Campagnes**, puis l'icône **Exécutions** (horloge) en tête du panneau. Choisir
   un type de test dans le sélecteur.
2. Vérifier les exécutions remplacées (« essai remplacé »), les entrées retirées et les exécutions
   isolées.
3. Filtrer la colonne Campagne.
4. Ouvrir une campagne, cliquer **Voir les exécutions** : la colonne Campagne est déjà filtrée.
5. Passer en **Document** (icône page). Régler les champs dans le 👁, onglet Document. Exporter en
   Word, puis en PDF.
6. Aller sur Exigences, puis revenir par l'icône Campagnes : la vue Exécutions est rouverte sur le
   même type.
7. Non automatisé :
   - export PDF (desktop) ;
   - temps d'ouverture sur un repo de plusieurs centaines d'exécutions (écart de version GH202
     calculé pour chaque run) ;
   - types de test d'un composant local ;
   - client desktop Electron.
