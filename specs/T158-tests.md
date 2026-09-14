# T158 — Scénarios de test

> Feature clavier dans l'UI Electron — vérification manuelle. Pas de test unitaire
> automatisé pertinent (comportement porté par l'intégration TipTap + React).

## Golden path — un scénario par contexte d'édition

### S1 — Vue Tableau, popover richtext
1. Ouvrir la Vue Tableau d'un type ayant un champ `richtext`.
2. Double-cliquer une cellule richtext → le popover d'édition s'ouvre, focus dans l'éditeur.
3. Taper `bonjour`.
4. Presser `Ctrl+Entrée`.
   - **Attendu** : le popover se ferme, la cellule affiche `bonjour`, aucune ligne blanche
     insérée. Rechargement de la vue → valeur persistée.

### S2 — Vue Document, champ inline
1. Vue Document d'une exigence, cliquer un champ `richtext` (ex. énoncé) → mode édition.
2. Modifier le texte, presser `Ctrl+Entrée`.
   - **Attendu** : le champ repasse en lecture, valeur enregistrée (équivalent `commit()`).

### S3 — Formulaire de création d'exigence
1. `/req/new`, saisir un titre, focus dans le champ `statement`, taper du texte.
2. `Ctrl+Entrée`.
   - **Attendu** : l'exigence est créée, navigation vers `/req/$reqId` (comme un clic sur
     « Créer l'exigence »).
3. Variante : titre vide → `Ctrl+Entrée` dans `statement` → message « titre requis »
   affiché, pas de création (validation native `requestSubmit`).

### S4 — Page détail exigence, Enregistrer
1. `/req/$reqId`, modifier le champ `statement`.
2. `Ctrl+Entrée`.
   - **Attendu** : « Enregistrer » se déclenche (bouton passe à l'état pending), contenu
     persisté.
3. Variante : aucune modification → `Ctrl+Entrée` → no-op (pas d'appel réseau).

### S5 — EditView (Vue Système)
1. Éditer un objet, modifier un champ `richtext`.
2. `Ctrl+Entrée`.
   - **Attendu** : le champ est flush/validé (`onBlurField`), la dernière frappe n'est pas
     perdue.

### S6 — StepsTable dans le formulaire d'édition d'un test
1. `/test/$testId`, éditer la cellule « Action » d'une étape, taper du texte.
2. `Ctrl+Entrée`.
   - **Attendu** : « Enregistrer » se déclenche (steps complets) ; aucune étape ajoutée.

### S7 — StepsTable inline (Vue Document / Tableau)
1. Vue Document d'un test, panneau des étapes, éditer une cellule.
2. `Ctrl+Entrée`.
   - **Attendu** : le focus sort de la cellule (blur) ; aucune étape ajoutée ; la valeur
     déjà propagée reste.

### S8 — Exécution de campagne
1. `/campaign/$id/execute/$testId`, saisir un commentaire d'étape richtext.
2. `Ctrl+Entrée`.
   - **Attendu** : « Enregistrer le résultat » se déclenche (`executeMutation`).

### S9 — Édition des champs de campagne
1. `/campaign/$id`, cliquer le crayon d'édition des champs, modifier un champ `richtext`.
2. `Ctrl+Entrée`.
   - **Attendu** : sauvegarde des champs (`updateFieldsMutation`).

## Cas limites

### L1 — Saut de ligne toujours possible
Dans chacun des contextes ci-dessus : `Maj+Entrée` insère un saut de ligne dans le
paragraphe courant ; `Entrée` seul crée un nouveau paragraphe / item de liste. Aucun de ces
deux comportements n'est modifié.

### L2 — Champ en lecture seule
`TestCaseEditModal` / `RequirementEditModal` (champs `disabled`) : `Ctrl+Entrée` dans un
champ richtext → aucun effet, aucune erreur console. (`onSubmit` non fourni → `return false`,
et l'éditeur non éditable n'insère rien.)

### L3 — Mode Raw
Basculer un champ en mode « Raw » (`<textarea>`), `Ctrl+Entrée` → comportement natif du
navigateur (pas de régression, hors périmètre).

### L4 — Curseur dans un bloc de code
Curseur à l'intérieur d'un ```code block``` d'un champ câblé : `Ctrl+Entrée` déclenche
« valider » (et non plus la sortie de bloc de code). `Maj+Entrée` reste disponible pour un
saut de ligne. Tradeoff documenté (spec §Hors scope).

### L5 — Édition multi-sélection (Vue Tableau)
Popover richtext ouvert sur une cellule avec plusieurs lignes sélectionnées : `Ctrl+Entrée`
ferme le popover, la valeur est appliquée à toutes les lignes de la sélection (comme la
fermeture par clic extérieur).

## Non-régression

- `npm run typecheck` / lint : zéro erreur nouvelle.
- Popover Vue Tableau : fermeture par clic extérieur et par `Échap` (restauration des
  valeurs d'origine) inchangées.
- `EditView` : handler `window` `Ctrl+Entrée` pour les inputs non-richtext toujours actif.
