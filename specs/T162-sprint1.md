# T162 — Sprint 1 (unique)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/api-client/src/types.ts` | Nouvelle interface exportée `FieldVisibilityPref` (`excel`/`word`/`edit` + `showFoldersExcel?`/`showFoldersWord?`) ; signatures `pref.getFieldVisibility` / `setFieldVisibility` typées avec elle. |
| `packages/api-client/src/index.ts` | Réexport de `FieldVisibilityPref`. |
| `apps/desktop/src/main/ipc/pref.handlers.ts` | Type du paramètre `views` de `pref:set-field-visibility` élargi (2 booléens optionnels). Handler inchangé (stocke déjà l'objet entier). |
| `apps/desktop/src/renderer/components/system/SystemView.tsx` | États `showFoldersExcel` / `showFoldersWord` (défaut `true`) ; `prefsRef` (miroir synchrone de l'objet de pref) ; dérivation depuis `savedPrefs` (`?? true` si absent) ; `persistPrefs(override)` unique ; handlers `handleChangeShowFolders{Excel,Word}` ; `FieldConfigModal` : 4 nouvelles props + case à cocher par onglet + reset étendu ; `foldersHidden={!showFolders*}` passé à `ExcelView` / `WordView`. |
| `apps/desktop/src/renderer/components/system/ExcelView.tsx` | Prop `foldersHidden` ; `flatten` ne pousse plus les nœuds `folder` et ignore le collapse quand masqué ; `handleRowDragOver` + `handleRowDrop` : drop refusé si parents différents quand masqué (réordonnancement intra-dossier uniquement). |
| `apps/desktop/src/renderer/components/system/WordView.tsx` | Prop `foldersHidden` ; `renderNodes` saute le `<Hn>` et descend directement dans les enfants quand masqué (filtre `folderHasMatchingDescendant` préservé). |
| `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` | Clé `system.fieldConfig.showFolders`. |
| `specs/SPEC-SYSTEM-VIEW.md` | §Vue Excel, §Vue Word, §Configuration des champs, §Persistance. |
| `specs/SPEC-INDEX.md` | Ligne SPEC-SYSTEM-VIEW §Configuration des champs → périmètre + mots-clés + MAJ `T162`. |

## Comportement implémenté

- ⚙️ (`FieldConfigModal`) : case **« Afficher les titres des dossiers »** en haut du panneau,
  propre à l'onglet actif (Tableau / Document), cochée par défaut.
- Décochée en **Tableau** : plus aucune `GroupRow` ; `flatten` liste tous les éléments à plat
  (collapse ignoré). La colonne `section` (si visible) garde la numérotation `1`, `1.1`, `2`…
- Décochée en **Document** : plus aucun titre `Hn` ; les `ItemCard` s'enchaînent, préfixe de
  section conservé.
- Indépendance totale Tableau ↔ Document.
- **Persistance** : `fieldVisibility["<nœud>::<type>"]` porte maintenant
  `showFoldersExcel` / `showFoldersWord` à côté de `excel`/`word`/`edit`. Absent ⇒ `true`.
  Par type / par utilisateur, fichier `.{user}.pref`.
- **« Réinitialiser »** (par onglet) : remet les colonnes par défaut **et** la case à cochée,
  en un seul enregistrement disque cohérent.
- **Drag & drop Excel, titres masqués** : réordonnancement accepté uniquement entre éléments
  de même dossier parent ; tout dépôt inter-dossiers est ignoré (aucune ligne indicatrice,
  garde défensive au drop). Inchangé quand les titres sont affichés.

## Divergences par rapport au design

- **`persistPrefs` via `prefsRef` (miroir synchrone) plutôt que via l'état/closures.** Le
  design proposait de reconstruire le payload à partir de l'état courant. En le testant
  mentalement, le bouton « Réinitialiser » (2 appels `persistPrefs` coup sur coup :
  colonnes, puis titres) écrasait le 1er avec des valeurs de closure périmées au 2nd — les
  colonnes réinitialisées n'étaient pas persistées. Un `useRef` mis à jour synchroniquement
  avant chaque `mutate` règle le cas proprement (et durcit aussi les bascules rapides
  colonne/titre). Le `prefsRef` est resynchronisé depuis `savedPrefs` dans le `useEffect` de
  dérivation.
- Nommage : la prop passée aux vues est `foldersHidden` (négatif) alors que l'UI/pref parlent
  en `showFolders*` (positif) — inversion unique au câblage, comme prévu au design.

## Limites connues (hors scope, non régressions T162)

- Fenêtre de `placeholderData` au changement de type : si l'utilisateur ouvre ⚙️ et bascule un
  réglage pendant que la query `['pref-visibility', …]` renvoie encore les prefs du type
  précédent (`isPrefsPlaceholder`), le `prefsRef` n'est pas encore resynchronisé. Ce défaut
  préexiste pour la sélection de colonnes (même mécanisme) et n'est pas aggravé ici.
- Export PDF/Word/Excel : non concerné (les titres/sections y restent).

## Vérifications

- `npx turbo typecheck` : 4/4 packages OK (0 erreur).
- Pas de tâche `lint` ni `test` pour `@polenta/desktop` (cf. mémoire projet). `@polenta/api#test`
  échoue déjà sur `master` (jest non installé) — sans rapport avec ce ticket.
- `/code-review` : le fork a analysé par erreur la branche `master` (ticket T161) ; revue
  manuelle du diff effectuée à la place → 1 bug trouvé et corrigé (double `mutate` de
  « Réinitialiser »).

## Comment tester manuellement

Suivre `specs/T162-tests.md` : G1–G6 (case, masquage Tableau, indépendance des vues,
persistance par type, réinitialiser, DnD intra-dossier), L1–L8 (drag inter-dossiers refusé,
filtres, arbre sans dossier, rétrocompat pref, changement de type, bascule à chaud, campagne),
R1–R4 (non-régressions).

Scénario minimal :
1. Vue Système, un type avec des dossiers, vue Tableau.
2. ⚙️ → décocher « Afficher les titres des dossiers » → liste plate, section conservée.
3. Passer en Document → titres toujours là ; ⚙️ onglet Document → décocher → cartes à la suite.
4. Changer de type puis revenir → réglages conservés ; « Réinitialiser » → tout revient.

## Mises à jour SPEC effectuées

- `SPEC-SYSTEM-VIEW.md` §Vue Excel : ajout du paragraphe « Titres de dossiers masquables (T162) ».
- `SPEC-SYSTEM-VIEW.md` §Vue Word : ajout du paragraphe « Titres de sections masquables (T162) ».
- `SPEC-SYSTEM-VIEW.md` §Configuration des champs : entrée « Titres de dossiers (T162) »,
  précision `fieldVisibility` + reset.
- `SPEC-SYSTEM-VIEW.md` §Persistance : ligne ⚙️ enrichie de la forme complète de l'objet pref.
- `SPEC-INDEX.md` : ligne SPEC-SYSTEM-VIEW §Configuration des champs — périmètre, mots-clés,
  colonne MAJ → `T162`.
