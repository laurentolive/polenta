# GH389 — Sprint 6 : suivi, paramètres, conformité ; mises à jour SPEC

Spec : `specs/GH389.md` (§1, §4 lignes « Résultat de requête », « Détail d'un widget »,
« Paramètres », « Matrice de conformité » ; critère C11). Design : `specs/GH389-design.md` §8, §10
ligne 6 ; écarts au §17. Base : `c014810` (sprint 5). Abréviation : `r/` = `apps/desktop/src/renderer`.
Dernier sprint du ticket.

## Fichiers

### Modifiés
- `r/components/dashboard/ResultTable.tsx` : `DataGrid` (page Requête, widget compact) ; tableau
  statique pour l'impression (`print`).
- `r/components/dashboard/DrillDownModal.tsx` : table → `DataGrid` en modale.
- `r/components/parameters/ParametersView.tsx` : une `DataGrid` par repo (`RepoParametersGrid`).
- `r/components/ComplianceMatrix.tsx` : matrice → `DataGrid` (lignes de groupe, gel par défaut) ;
  prop `repoPath`. `r/routes/compliance.tsx` : passe `repoPath`, remonte par interface.
- `r/routes/query.tsx`, `r/routes/print.query-result.tsx` : props de `ResultTable`.
- `r/components/grid/DataGrid.tsx` (`groupOf`, `renderGroup`, `noFreeze`, compact sans largeurs ni
  gel), `GridHeaderCell.tsx` (`resizable`), `useGridPrefs.ts` (`defaultFreeze`),
  `useGridScrollKey.ts` (hors onglets).
- `r/i18n/locales/{fr,en}.json` : `dashboardPage.resultTable.gridTitle`.
- e2e adaptés (double-clic pour ouvrir une ligne du détail) : `gh65-navigation`, `gh71-progress`,
  `gh69-matrix`.
- `specs/GH389-design.md` §17 ; SPEC (ci-dessous) ; `specs/SPEC-INDEX.md`.

### Nouveaux
- `apps/desktop/e2e-web/gh389-misc.spec.ts` (E11 : requête, widget + détail, paramètres, conformité).

## Comportement

- **Page Requête** : résultat en grille — filtre par colonne, largeurs, gel, ordre, ↕▯, Exporter,
  compteur ; pas de 👁 (colonnes du script) ; ID d'élément en liens.
- **Widget table** (tableau de bord) : grille compacte — liens et clavier ; double-clic / Entrée sur
  une ligne qui porte des `_ids` ouvre le détail.
- **Détail d'un widget** : filtre par colonne, largeurs, clavier, liens ; double-clic / Entrée ouvre
  l'objet ; Échap : popover, cellule, sélection, puis la modale.
- **Paramètres** : une grille par repo (recherche de l'écran combinée), double-clic / Entrée ouvre le
  dialogue d'édition.
- **Conformité** : filtre par colonne, largeurs, première colonne figée par défaut, clavier, ID
  d'exigence en lien, export ; lignes de groupe par rôle ; ni 👁 ni réordonnancement.

## Divergences au design

Détail : `specs/GH389-design.md` §17. En bref : simple clic = sélection dans le widget table, le
détail et Paramètres (ouverture au double-clic / Entrée) ; impression du résultat de requête en
tableau statique ; lignes de groupe non exportées ; gel par défaut de la matrice dans les préférences.

## Mises à jour SPEC

| Fichier | Section | Résumé |
|---------|---------|--------|
| `SPEC-SYSTEM-VIEW.md` | § Grilles communes (nouvelle) | Contrat commun (barre d'outils, colonnes, 👁, préférences, clavier, sélection, liens, export, défilement, aucun tri) et tableau des grilles |
| `SPEC-SYSTEM-VIEW.md` | § Filtre par colonne | Étendu à toutes les grilles, texte affiché |
| `SPEC-SYSTEM-VIEW.md` | § Arbre — Navigation clavier | Renvoi au clavier des grilles |
| `SPEC-SYSTEM-VIEW.md` | § Vue Excel | Clavier, export Tableau de ce qui est affiché (liens et Vérification inclus) |
| `SPEC-SYSTEM-VIEW.md` | § Vue Édition — Historique des exécutions | Panneau 👁 commun, tri retiré, contrat de grille |
| `SPEC-SYSTEM-VIEW.md` | § Persistance de l'état | Clés `grid::<gridId>`, `colWidthsExecutions`…, `polenta.headerCollapsed.*` |
| `SPEC-ELECTRON-DESKTOP.md` | §19.2 (panneau Validation) | En-tête repliable, grille commune, lot |
| `SPEC-ELECTRON-DESKTOP.md` | §19.15 (Export) | Kind `table` |
| `SPEC-REQ-requirements.md` | §3.2f (vue Paramètres) | Grille par repo, double-clic → dialogue |
| `SPEC-REQ-requirements.md` | §11.3 (page d'une version) | En-tête repliable ; changements, tests, analyse, backlog en grilles |
| `SPEC-REQ-requirements.md` | §13 | Écran de validation (grille, lot, proposition d'issue en lot) |
| `SPEC-TESTS.md` | §4.3 | Entrées de campagne, report, liste des campagnes en grilles |
| `SPEC-DASHBOARDS.md` | §6 | Widget table compact, détail en grille, page Requête, impression |
| `SPEC-TEMPLATES.md` | §3a | Matrice de conformité en grille |
| `specs/GH204.md` | §7 | Renvoi au contrat GH389 |
| `SPEC-INDEX.md` | — | MAJ → GH389 des lignes ci-dessus ; ligne § Grilles communes ajoutée |

`specs/GH244` (proposition d'issue en lot) : décrit dans SPEC-REQ §13 (le comportement GH244 d'une
décision seule ne change pas).

## Tester à la main

1. Requête : exécuter, filtrer une colonne, figer la première, élargir, recharger : réglages retrouvés.
2. Tableau de bord : widget table, flèches, double-clic sur une ligne → détail ; dans le détail,
   filtre puis Échap ×4.
3. Paramètres : rechercher, double-cliquer une ligne → dialogue ; 👁 masque Description.
4. Conformité : lignes de groupe, défilement horizontal avec la colonne Exigence figée, « Libérer »,
   exporter (classeur).
5. Impression d'un résultat de requête : tableau statique, sans barre d'outils.

## Vérifications

**Niveau 1**
- `tsc --noEmit -p tsconfig.json` (desktop) : 0 erreur.
- `pnpm lint` : n'exécute rien (#395).

**Revue** : relecture manuelle du diff (le skill `code-review` lancé au sprint 5 depuis la session
revoit `main` du dossier principal, pas la branche). Corrigés : `useGridScrollKey` levait hors
`TabsProvider` (impression d'un résultat de requête, widgets imprimés) ; double-clic sur le bouton
d'ouverture d'une entrée du détail (ouverture en double) ; clé de la table des cellules de la matrice.

**Niveau 2**
- `pnpm test` (racine) : desktop 197 fichiers / 2 062 tests OK ; admin-service 124 OK + 3 ignorés ;
  merge-core 83 OK.
- e2e-web `gh389-misc` : 1er passage, échec sur Échap dans le détail (une étape de plus : la sélection
  de ligne, design §11) — test corrigé ; puis 4/4 OK.
- e2e-web voisins (un passage, build du sprint) : `gh389-` (tous), `gh246-render-loop`, `gh65-*`,
  `gh69-matrix`, `gh71-progress`, `gh74-*`, `gh93-params`, `gh125-widget-params`, `gh70-*`,
  `gh22-compliance-matrix`, `gh123-sidebar-collapse`, `gh67-scope`, `gh64-carry-over` → 94 tests :
  **91 OK**, 1 échec `gh65-navigation` 2.7 (clic simple sur une ligne du détail, non adapté au
  premier jet), 2 non lancés (suite en série) ; corrigé (double-clic), `gh65-navigation` relancé :
  **5/5 OK**.
- Après la correction de `useGridScrollKey`, build refait : `gh389-misc`, `gh74-editing`,
  `gh69-matrix`, `gh71-progress` → **16/16 OK**.

**Non lancé** : suite e2e complète (niveau 3, au merge) ; e2e-desktop ; impression du résultat de
requête (`s4-print` exige l'instance déployée) — vérifiée au typecheck et à la lecture ; contrôles
manuels (thème sombre, classeur exporté de la matrice).

## Restes fragiles

- Simple clic → double-clic pour ouvrir une ligne du widget table, du détail et de Paramètres :
  changement de geste visible pour les utilisateurs (voir Questions du rapport).
- Lignes de groupe de la matrice non exportées (la colonne Rôles porte l'information).
- Page d'une version : grilles non remontées par version (chemin Précédent version → version non
  couvert, voir sprint 5).
