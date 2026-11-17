# GH389 — Design : grilles uniformes

Spec : `specs/GH389.md`. Code de référence : `51c6896`. Abréviations : `r/` = `apps/desktop/src/renderer`,
EV = `r/components/system/ExcelView.tsx`.

## 1. Principe

Un dossier **`r/components/grid/`** regroupe les briques. Deux consommateurs :

- **`DataGrid`** — grille **plate** générique (lignes = objets quelconques, colonnes décrites par
  `GridColumn`), qui assemble toutes les briques. Utilisée par la Validation et toutes les grilles du
  spec §4.
- **`ExcelView`** — garde son arbre, ses dossiers, son glisser de lignes, ses éditeurs par type de
  champ, son copier / coller de nœuds ; elle **consomme les hooks** (filtres, layout de colonnes,
  clavier, hauteur des lignes) à la place de son code en dur, sans changer de comportement visible
  (sauf clavier et export, spec §3).

Rejeté : faire de `DataGrid` une base d'`ExcelView` (l'arbre traverse tout le rendu, risque GH170 sur
2 800 lignes sans tests unitaires) ; écrire `DataGrid` à côté sans toucher `ExcelView` (deux
comportements qui divergeraient de nouveau — c'est le problème du ticket).

## 2. Briques (`r/components/grid/`)

| Fichier | Contenu | Origine |
|---------|---------|---------|
| `gridTypes.ts` | `GridColumn<R>` : `key`, `label`, `group?`, `locked?` (toujours affichée), `defaultVisible?`, `getText(row): string` (texte affiché : filtre, export), `render?(row, ctx)`, `editor?: { kind: 'enum'; options: {value,label}[] } \| { kind: 'text' }`, `isEditable?(row)`, `filterable?` (défaut vrai), `minWidth?`, `exportText?(row)` (défaut `getText`), `hyperlink?(row)` | nouveau |
| `columnFilters.ts` (pur) + `useColumnFilters.ts` + `ColumnFilterPopover.tsx` | État `{ [key]: { text, options } }`, `matchesColumnFilters(row, filters, getText)`, purge quand une colonne disparaît, `resetKey`. Popover : texte + `FilterOptionsToggle`, Échap `stopImmediatePropagation` (GH33) | EV:218-229, 1431-1562, 2030-2048, 2690-2744 |
| `columnLayout.ts` (pur) + `useColumnLayout.ts` | Largeurs auto (`maxLen*7+24`, plafond `innerWidth/4`), glisser de poignée (largeur locale pendant le glisser, écriture au relâchement), offsets de gel mémoïsés, glisser d'en-tête (ordre) | EV:1348-1509, 1656-1701, 1798-1842 |
| `GridHeaderCell.tsx`, `ColumnFreezeMenu.tsx` | En-tête : libellé, icône de filtre (`data-column-filter-*` conservés), poignée, `draggable` ; menu de gel au clic droit | EV:957-1006, 2366-2412 |
| `RowClamp.tsx` | `RowMaxLinesContext`, `useCellClamp`, `ClampedContent`, `RichtextClamp` | EV:159-185, 701-724 (déplacés, EV les importe) |
| `gridKeyboard.ts` (pur) + `useGridKeyboard.ts` | `nextCell(rows, cols, cell, key, opts) → { cell, extendSelection?, action? }` : flèches, Tab / Maj+Tab avec retour à la ligne, Maj+↑/↓, Entrée / F2 (`action: 'edit' \| 'activate'`), Espace (`'toggle'`), ←/→ sur ligne de groupe (`'collapse' \| 'expand'`). Le hook branche `excelCellStore` (cellule active), le défilement (`scrollIntoView` avec `scroll-margin` de l'en-tête collé et des colonnes figées) et ignore les frappes venant d'un champ éditable | nouveau ; store existant `excelCellStore.ts` |
| `rowSelection.ts` (pur) + `useRowSelection.ts` | Clic / Maj / Ctrl / Maj+flèche, ancre, « clic dans une sélection multiple ne réduit pas » (T149) ; mode cases (tri-état) | fusion `lib/gridSelection.ts`, EV `handleRowSelect` (2157-2186), `useRangeSelection` (`components/versions/useVersions.ts:108`) |
| `useGridPrefs.ts` | Lecture / écriture partielle de `fieldVisibility[prefKey]` (cache `['pref-visibility', repoPath, user, prefKey]`, mise à jour optimiste). Clés : `<view>` (colonnes visibles, ordonnées), `colWidths<View>`, `freezeColCount<View>` | copié 4 fois : `SystemView`, `TestPickerGrid:99-117`, `ValidationGrid:53-86`, `ExecutionHistoryGrid:80-88` |
| `ColumnChecklist.tsx` + `ColumnPickerPanel.tsx` | Liste à cocher par groupes, colonnes verrouillées, `toggleVisibleField` (GH235), Réinitialiser. `ColumnPickerPanel` = la coque de `FieldConfigModal` (même modale, même `layer`) autour de `ColumnChecklist`. `FieldConfigModal` utilise `ColumnChecklist` pour ses listes | `FieldConfigModal.tsx`, `ValidationGrid` `ColumnsMenu` (supprimé) |
| `GridToolbar.tsx` | Ordre spec §1.1 : slot gauche, 👁, `SavedViewsMenu` (optionnel), `RowMaxHeightButton`, `ExportButton` (kind `table`), compteur | nouveau |
| `DataGrid.tsx` | Voir §3 | nouveau |
| `exportTable.ts` | `buildTablePayload(title, columns, rows, widths, freezeCount)` → `TableExportPayload` | nouveau |
| `useHeaderCollapsed.ts` | `localStorage` `polenta.headerCollapsed.<page>` (`validation`, `version`), try/catch | nouveau |

`viewScrollMemory`, `useRenderWhenVisibleAtRest`, `SavedViewsMenu`, `ElementLink`, `CoverageBadge`,
`ExportButton` restent où ils sont et sont importés.

### Préférences

- Grille rattachée à un type : `prefKey` = `objectTypeRef` du type, clé de vue propre à la grille
  (Validation : `excel` — inchangé, pas de collision : le type validation n'est jamais affiché par la vue
  système ; exécutions : `executions`).
- Grille sans type : `prefKey` = **`grid::<gridId>`** dans le `.pref` du repo affiché, vue `columns`
  (`gridId` : `version-changes`, `version-tests`, `version-analysis`, `backlog`, `campaign-entries`,
  `campaign-carry`, `campaign-list`, `query-result`, `drilldown`, `parameters`, `compliance`). Le handler
  `pref:set-field-visibility` accepte déjà toute clé (`pref.handlers.ts:21-32`) : aucun changement main.
  `FieldVisibilityPref` (`packages/api-client/src/types.ts:384`) reçoit les clés optionnelles
  `columns`, `colWidthsColumns`, `freezeColCountColumns`, `colWidthsExecutions`, `freezeColCountExecutions`.
- Grilles sans repo unique (Paramètres : une grille par repo → `.pref` de chaque repo ; Conformité,
  Suivi : repo racine).

## 3. `DataGrid`

```ts
interface DataGridProps<R> {
  gridId: string                         // préfixe des data-testid : `<gridId>-grid`, `<gridId>-row-<id>`… (§12)
  title: string                          // feuille et fichier d'export
  rows: R[]; getRowId(row: R): string
  columns: GridColumn<R>[]               // toutes les colonnes disponibles
  prefs: { repoPath: string; prefKey: string; view: string; defaults: string[] } | { local: true; defaults: string[] }
  savedViews?: { typeKey: string; workspaceDir?: string }   // Validation seulement
  toolbarStart?: ReactNode               // filtres de l'écran
  rowFilter?: (row: R) => boolean        // filtre de l'écran, combiné en ET
  selection?: { mode: 'rows' | 'checkbox'; selected: ReadonlySet<string>; onChange(next: Set<string>): void }
  onCellEdit?: (rowIds: string[], key: string, value: string) => Promise<{ failed: { id: string; message: string }[] }>
  onActivate?: (row: R) => void          // Entrée sur cellule non éditable / double-clic de ligne
  renderExpanded?: (row: R) => ReactNode; expanded?: ReadonlySet<string>; onToggleExpanded?(id: string): void
  rowClassName?: (row: R) => string | undefined
  compact?: boolean                      // widget : pas de barre d'outils, ni filtres ni largeurs
  noColumnPicker?: boolean; noExport?: boolean; noReorder?: boolean
  frozenLeading?: ReactNode              // matrice : pas utilisé, gel par freezeCount
  scrollMemoryKey?: string | null
}
```

- Rendu `<table>` en `table-layout: fixed`, `border-separate` (gel), en-tête collé. Cellule = `memo`,
  props primitives ; actions par un proxy stable (modèle EV:2195-2252) ; cellule active via
  `useIsCellSelected` — un déplacement ne re-rend que les deux cellules concernées.
- Conventions DOM de la Vue Excel (lues par `viewScrollMemory`, `refocusGrid`, e2e) : `data-node-id`
  = rowId, `data-selected`, `data-view-scroll`, `data-excel-grid` sur le conteneur, `scroll-mt-8`.
- **Édition** : `editor.kind = 'enum'` → `<select>` ouvert dans la cellule ; `'text'` →
  `ExcelTextEditor` mono-ligne. Ouverture : double-clic, F2, Entrée. Validation : Entrée, Tab (passe à
  la suivante), clic extérieur ; Échap annule. **Édition en masse** : si la ligne éditée est dans la
  sélection, `onCellEdit` reçoit tous les ids sélectionnés (lignes où `isEditable` est vrai).
- Rendu progressif : 50 lignes puis le reste en `startTransition` (modèle EV:1455-1470) ; pas de
  virtualisation.
- Export : `GridToolbar` construit le payload depuis les lignes **filtrées** et les colonnes visibles.

## 4. Export

- `packages/types/src/export.ts` : `ExportKind` += `'table'`, `TableExportPayload { sheetName,
  columns: { key, label, width? }[], rows: Record<string, string>[], hyperlinks?: Record<string,
  Record<string, string>>, freezeColCount? }`.
- `apps/desktop/src/main/services/exports/table.xlsx.ts` (dossier des générateurs existants à
  confirmer) inscrit dans `GENERATORS` (`table:xlsx`), ExcelJS : en-tête gras, `views: [{ state:
  'frozen', xSplit, ySplit: 1 }]`, largeurs `px/7`, nom de feuille tronqué à 31 caractères et nettoyé
  (`[]:*?/\`).
- Canal web : `export:save` déjà exposé ; vérifier la liste blanche des kinds si elle existe.
- **Vue Excel (spec §3)** : `ExcelView` signale ses lignes affichées (`onDisplayedChange`, déjà présent
  en mode sélection, étendu au mode normal, ids d'objets dans l'ordre, dossiers compris pour l'export
  avec titres) et expose `getCellDisplayText` ; `SystemView` (`:361-383`) construit le payload
  `requirements` / `tests` avec ces lignes et ces textes ; `exportColumns.ts` ne retire plus les colonnes
  `link*` et `coverageStatus` (texte = ID affichés / libellé). Gabarits GH34 : le payload garde
  `outline` ; les lignes filtrées s'appliquent aussi. Vérifier `exportColumns.test.ts` et l'import en
  masse (`bulk-import-validation.util.ts`) : une colonne inconnue d'un classeur réimporté doit être
  ignorée — sinon, exclure les colonnes ajoutées du classeur standard et le noter en divergence.

## 5. Liens d'élément : versions et validations

`r/contexts/ElementNavContext.tsx` : à côté des campagnes (`:98-126`), deux familles de requêtes par
repo — `api.versions.list(repoPath)` (catégorie `version`) et `api.validations.versions(repoPath)`
(validations, catégorie `validation`) — mêmes clés de cache que les écrans existants pour profiter des
invalidations. `follow` (`:177`) : `/version/$versionId` et `/validation/$validationId` avec
`{ projectId, repoPath }`. `ElementPreviewPopup` : en-tête seul pour ces catégories (comme campagne).

## 6. Vue Validation

- `validation.$validationId.tsx` : en-tête dans un bloc repliable (`useHeaderCollapsed('validation')`),
  bouton `ChevronsUp/ChevronsDown` en tête de `actions` du `ViewHeader`, `aria-expanded`,
  `data-testid="validation-header-toggle"`. Replié : badge de statut et « reste à décider » passés dans
  `subtitle`. Le conteneur devient `flex-col` : en-tête `shrink-0`, grille `flex-1 min-h-0` qui défile
  seule.
- `ValidationGrid.tsx` réécrite sur `DataGrid` : colonnes `GridColumn<ValidationRow>` (groupes
  Décision / Exigence, ID + titre `locked`), `editor` enum pour `decision` et text pour `comment`
  (`isEditable` : validation modifiable, et pour le commentaire décision ≠ en attente), `toolbarStart` =
  le `<select>` de filtre existant, `renderExpanded` = `EntryFieldsForm` + `ValidationRuns`,
  `savedViews` avec `typeKey = objectTypeRef`. `data-testid` existants conservés autant que possible
  (`validation-grid`, `validation-row-*`, `validation-decision-*`…) pour `e2e-desktop/gh204-validation`.
- **Lot** : `onCellEdit(ids, 'decision', v)` → `api.validations.decide` ligne par ligne, erreurs
  agrégées ; boutons Confirmer / Rejeter la sélection dans `toolbarStart`. Proposition d'issue en lot :
  `IssueProposalOrigin` `kind: 'decision'` devient `{ kind: 'decision'; refs: { ref, requirementId }[];
  decisionLabel }` ; création : `origin.decisions = refs`, un lien `issue-impact` par exigence ; « lier à
  une existante » : `addDecision` par ref. Les autres appelants passent un tableau d'un élément.
- `ValidationRuns` : `ElementLink` pour les tests, `VERDICT_CLASS` partagé (déjà).

## 7. Vue Excel

- Remplacer le code en dur par `useColumnFilters`, `useColumnLayout`, `GridHeaderCell`, `RowClamp`,
  `useRowSelection` (mode normal et mode sélection), `useGridPrefs` dans `SystemView` /
  `TestPickerGrid`. Comportement identique : les e2e de la grille (liste spec critère 13) sont le filet.
- Ajouter `useGridKeyboard` à `handleKeyDown` (EV:1994-2026) : la liste ordonnée des lignes affichées
  (éléments **et** dossiers) et des colonnes visibles alimente `nextCell`. Ligne de dossier : une seule
  cellule (`name`), ←/→ replient / déplient. Entrée = F2 sauf boîte de suppression ouverte. Mode
  sélection : Espace bascule la ligne active.
- Mesure de performance avant / après (T176 : changement de ligne, double-clic → éditeur, affichage
  initial, sur handstickProduct) consignée dans le résumé de sprint.

## 8. Autres grilles

Chacune remplace son `<table>` / sa liste par `DataGrid` avec des `GridColumn` ; les ID d'autres
éléments passent par `ElementLink`. Points particuliers :

- `ExecutionHistoryGrid` : retirer `isSortable` et l'état de tri ; `ColumnPickerPanel` avec ses groupes ;
  étapes en `renderExpanded`.
- `VersionChangesTable`, `versions_.backlog`, `VersionTestsSection` : `selection.mode = 'checkbox'` ;
  `useRangeSelection` supprimé une fois les trois migrées.
- `VersionAnalysisSection` (forme tableau) : `editor` enum (statut) et text (commentaire) quand non figée.
- `version.$versionId.tsx` : en-tête repliable (`useHeaderCollapsed('version')`).
- Entrées de campagne (`campaign.$campaignId.tsx:486-670`) : `DataGrid` ; actions en dernière colonne ;
  paramètres en `renderExpanded` ; pastilles = `rowFilter`.
- `CampaignListView` : `DataGrid` (colonnes ID, statut, titre, tests, compteurs) ; textes en dur → i18n.
- `ResultTable` : colonnes du script (`noColumnPicker`), `compact` dans `WidgetRenderer`.
- `DrillDownModal` : `noColumnPicker`, `noExport`.
- `ParametersView` : une `DataGrid` par repo, `onActivate` = dialogue.
- `ComplianceMatrix` : `noColumnPicker`, `noReorder`, lignes de groupe par rôle (`rowClassName` + ligne
  de groupe rendue comme ligne pleine, non sélectionnable), `freezeCount` par défaut 1.

## 9. i18n

Clés `grid.*` communes (filtre, figer, libérer, colonnes, exporter, compteur, confirmer / rejeter la
sélection, erreurs de lot, replier / déplier l'en-tête) en fr et en ; reprise des clés
`system.excelView.*` existantes par alias plutôt que doublons quand le texte est identique.

## 10. Découpage en sprints

| Sprint | Périmètre | Vérification spécifique |
|--------|-----------|-------------------------|
| 1 | Briques §2 (fichiers purs testés unitairement), `DataGrid`, export `table`, liens versions / validations (§5), vue Validation complète (§6) | unitaires des modules purs ; `e2e-desktop/gh204-validation` + nouvelle spec `gh389-validation` (desktop) |
| 2 | Vue Excel (§7) : hooks, clavier, export filtré | tous les e2e-web de grille listés (spec critère 13) + `gh389-excel-keyboard`, `gh389-excel-export` ; mesures T176 |
| 3 | Exécutions (`ExecutionHistoryGrid`, `ValidationRuns`) | `gh197*` existants, `gh389-executions` |
| 4 | Versions et Backlog, en-tête repliable version | `gh252-versions`, `gh389-versions` |
| 5 | Campagnes (entrées, report, liste) | e2e campagnes existants (`gh33`, `gh176`, `gh73`…), `gh389-campaigns` |
| 6 | Suivi, Paramètres, Conformité ; mises à jour SPEC ; `SPEC-INDEX` | e2e `gh70`, `gh125`, `t171*`, `gh389-misc` |

Chaque sprint laisse l'application cohérente (une grille migrée est entièrement migrée).

## 11. Risques

- **Performance (GH170 / T176)** : cellules `memo`, props primitives, proxy d'actions stable, store de
  cellule externe ; mémoïser `rows` / `filteredRows` / largeurs auto (non mémoïsés aujourd'hui dans EV).
  `gh246-render-loop` doit rester vert.
- **Échap en modale** (sélecteur de tests, drill-down) : ordre popover de filtre → éditeur → sélection →
  modale, `stopImmediatePropagation` conservé.
- **Conventions DOM** : `data-*` listés au §3, `data-testid` des e2e existants conservés.
- **Clés de `.pref` partagées** : écriture partielle uniquement ; jamais un objet complet.

## 12. Écarts constatés au sprint 1

Décidés en cours d'implémentation (`specs/GH389-sprint1.md`), sans effet sur la spec :

- **`data-testid`** : préfixe `<gridId>` partout pour garder ceux de la Validation — table
  `<gridId>-grid`, ligne `<gridId>-row-<id>`, cellule `<gridId>-<colonne>-<id>` (éditeur
  `…-editor`), en-tête `<gridId>-header-<colonne>`, chevron `<gridId>-toggle-<id>`, case
  `<gridId>-check-<id>`, 👁 `<gridId>-columns`, cases du panneau `<gridId>-column-<clé>`, compteur
  `<gridId>-count`, barre `<gridId>-toolbar`. Cellule active : `data-active` (en plus de `data-col`).
- **`GridColumn`** : `editValue(row)` (valeur éditée : nom d'une décision, texte brut) et
  `elementId(row)` (Entrée suit le lien) ajoutés ; `defaultVisible` et `minWidth` retirés (défauts =
  `prefs.defaults`, largeur minimale commune).
- **`DataGrid`** : `migrateColumns` (liste enregistrée avant la grille commune : la Validation
  ajoutait ID, titre et mentions hors liste), `exportRepoPath`, `layer` (panneau 👁 au-dessus d'une
  modale) ajoutés ; `frozenLeading` non implémenté (inutile, §3). Pas de `resetKey` : la page remonte
  `ValidationGrid` par validation (`key`), ce qui remet filtres, dépli et sélection à zéro.
- **Sélection (mode lignes)** : réduite aux lignes affichées quand un filtre change — une édition en
  lot ou Confirmer / Rejeter la sélection n'atteint jamais une ligne masquée. Mode cases inchangé
  (GH33 : la sélection survit aux filtres).
- **Clavier** : une frappe venue d'un bouton ou d'un lien qui a le focus (Confirmer d'une ligne, lien
  d'élément, ligne dépliée) garde son geste ; le chevron et la case ne prennent pas le focus au clic.
  Éditeur enum : la liste du système est ouverte (`showPicker`, une fois au montage) ; liste ouverte,
  le premier Échap la referme, le second ferme l'éditeur (comme la Vue Excel).
- **`ExcelTextEditor`** : prop `onTab` (Tab / Maj+Tab : valide puis cellule suivante).
- **Préférences** : Réinitialiser (panneau 👁) ne remet que les colonnes (et oublie la vue active),
  pas les largeurs ni le gel, comme le ⚙️ de la Vue Excel. Une clé inconnue est ignorée à
  l'affichage ; une liste réécrite après un changement de l'utilisateur ne contient que des clés
  connues. Clés `columns`, `colWidthsColumns`… de `FieldVisibilityPref` : ajoutées avec la première
  grille sans type (sprint 4) ; `colWidthsExecutions`… au sprint 3.
- **Briques reportées au sprint 2** (Vue Excel) : `FieldConfigModal` sur `ColumnChecklist` ;
  déplacement de `lib/gridSelection.ts` (`rowSelection.ts` réexporte ses fonctions de cases) ;
  `SystemView` sur `writeExcelRowMaxLines`.
- **Liens versions / validations** : `PageLink` (`components/element/`) — lien d'élément quand l'index
  connaît l'ID **dans le repo attendu**, sinon bouton vers la page (composant non indexé, même ID de
  version dans deux repos : l'index est par ID nu, premier repo gagnant).
- **Défilement** : `useGridScrollKey(gridId)` (onglet + page + grille, GH300) pour les grilles de page.
- **En-tête de la Validation** : bloc d'informations borné (`max-h-[45vh]`, défilement propre) ;
  replié, `validation-state-short` et `validation-remaining-short` dans le sous-titre.

## 13. Écarts constatés au sprint 2 (Vue Excel)

Décidés en cours d'implémentation (`specs/GH389-sprint2.md`), sans effet sur la spec :

- **`useGridPrefs` dans `SystemView`** : seulement pour l'écriture partielle du `.pref` du type (`patch`,
  mise à jour optimiste puis relecture) et pour les largeurs / colonnes figées de la vue Tableau
  (`widths`, `freezeCount`). Les colonnes des vues Tableau / Document / Édition / Popup, les titres
  de dossiers, les dossiers repliés et les vues enregistrées restent dérivés par `SystemView` (GH170 :
  application pendant le rendu, `keepPreviousData` au changement de type). `useGridPrefs` reçoit
  `raw` (entrée brute) et `patch` ; ses fonctions sont stables. `TestPickerGrid` : `useGridPrefs`
  (vue `picker`), qui remplace sa requête et son écriture ; le prop `username` disparaît.
- **`FieldConfigModal`** : utilise `ColumnCheckItem` (case commune, extraite de `ColumnChecklist`) et
  non `ColumnChecklist` entière — ses listes imbriquées (colonnes calculées éclatées, étapes, liens)
  ne sont pas de simples groupes et partagent un seul conteneur défilant.
- **`GridHeaderCell`** : prop `clip` (défaut vrai) ; la Vue Excel garde des en-têtes non coupés (icône
  de filtre d'une colonne étroite atteignable, comme avant). En-têtes de la Vue Excel :
  `data-testid="excel-header-<colonne>"` ajouté.
- **Cellules de la Vue Excel** : `data-col` et `data-active` sur chaque cellule (cellule active,
  défilement de `ensureCellVisible`) ; couverture et reflets deviennent sélectionnables (`PlainCell`).
- **Clavier** : branché par `useGridKeyboard.move` dans le `onKeyDown` existant (raccourcis existants
  traités d'abord). Entrée = F2 (`requestEdit` ; une cellule de lien ouvre son popover, comme F2) ;
  dossier sans renommage : Entrée replie / déplie. Mode sélection : flèches et Espace seulement
  (Tab, Entrée et Échap gardent leur rôle dans la modale). Tab dans un éditeur texte (nom, champ,
  dossier) : `onTab` de `ExcelTextEditor`.
- **Sélection** : `useRowSelection` ; une ancre absente de la sélection (sélection posée par l'arbre
  ou un lien suivi, Ctrl+clic qui l'a retirée) est remplacée, pour Maj, par la dernière ligne
  sélectionnée — comportement d'avant GH389 conservé, ajouté au hook (aussi pour `DataGrid`).
- **Texte affiché** : les champs enum à libellés (GH136) sont filtrés et exportés sur leur libellé,
  comme le statut (spec §1.2 « texte affiché »).
- **Export Tableau** : `ExcelView` expose `exportRef` (`ExcelExportSource` : colonnes, lignes
  affichées, texte, libellé) ; `buildDisplayedExportRows` (`lib/exportColumns.ts`) construit le
  payload `requirements` / `tests` xlsx. Titres de dossier exportés comme lignes (section + titre dans
  la première autre colonne). Gabarit GH34 : `buildExportOutline(…, keep)` restreint l'arbre aux
  éléments affichés, colonnes du gabarit inchangées. En vue Document, l'export xlsx garde l'ancien
  calcul (aucune Vue Excel montée). Import en masse (`bulk-import-validation.util.ts`) : il lit des
  entrées JSON (outil MCP), pas le classeur — aucun chemin ne réimporte le classeur standard, rien à
  exclure.
- **`lib/gridSelection.ts`** supprimé : tout son contenu (cases, `pruneTree`) est dans
  `components/grid/rowSelection.ts`.
