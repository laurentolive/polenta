# GH176 — Scénarios de test

Spec : [GH176.md](GH176.md) · Design : [GH176-design.md](GH176-design.md)

Légende : **U** = unitaire vitest (`pref-defaults.test.ts`), **E** = e2e web
(`e2e-web/gh176-picker-columns.spec.ts`), **M** = manuel.

## Stockage (handlers `pref:*`)

| # | Type | Scénario | Attendu |
|---|---|---|---|
| U1 | U | `set(T, { picker: [a] })` sur une entrée `{ excel: [x], word: [y] }` | entrée = `{ excel: [x], word: [y], picker: [a] }` |
| U2 | U | Entrée avec `picker`, puis `set(T, { excel, word, edit, showFoldersExcel })` (écriture type Vue Système) | `picker` toujours présent, les 4 clés remplacées |
| U3 | U | `set(T, { picker: null, showFoldersPicker: null })` | les deux clés absentes, les autres intactes |
| U4 | U | Entrée réduite à `{ picker }`, puis `set(T, { picker: null })` | `fieldVisibility[T]` retirée ; `get(T)` ⇒ défaut d'équipe ou `null` |
| U5 | U | Défaut d'équipe `{ excel: [e] }`, personnel `{ picker: [p] }` | `get(T)` = `{ excel: [e], picker: [p] }` |
| U6 | U | Défaut d'équipe `{ excel: [e] }`, personnel `{ excel: [m] }` | `get(T).excel` = `[m]` (le personnel l'emporte) |
| U7 | U | Ni défaut d'équipe ni personnel | `get(T)` = `null` (inchangé) |

## Sélecteur — nominal

| # | Type | Scénario | Attendu |
|---|---|---|---|
| E1 | E | Ouvrir « + Ajouter des tests », type sans `picker` | colonnes = Vue Excel du type + Statut (CA1) ; bouton ⚙️ visible |
| E2 | E | Cliquer ⚙️ | panneau sans onglets Tableau/Document ; case Statut cochée et désactivée (CA2) |
| E3 | E | Cocher 2 tests, saisir un filtre global, puis cocher une colonne de liens dans ⚙️ | colonne visible ; 2 tests toujours cochés, filtre conservé, compteur inchangé (CA3) |
| E4 | E | Fermer la modale (Annuler + confirmer), rouvrir | colonne de liens toujours affichée ; `.pref` : `picker` présent (CA4) |
| E5 | E | Après E4, ouvrir la Vue Système du type en Vue Excel | colonnes d'origine, sans la colonne de liens ; `excel` inchangé (CA5) |
| E6 | E | Après E4, changer une colonne dans la Vue Excel, rouvrir le sélecteur | le sélecteur garde ses colonnes, `picker` présent (CA6) |
| E7 | E | « Réinitialiser » dans le panneau du sélecteur | `picker` / `showFoldersPicker` absents du `.pref` ; colonnes = Vue Excel (CA7) |
| E8 | E | Décocher « Afficher les titres des dossiers » dans le sélecteur | liste plate dans le sélecteur ; Vue Excel garde ses titres ; `showFoldersExcel` inchangé (CA8) |
| E9 | E | Panneau ouvert, `Échap` | panneau fermé, modale ouverte ; second `Échap` après une sélection ⇒ confirmation d'abandon (CA9) |
| E10 | E | Choix sur le type A, puis passer au type B dans la combobox | type B : colonnes de sa Vue Excel ; panneau fermé au changement de type (CA10) |

## Cas limites

| # | Type | Scénario | Attendu |
|---|---|---|---|
| L1 | E | Cocher une colonne calculée (`query::…`) dans le sélecteur | colonne calculée et affichée ; non ajoutée à `excel` |
| L2 | M | Colonne éclatée (GH126) : ouvrir ⚙️ dans le sélecteur | « Calcul des colonnes… » puis une case par sous-colonne |
| L3 | M | `picker` contient un champ retiré du schéma / une requête supprimée | clé ignorée à l'affichage, toujours présente dans le `.pref` |
| L4 | E | Décocher Statut impossible ; décocher toutes les autres colonnes | grille avec au moins Statut ; `picker` ne contient pas `status` si la Vue Excel ne l'avait pas |
| L5 | M | Filtre colonne posé sur une colonne qu'on masque | le filtre cesse de s'appliquer, les lignes réapparaissent |
| L6 | M | Défaut d'équipe (`polenta-config`) sur `excel`, aucun choix perso, puis choix dans le sélecteur | la Vue Excel garde le défaut d'équipe après l'écriture de `picker` |
| L7 | M | Onglet « Depuis une campagne » et étape 2 | pas de bouton ⚙️ |
| L8 | M | Desktop (Electron) : refaire E3–E4 | même comportement que le client web |

## Non-régression

| # | Type | Scénario | Attendu |
|---|---|---|---|
| R1 | E | e2e existants `gh70-*`, `gh126-split-column`, `gh33`/`gh64`/`gh68` du sélecteur | verts (panneau extrait, sélecteur) |
| R2 | M | Vue Système : ⚙️, onglets Tableau/Document, Réinitialiser, titres de dossiers | comportement inchangé |
