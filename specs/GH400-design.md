# GH400 — Design : vue « Exécutions »

Spec : `specs/GH400.md`. Chemins relatifs à `apps/desktop/src/` sauf mention.

## 1. Vue d'ensemble

```
Panneau Campagnes (SystemPanel)
  [icône Campagnes] [icône Exécutions]   ← nouveau, en tête
  ComboBox composant × type   (catégorie test sur /executions)

/executions?projectId&repo&node&type&view=excel|word&campaign=<ID>
  ExecutionsView
    ViewHeader : titre, Tableau / Document, 👁 (ExecutionConfigPanel), Export (Document)
    Tableau  → ExecutionHistoryGrid (prefView runExcel, filtres contrôlés)
    Document → ExecutionDocument (mêmes lignes filtrées, champs runWord)
  données : executions:history(repoPath, { objectTypeRef }, workspaceDir)
```

## 2. Lecture : `executions:history` avec une cible de type

- `packages/types/src/execution-history.ts` : la cible devient
  `ExecutionHistoryTarget = { testId } | { requirementId } | { objectTypeRef: string }`.
- `main/services/execution-history.service.ts` : `{ objectTypeRef }` sélectionne
  `allTests.filter(t => t.objectTypeRef === ref)`. C'est la même comparaison exacte que
  `useSystemObjects` (`<nœud>::<type>`). La suite du calcul ne change pas : runs par test, entrées
  en attente, écart GH202 avec cache partagé, `runFieldDefs`.
- **Exécutions antérieures à GH73** (sans `campaignEntry`) : le service construit une seule fois
  une table `runId → { campaignId, entryId }` à partir de `runs[]` et `removedRuns[]` de toutes les
  campagnes. `runRow` s'en sert comme repli quand `run.campaignEntry` est absent. Le repli vaut pour
  toutes les cibles : la section Exécutions de l'éditeur en profite aussi.
- Canal IPC, client API et politique web : aucun changement de signature. L'objet cible n'est pas
  soumis à la vérification des racines (`ROOT_ARGS [0, 2]`).
- `useLiveFileSync` invalide déjà le préfixe `execution-history` sur `campaigns/` et `test-runs/`.
  Seul le commentaire est à mettre à jour.

**Alternative rejetée** : un nouveau canal `executions:list`. Il dupliquerait l'assemblage des
lignes (statuts, entrées, écart de version), pour un seul paramètre de différence.

## 3. Route et contexte

- **Nouvelle route** `routes/executions.tsx`. `validateSearch` accepte `projectId`, `repo`, `node`,
  `type`, `view` (`excel` | `word`, défaut `excel`) et `campaign` (préremplissage du filtre).
- **`SystemViewContext`** :
  - `urlCategory` vaut `'test'` quand `pathname === '/executions'`.
  - `navigateWith` reste sur `/executions` quand on y est. Il garde `view` et retire `campaign` :
    changer de type est une nouvelle page, sans le filtre prérempli.
  - L'effet de choix par défaut (repo, nœud, type) s'applique aussi à `/executions`.
  - La dernière sélection est mémorisée sous une clé propre, `…:executions`. Choisir un type dans
    les Exécutions ne change pas la sélection mémorisée de l'onglet Tests. `lastSelectionKey` prend
    pour cela un « périmètre » (catégorie, ou `executions`).
- **`AppLayout.deducePanel`** : `/executions` donne le panneau `campaigns`. Comme pour Versions et
  Suivi, `AppLayout` retient la dernière route du panneau Campagnes : un clic sur l'icône Campagnes
  de la barre d'activité ramène à la page quittée, Campagnes ou Exécutions.

## 4. Panneau latéral (`components/sidebar/SystemPanel.tsx`)

- **En-tête** : sur la catégorie `campaign`, ou sur `/executions`, deux boutons `btn-icon` :
  - Campagnes (`ClipboardList`) → `/product?category=campaign&projectId` ;
  - Exécutions (`History`) → `/executions?projectId`.

  L'icône de la page affichée est active. `data-testid` : `campaigns-nav-campaigns` et
  `campaigns-nav-executions`.
- **Sur `/executions`**, le panneau montre l'en-tête, le `ComponentTypeCombobox` (types de test) et
  un court texte d'aide. Il n'y a ni `FilterBar` ni arbre. Le verrou d'arbre (`useTreeEditLock`) est
  désactivé sur cette route.

## 5. Colonnes partagées

`components/executions/ExecutionHistoryGrid.tsx` contient aujourd'hui `describe()` dans un
`useMemo`. Il est extrait vers `components/executions/executionColumnDefs.tsx` :

```ts
buildExecutionColumns(opts: {
  history: ExecutionHistory; withTestColumn: boolean; t: TFunction; locale: string;
  repoPath: string; gestures: RefObject<{ open(row): void; openVersion(id, repo): void }>
}): GridColumn<ExecutionHistoryRow>[]
```

Ce module unique est utilisé par la grille, le Document, la page imprimable et l'export docx.
`getText` sert au filtrage et aux exports ; `render` sert à l'écran.

## 6. Préférences

- Clé : `fieldVisibility["<nœud>::<type de test>"]` (le type affiché), dans le `.pref` du repo
  affiché.
- Nouvelles vues dans `FieldVisibilityPref` (`packages/api-client/src/types.ts`) :
  - `runExcel` (avec `colWidthsRunExcel` et `freezeColCountRunExcel`, via `gridPrefKeys('runExcel')`) ;
  - `runWord` ;
  - `runPopup`.
- Le handler `pref:set-field-visibility` est générique : rien à y changer.
- Défauts (`executionColumns.ts`) :
  - `runExcel` : `test`, `entryRequirement`, `campaign`, `entry`, `verdict`, `date`, `tester`,
    `testedVersion`, plus les `run:*` marqués `defaultVisible` ;
  - `runWord` : `duration`, `testedVersion`, `origin`, les `run:*` marqués `defaultVisible`, et
    `steps` ;
  - `runPopup` : vide.

## 7. Grille (`ExecutionHistoryGrid`)

Nouvelles props facultatives. La section de l'éditeur ne les passe pas : son comportement ne change
pas.

- `prefView?: string` : `'executions'` par défaut, `'runExcel'` dans la vue.
- `defaults?: string[]` : colonnes par défaut de la vue.
- `filters?: { value: ColumnFilters; onChange(next): void }` : filtres contrôlés.
- `noColumnPicker?: boolean` : le 👁 est celui de la vue (§8).
- `onDisplayedRows?` : non retenu. Le Document recalcule lui-même le filtre (§9).

`DataGrid` gagne la prop `columnFilters?: { value; onChange }`. `useColumnFilters` prend une option
`controlled`. Sans cette prop, l'état reste local, comme aujourd'hui. Les filtres sont **portés par
`ExecutionsView`** :
- ils survivent au passage Tableau ↔ Document ;
- ils sont remis à zéro au changement de type ou de repo ;
- ils ne sont jamais persistés.

Le paramètre `campaign` de l'URL initialise `{ campaign: { text: <ID>, options: { wholeWord: true } } }`.
Si la colonne Campagne est masquée dans la préférence, la vue l'affiche pour cette page : elle est
ajoutée aux colonnes visibles **sans écrire** la préférence. Un filtre sur une colonne masquée
serait ignoré (`activeColumnFilters`).

## 8. Panneau 👁 de la vue (`components/executions/ExecutionConfigPanel.tsx`)

- La coque est celle de `ColumnPickerPanel` (portail, position, Échap), avec trois onglets,
  Tableau / Document / Popup. Chaque onglet affiche une `ColumnChecklist` groupée.
  - Tableau : toutes les colonnes. Il écrit `runExcel`, comme le 👁 de la grille, qui est masqué
    ici (`noColumnPicker`).
  - Document : toutes les colonnes sauf l'en-tête de la fiche (`test`, `campaign`, `entry`,
    `verdict`, `date`, `tester`) et `notes`, plus la case « Étapes » (`steps`).
  - Popup : toutes les colonnes sauf `notes` et `steps`. La liste exacte de l'en-tête de la popup
    sera fixée par #399 ; ce sont des données, pas de code à reprendre.
- « Réinitialiser » retire la clé de l'onglet courant (`null`).
- Cocher ou décocher suit `toggleVisibleField` (GH235).

**Alternative rejetée** : réutiliser `FieldConfigModal`. Il est construit sur les champs du schéma,
les titres de dossiers et les colonnes calculées, qui ne s'appliquent pas à une exécution.

## 9. Document (`components/executions/ExecutionDocument.tsx`)

- Lignes : `history.rows` avec `kind === 'run'`, filtrées par `matchesColumnFilters` avec
  `activeColumnFilters(filters, colonnes visibles du Tableau)`. Les colonnes visibles sont celles de
  la préférence `runExcel` plus l'éventuelle colonne Campagne forcée : c'est exactement le filtre du
  Tableau.
- Fiche, `data-testid="execution-card-<runId>"` :
  - en-tête : test (lien d'élément et titre), campagne et entrée (avec badges), verdict, date,
    testeur ;
  - champs `runWord`, chacun en libellé et `render` ;
  - notes (`RichTextViewer`) ;
  - si `steps` est coché, tableau des étapes. Il a le **même contenu que le dépli de la grille** :
    n°, verdict, commentaire, `stepFields`.
- La prop `print` produit le rendu imprimable : pas de liens, classes `print-*`.

**Écart avec la spec, à reporter dans `specs/GH400.md`** : la spec citait « action, résultat
attendu » dans le tableau des étapes. Un `TestRun` ne porte pas ces textes. Il faudrait les relire
dans la copie `testSnapshot` de l'entrée, ou dans le test courant pour une exécution isolée, ce qui
donnerait des sources différentes selon les lignes. Le Document reprend donc le dépli de la grille.

## 10. Exports

- **xlsx (Tableau)** : l'export intégré de `DataGrid` (`table`), sans changement.
- **docx (Document)** : nouveau `ExportKind` `'executions'`.
  - Payload résolu côté renderer :
    ```ts
    ExecutionsExportPayload {
      title: string
      runs: { heading: string; meta: string; fields: {label; value}[]; notes: string;
              steps?: { order: number; result: string; comment: string; fields: {label; value}[] }[] }[]
    }
    ```
  - Générateur : `main/services/export/executions.docx.ts`, sur le modèle de `tests.docx.ts`
    (titre, une section par exécution, tableau des étapes).
- **PDF** : route `routes/print.executions.tsx`.
  - Paramètres : `repoPath`, `username`, `objectTypeRef`, `workspaceDir`, `title`, et `filters`
    (JSON des filtres actifs, avec la colonne Campagne forcée éventuelle).
  - La route relit l'historique et les préférences, construit les colonnes (§5) avec des gestes
    inertes, applique les filtres et rend `ExecutionDocument print`. Enfin, `useNotifyPrintReady`.
- Le bouton `ExportButton` (formats docx et pdf) est affiché en mode Document. En Tableau, c'est le
  bouton Exporter de la grille.

## 11. Lien depuis la fiche campagne

`routes/campaign.$campaignId.tsx` : un lien « Voir les exécutions » dans l'en-tête de la grille des
entrées (`data-testid="campaign-view-executions"`). Il mène à
`/executions?projectId&repo=<repoNameOf(repoPath)>&node&type&campaign=<ID>`.

Le type visé est celui du **premier test de la campagne**. La spec disait « type de la campagne »,
mais `campaign.objectTypeRef` est le type de la campagne, pas celui d'un test : à corriger dans la
spec. Si la campagne n'a pas de test, l'URL ne précise ni nœud ni type, et la vue prend le choix
par défaut.

## 12. i18n

`fr.json` / `en.json` :
- `executionsView.*` : titre, aide du panneau, modes, onglets 👁, « Étapes », vide, lien de la
  campagne ;
- `sidebar.campaignsNav.*` : infobulles des icônes ;
- `printExecutionsPage.*`.

## 13. Fichiers

| Fichier | Changement |
|---|---|
| `packages/types/src/execution-history.ts` | cible `{ objectTypeRef }` |
| `packages/types/src/export.ts` | kind `executions`, `ExecutionsExportPayload` |
| `packages/api-client/src/types.ts` | `runExcel`, `colWidthsRunExcel`, `freezeColCountRunExcel`, `runWord`, `runPopup` |
| `main/services/execution-history.service.ts` | cible de type, repli `runId` des exécutions antérieures à GH73 |
| `main/services/export.service.ts`, `export/executions.docx.ts` | générateur docx |
| `renderer/routes/executions.tsx`, `print.executions.tsx` | nouvelles routes (`routeTree.gen` régénéré) |
| `renderer/contexts/SystemViewContext.tsx` | catégorie, navigation, sélection mémorisée pour `/executions` |
| `renderer/components/layout/AppLayout.tsx` | `deducePanel`, dernière route du panneau Campagnes |
| `renderer/components/sidebar/SystemPanel.tsx` | icônes, corps sur `/executions` |
| `renderer/components/executions/*` | `executionColumnDefs`, `ExecutionsView`, `ExecutionConfigPanel`, `ExecutionDocument`, grille et colonnes |
| `renderer/components/grid/DataGrid.tsx`, `useColumnFilters.ts` | filtres contrôlés facultatifs |
| `renderer/routes/campaign.$campaignId.tsx` | lien « Voir les exécutions » |
| `renderer/hooks/useLiveFileSync.ts` | commentaire |
| `renderer/i18n/locales/{fr,en}.json` | libellés |

## 14. Sprints

1. **Lecture, route, panneau, Tableau** :
   - §2, §3, §4, §5, §6 (pour `runExcel`), §7 et §11 ;
   - le 👁 avec son seul onglet Tableau ;
   - tests unitaires du service ;
   - e2e : navigation, types, filtre de la colonne Campagne, lien depuis la campagne.
2. **Document, onglets Document et Popup, exports, SPEC** :
   - §8 complet, §9 et §10 ;
   - mise à jour de `SPEC-SYSTEM-VIEW.md` et `SPEC-TESTS.md`, et de l'index ;
   - e2e : Document, réglages et export docx.
