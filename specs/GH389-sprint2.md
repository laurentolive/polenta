# GH389 — Sprint 2 : Vue Excel sur les briques communes, clavier, export Tableau filtré

Spec : `specs/GH389.md` (§1.7, §1.10, §3). Design : `specs/GH389-design.md` §7, §4 « Vue Excel », §11 ;
écarts au §13. Base : `6f2c850` (sprint 1). Abréviation : `r/` = `apps/desktop/src/renderer`.

## Fichiers

### Modifiés
- `r/components/system/ExcelView.tsx` : filtres par colonne (`useColumnFilters`, `ColumnFilterPopover`),
  largeurs / gel / ordre (`useColumnLayout`), en-têtes (`GridHeaderCell`, `ColumnFreezeMenu`), sélection
  (`useRowSelection`, modes lignes et cases), clavier (`useGridKeyboard`) ; `rows`, `filteredRows`,
  largeurs auto, libellés et textes de cellule mémoïsés ; `data-col` / `data-active` sur les cellules,
  `PlainCell` (couverture, reflets) ; `exportRef` (ce qui est affiché) ; libellés des enum (GH136) dans
  le texte affiché.
- `r/components/system/SystemView.tsx` : export Tableau xlsx depuis la Vue Excel (`buildDisplayedExportRows`,
  gabarit restreint aux éléments affichés) ; `useGridPrefs` pour l'écriture du `.pref` du type et les
  largeurs / colonnes figées ; hauteur des lignes par `writeExcelRowMaxLines`.
- `r/components/campaign/TestPickerGrid.tsx` (+ `TestPickerModal.tsx`, `versions/VersionElementPicker.tsx`) :
  préférences par `useGridPrefs` (prop `username` retiré).
- `r/components/system/FieldConfigModal.tsx` : cases par `ColumnCheckItem`.
- `r/lib/exportColumns.ts` : `buildDisplayedExportRows`, `DisplayedExportRow`, `buildExportOutline(…, keep)`.
- Briques `r/components/grid/` : `rowSelection.ts` (contenu de `lib/gridSelection.ts`, supprimé),
  `useRowSelection.ts` (ancre hors sélection → dernière ligne sélectionnée, clic et Maj+↑↓),
  `useGridPrefs.ts` (`raw`, `patch`, fonctions stables, lecture en échec = défauts),
  `useColumnFilters.ts` (pas de rendu supplémentaire au montage), `GridHeaderCell.tsx` (`clip`),
  `ColumnChecklist.tsx` (`ColumnCheckItem`), `DataGrid.tsx` (conteneur rendu avant les préférences,
  élagage de sélection linéaire).
- `apps/desktop/src/main/services/export/table.xlsx.ts` : hyperlien seulement pour un lien accepté (GH195).
- `r/contexts/ElementNavContext.tsx`, `r/hooks/useLiveFileSync.ts` : index des liens d'élément (versions,
  validations, sprint 1) sur des clés propres `['element-nav', …]`, relues une fois après une rafale de
  changements de fichiers (300 ms) — régression du sprint 1 trouvée par `gh74-editing` (voir Vérifications).
- `specs/GH389-design.md` : §13.

### Nouveaux
- `r/lib/exportColumns.gh389.test.ts` (U7).
- `apps/desktop/e2e-web/gh389-excel-keyboard.spec.ts` (E5 Vue Excel, Espace du sélecteur de tests).
- `apps/desktop/e2e-web/gh389-excel-export.spec.ts` (E9).

## Comportement

- **Inchangé à l'écran** : filtres par colonne, largeurs, colonnes figées (clic droit), glisser des
  en-têtes, sélection (clic, Maj, Ctrl, T149), panneau ⚙️, hauteur des lignes, sélecteur de tests.
  Différences visibles mineures : cellules Couverture et reflets sélectionnables (contour bleu) ; un
  champ enum à libellés se filtre sur son libellé (comme le statut) ; Échap ferme le menu de gel.
- **Clavier** (focus dans la grille, pas dans un champ ni sur un bouton / lien) : ↑↓ (la ligne devient
  la sélection), ←→, Tab / Maj+Tab (passage de ligne), Maj+↑↓ (plage), Entrée = F2 (éditeur de la
  cellule ; lien : popover d'édition ; dossier sans renommage : replier / déplier ; boîte de
  suppression ouverte : confirmation), ←/→ sur un dossier (replier / déplier), Tab dans un éditeur
  texte (valide puis cellule suivante). Ligne de dossier : une cellule (nom). Cellule active ramenée
  dans la zone visible (sous l'en-tête, à droite des colonnes figées). F2, Échap, Ctrl+C/X/V, Suppr,
  Ctrl+Z/Y inchangés.
- **Sélecteur de tests** (mode sélection) : flèches (sans changer la sélection) et Espace (coche /
  décoche la ligne, ou le dossier) ; Tab, Entrée, Échap gardent leur rôle dans la modale.
- **Export Tableau** (Exporter → Excel, depuis la vue Tableau) : lignes affichées (filtres de colonne,
  filtre global avec casse / mot entier / regex, contenu des dossiers repliés exclu) dans l'ordre,
  titres de dossier compris ; colonnes visibles dans l'ordre avec leur titre, colonnes de lien (ID
  séparés par « , ») et Vérification comprises ; statut, enum, couverture et reflets en libellés ;
  champ `link` en hyperlien. Gabarit GH34 : mêmes colonnes qu'avant, éléments affichés seulement.
  Word, PDF et l'export xlsx depuis la vue Document : inchangés.

## Divergences au design

Détail : `specs/GH389-design.md` §13. En bref : `useGridPrefs` dans `SystemView` limité à l'écriture et
aux largeurs / gel ; `FieldConfigModal` sur `ColumnCheckItem` ; `GridHeaderCell.clip` ;
`excel-header-<col>`, `data-col` / `data-active` ; Entrée = F2 (lien compris) ; ancre Maj de
`useRowSelection` ; enum en libellés ; titres de dossier exportés ; import en masse sans lien avec le
classeur (rien à exclure).

## Mesures T176

**Méthode** : desktop buildé (`electron-vite build`), piloté par Playwright dans un profil isolé, sur
une copie de PH2 (handstickProduct, type « Exigence » : 181 éléments, dossiers, colonnes Section,
Label, ID + les 25 colonnes Tableau de l'utilisateur, dont 13 richtext ; hauteur max 10). Temps
mesurés dans la page, de l'évènement à la première frame peinte après la condition (rAF + tâche) :
affichage initial = clic sur « Vue tableau » (depuis la vue Document, données en cache) → ≥ 30 lignes
et ≥ 20 en-têtes peints ; changement de ligne = clic sur la cellule Label d'une autre ligne → ligne
sélectionnée peinte ; double-clic = cellule texte (Phase proto) d'une autre ligne éditable → éditeur
focalisé ; ↓ = touche → ligne suivante sélectionnée. 9 mesures par passe, médianes. Script jetable
(non versionné).

| Mesure (médiane) | Avant (2 passes) | Après (2 passes retenues) |
|------------------|------------------|---------------------------|
| Affichage initial | 444 / 424 ms | 412 / 376 ms |
| Changement de ligne (clic) | 35 / 29 ms | 28 / 29 ms |
| Double-clic → éditeur texte | 38 / 36 ms | 39 / 35 ms |
| ↓ (nouveau) | — | 32 / 29 ms |

Aucune régression (écarts dans le bruit, ≈ ±15 % d'une passe à l'autre). Une 3e passe « après »,
faite pendant une autre charge du poste (≈ +45 % sur toutes les mesures, y compris l'affichage), n'est
pas retenue ; la passe suivante est revenue aux valeurs ci-dessus.

## Tester à la main

1. Vue Tableau d'un type d'exigence avec dossiers : clic sur une cellule, ↓ ×3, → ×2 ; Tab en bout de
   ligne ; Maj+↓ ; sur une ligne de dossier ← / → (repli) ; Entrée sur une cellule texte, Échap
   (rien d'écrit), Entrée + saisie + Tab (écrit, cellule suivante) ; colonne très large : → la ramène.
2. Sélectionner une ligne, Suppr, Entrée : supprimée (pas d'éditeur).
3. Filtre global en regex + filtre de colonne + une colonne de lien et Vérification visibles →
   Exporter → Excel : classeur = ce qui est affiché (titres de dossier, ID liés, libellés).
4. Campagne → Ajouter des tests : clic sur une ligne, ↓, Espace (coche / décoche), Échap (ferme).
5. Panneau ⚙️ (Tableau, Document, Popup, sélecteur) : cases, (sys), (calc), ⚠, Réinitialiser.
6. Largeur, gel, ordre, vue enregistrée : comme avant (relecture après changement de vue).

## Correctif d'une régression du sprint 1

`e2e-web/gh74-editing` D1 échouait (`net::ERR_INSUFFICIENT_RESOURCES`, 610 fois dans la console), vert
sur `main` (journal `gh387-base-e2e`). Trace : à l'amorçage de Suivi, une rafale de fichiers écrits
déclenche une invalidation par fichier ; les requêtes `versions:list` et `validations:versions` de
l'index des liens (ajoutées au sprint 1, actives sur toutes les pages, mêmes clés que les écrans) étaient
relues à chaque fois pour chaque repo : 720 requêtes en une seconde en plus des 432 `suivi:run`. Clés
propres à l'index et relecture unique après la rafale : D1 et la suite `gh74` repassent.

## Vérifications

**Niveau 1**
- `tsc --noEmit -p tsconfig.json` (desktop, `pnpm typecheck`) : 0 erreur.
- `pnpm lint` : n'exécute rien (issue #395) — non significatif.
- Unitaires touchés : `src/renderer/components/grid`, `src/main/services/export`,
  `src/renderer/lib/exportColumns*` → 72 tests OK (dont U7 : 6).

**Revue** : skill `code-review` (medium) sur la PR #391. Corrigés : mémoire du défilement d'une
`DataGrid` montée avant ses préférences (conteneur rendu d'emblée) ; préférences en échec = grille
jamais affichée (défauts) ; Maj+↑↓ avec une ancre hors sélection ; élagage de sélection quadratique ;
hyperlien d'export limité aux liens acceptés (GH195) ; commentaire vers `lib/gridSelection.ts`. Non
retenus : Entrée sur la colonne Design de la Validation résolue par l'index nu (limite connue du
sprint 1, `PageLink` au clic) ; requêtes versions / validations de l'index des liens (design §5) ;
`fileBaseNameOf` distinct de `exportFilenames.sanitize` (le nom proposé garde le titre de la grille,
spec §1.10).

**Niveau 2**
- `pnpm test` (racine, après tous les correctifs) : desktop 197 fichiers / 2 062 tests OK ; admin-service
  124 OK + 3 ignorés ; merge-core 83 OK.
- e2e-web (`pnpm build:web`, ports par défaut) : liste de grille du sprint (`gh288`, `gh235`, `gh203`,
  `gh176`, `gh224`, `gh300`, `gh230`, `gh228`, `gh229-*`, `gh169`, `gh70-*`, `gh126`, `gh139`, `gh136`,
  `gh152`, `gh83`, `gh81-verif`, `gh252`, `gh246-render-loop`, `gh250`, `gh299`, `gh195`, `gh74`,
  `gh105`, `gh389-*`) : premier passage 115 OK, 1 ignoré, 1 échec (`gh74-editing` D1, régression
  du sprint 1 ci-dessus) et 6 non lancés ; `gh389-excel-export` avait d'abord échoué (filtre d'un enum à
  libellés sur la valeur brute, corrigé). Après tous les correctifs (revue, enum, index des liens),
  build web refait, toute la liste relancée : **122 OK, 1 ignoré, 0 échec**.
- e2e desktop (`electron-vite build`) : `gh389-validation`, `gh204-validation`, `gh210-reflections` →
  **9 OK**.

**Non lancé** : suite e2e complète (niveau 3, au merge) ; contrôles manuels (thème sombre, classeur
dans Excel / LibreOffice).

## Restes fragiles

- Tab en dernière cellule de la grille y reste (le focus ne sort pas de la grille par Tab).
- Entrée sur une cellule de lien ouvre le popover d'édition (comme F2), ne suit pas le lien : clic ou
  Ctrl+clic sur l'ID pour naviguer.
- Export xlsx lancé depuis la vue Document : ancien calcul (filtre global en sous-chaîne, sans liens).
