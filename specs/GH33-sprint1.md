# GH33 — Sprint 1 : sélecteur de tests (Vue Excel) pour l'ajout à une campagne

Spec : `specs/GH33.md` — Design : `specs/GH33-design.md` — Scénarios : `specs/GH33-tests.md`

## Fichiers modifiés / créés

| Fichier | Nature |
|---------|--------|
| `apps/desktop/src/renderer/lib/gridSelection.ts` | nouveau — `rowClick`, `checkboxClick`, `groupState`, `toggleGroup`, `pruneTree` (pur) |
| `apps/desktop/src/renderer/components/system/ExcelView.tsx` | prop `selection` (mode sélection) + `Échap` du popover de filtre colonne consommé |
| `apps/desktop/src/renderer/components/campaign/TestPickerGrid.tsx` | nouveau — grille d'un type de test (arbre, prefs Vue Excel, liens, étapes) |
| `apps/desktop/src/renderer/components/campaign/TestPickerModal.tsx` | nouveau — modale 2 étapes, compteur, confirmation d'abandon |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | panneau en ligne remplacé par la modale ; `handleConfirmAdd(result, previews)` |
| `apps/desktop/src/renderer/hooks/useProjectSchema.ts` | + `getTestTypeRefs` |
| `apps/desktop/src/renderer/lib/exportColumns.ts` | + `defaultVisibleFields` (colonnes par défaut, partagé avec `SystemView`) |
| `apps/desktop/src/renderer/components/system/RowMaxHeightButton.tsx` | + `readExcelRowMaxLines` (partagé avec `SystemView`) |
| `apps/desktop/src/renderer/components/system/SystemView.tsx` | utilise les deux helpers ci-dessus (comportement identique) |
| `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` | `campaignPage.picker.*`, `system.excelView.selectAllVisible` |

## Comportement implémenté

- **Ouverture** : « + Ajouter des tests » d'une campagne active ouvre une modale grand format.
  Le type affiché par défaut est le composant/niveau de la route, sinon le premier type de test.
- **Grille** (`ExcelView` en mode `selection`) :
  - colonnes, ordre, titres de dossiers, repli et colonnes figées repris des préférences Vue
    Excel du type. Le repli et les colonnes figées restent modifiables, sans être enregistrés ;
  - lecture seule forcée, quels que soient les callbacks : pas d'édition, de renommage, de
    glisser-déposer de lignes ou de colonnes, de popover de lien, de menu contextuel ni de
    raccourcis clavier (`Échap` remonte à la modale) ;
  - colonne de cases toujours figée, avec le badge « ×N » des instances déjà présentes ;
  - case d'en-tête et cases de dossier à trois états, appliquées aux tests qui passent les
    filtres, repli ignoré ;
  - clic simple, Ctrl, Maj et Ctrl+Maj sur une ligne ; case seule et Maj+case. Les tests non
    affichés ne sont jamais retirés par un clic ;
  - un clic sur une ligne de dossier le replie ou le déplie ;
  - filtres colonne T51 et filtre global (options casse / mot entier / regex) ;
  - un changement de type réinitialise les filtres colonne et le filtre global, mais garde la
    sélection.
- **Compteur** : « N sélectionnés, dont M non affichés », plus « Vider la sélection ».
- **Étape 2** : affichée seulement si un test sélectionné est itérant ou a des références à
  saisir ; sinon le bouton de l'étape 1 est directement « Ajouter (N) ». Elle contient
  `ReqInstancePicker` / `TestParamFields`, la ligne repliée « K tests sans paramètre », puis
  « Précédent » / « Ajouter (N) », désactivé tant que la saisie est incomplète (`isAddComplete`).
- **Validation** : même répartition qu'avant entre `addTests` (nouveaux tests et tests
  itérants) et `duplicateTest` (nouvelle instance d'un test paramétré déjà présent), calculée
  sur la prévisualisation de la modale. En cas d'erreur, le message s'affiche dans le pied et la
  modale reste ouverte.
- **Annulation** : fermeture directe si rien n'a changé ; sinon confirmation « Abandonner la
  sélection ? ». `Échap`, l'overlay et le bouton « Annuler » passent tous par là.

## Divergences par rapport au design

- **Prévisualisation des paramètres** (D5) : elle porte sur **tous les candidats** plutôt que
  sur la sélection, ce qui fait une seule requête à l'ouverture au lieu d'une à chaque clic.
  `onConfirm` reçoit cette prévisualisation, et la page l'utilise pour répartir les tests au lieu
  de la sienne. Cela évite d'utiliser deux résolutions possiblement décalées.
- **Ordre des tests ajoutés** : c'est l'ordre de la liste des candidats (comme l'ancien
  panneau), et non l'ordre de l'arbre par type.
- **Exports pdf** (`print.*.tsx`) : non migrés vers `defaultVisibleFields`. Leur repli diffère
  légèrement quand le type est introuvable, et le changer sort du périmètre.
- **Revue de code** : un défaut corrigé. Le compteur « non affichés » réutilisait la liste des
  lignes du type précédent quand aucune grille n'était montée (type sans test proposé, chargement,
  étape 2). Il ne compte plus que si la grille du type courant est montée.

## Vérifications

- `pnpm typecheck` (apps/desktop) : 0 erreur. Aucune variable inutilisée ajoutée
  (`--noUnusedLocals` propre sur les fichiers touchés).
- Logique de `gridSelection.ts` contrôlée par un script jetable : clic simple, Ctrl, plages
  Maj / Ctrl+Maj, ancre masquée, scénario S6 (Maj+case), groupes, `pruneTree` avec orphelin.
  Tous les cas passent.
- `apps/desktop` n'a pas de tests automatiques. Les scénarios manuels restent à dérouler.

## Mises à jour SPEC

Aucune à ce sprint : elles se font au sprint 2, le dernier.

## Comment tester manuellement

`pnpm dev` depuis le worktree `../polenta-official-GH33`, puis ouvrir une campagne `planned` ou
`in_progress`. Dérouler les scénarios **N1–N6, S1–S13, F1–F5 et A1–A6** de `GH33-tests.md`.

La création de campagne (`/campaign/new`) n'a pas encore changé : c'est le sprint 2.
