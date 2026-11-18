# GH400 — Scénarios de test

Fixtures : un repo avec **deux types de test** (A avec un `runField` « Banc », B avec
« Opérateur »).
- Une campagne C1 **clôturée** :
  - TA-1 exécuté, puis ré-exécuté (le premier run est remplacé) ;
  - une entrée de TA-2 exécutée puis retirée.
- Une campagne C2 **en cours**, avec une entrée de TA-1 en attente et TB-1 exécuté.
- Une exécution isolée de TA-2 (sans campagne).
- Une exécution **antérieure à GH73** (sans `campaignEntry`), désignée par une entrée de C1.

## Unitaires

| # | Cible | Attendu |
|---|-------|---------|
| U1 | `history(repo, { objectTypeRef: A })` | Lignes des seuls tests de type A, dont les runs remplacés (`superseded`), retirés (`removed`) et isolés, ainsi que l'entrée en attente de C2. Aucune ligne de TB-1. `runFieldDefs` ne contient que A. |
| U2 | Même appel avec le type B | La ligne TB-1 seulement. |
| U3 | Run sans `campaignEntry`, désigné par `entry.runId` dans C1 | La ligne porte la campagne C1 et son entrée (repli). |
| U4 | Run sans `campaignEntry`, désigné par aucune entrée | Ligne isolée, sans `campaignMissing`. |
| U5 | Cibles `{ testId }` / `{ requirementId }` | Résultats inchangés (non-régression GH197), plus le repli de U3. |
| U6 | `defaultExecutionColumns` pour `runExcel` / `runWord` | Listes du design §6, plus les `run:*` marqués `defaultVisible`. |
| U7 | Filtres contrôlés de `useColumnFilters` | `value` et `onChange` sont respectés ; sans eux, l'état reste local (non-régression). |
| U8 | `executions.docx` | Une section par exécution, avec en-tête, champs, notes et tableau des étapes quand `steps` est fourni. |

## E2E web (`e2e-web/gh400-executions.spec.ts`)

| # | Scénario | Attendu |
|---|----------|---------|
| E1 | Barre d'activité Campagnes, puis icône Exécutions | URL `/executions`. L'icône Exécutions est active, le sélecteur propose les types A et B, et il n'y a pas de liste de campagnes. Un clic sur l'icône Campagnes ramène à la liste des campagnes. |
| E2 | Type A | Grille avec colonnes Test, Exigence, Campagne, Entrée, Verdict, Date, Testeur, Version testée. Lignes : le run remplacé (badge « remplacé »), l'entrée retirée (badge « retirée »), l'exécution isolée (« isolée ») et l'entrée en attente. La colonne « Banc » est proposée dans le 👁, « Opérateur » ne l'est pas. |
| E3 | Passage au type B | Les lignes et les colonnes changent. Précédent ramène au type A. |
| E4 | Filtre de la colonne Campagne « C1 » (mot entier) | Seules les lignes de C1 restent, dont celles qui sont remplacées ou retirées. Le filtre « isolée » ne garde que l'exécution isolée. |
| E5 | Fiche C1, « Voir les exécutions » | Vue sur le type A, colonne Campagne filtrée sur C1. Effacer le filtre affiche toutes les lignes du type. |
| E6 | Même lien après avoir masqué la colonne Campagne dans le 👁 | La colonne est affichée et filtrée. La préférence n'est pas modifiée : la colonne reste décochée dans le 👁. |
| E7 | Navigation | L'entrée de C2 ouvre la page d'exécution ; une entrée de C1 ouvre la relecture ; les lignes remplacée, retirée et isolée n'ouvrent rien ; Ctrl+clic ouvre un nouvel onglet. |
| E8 | 👁 Tableau : masquer Date, puis recharger | Date reste masquée. La section Exécutions de l'éditeur de TA-1 garde ses propres colonnes. |
| E9 | Mode Document (sprint 2) | Une fiche par run filtré, sans fiche pour l'entrée en attente. Les champs de l'onglet Document sont affichés, avec les étapes. Le filtre du Tableau s'applique. |
| E10 | 👁 Document et Popup (sprint 2) | Les réglages sont persistés par type : A et B ont chacun le leur. « Réinitialiser » rend le défaut. |
| E11 | Export docx du Document (sprint 2) | Le fichier est produit, avec autant de sections que de fiches affichées. |
| E12 | Export xlsx du Tableau | Les colonnes affichées et les lignes filtrées sont exportées. |

## Manuel (non automatisé)

- Export PDF du Document (desktop) : mêmes fiches que l'écran, filtres compris.
- Repo de plusieurs centaines d'exécutions : temps d'ouverture de la vue (écart de version GH202).
- Composant local (nœud enfant) : le sélecteur propose ses types de test.
- Client desktop Electron : même parcours que E1 à E7.
