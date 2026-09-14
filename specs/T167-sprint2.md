# T167 — Sprint 2 (final)

Réf. : `specs/T167.md`, `specs/T167-design.md`, `specs/T167-tests.md`,
`specs/T167-sprint1.md`.

Périmètre livré : **édition inline d'un résultat de recherche** via `EditView`,
sans quitter `/search` ; double-clic câblé (exig./test → édition, campagne →
page campagne) ; documentation SPEC.

## Fichiers

| Fichier | Nature |
|---|---|
| `apps/desktop/src/renderer/components/search/SearchEditPane.tsx` | **nouveau** — câble `EditView` complet (autosave par champ via `onBlurField`/`onFlushValues`, section Liens, table Étapes pour un test, badge couverture pour une exigence, `ViewHeader` + bouton « Retour aux résultats » + `RichTextToolbar` sous `RichTextProvider`). Version allégée de `SystemView` : pas d'arbre (`name` = `title`), pas d'undo/DnD/création, pas de `backHistory`. Objet lié → nouvel onglet (`openTab`). `readOnly` via `useVersioning().isReadonly` |
| `apps/desktop/src/renderer/contexts/SearchContext.tsx` | `openEditor` / `closeEditor` activés (côté sprint 1 le champ `editing` existait déjà, inerte) |
| `apps/desktop/src/renderer/components/sidebar/SearchPanel.tsx` | double-clic → `openEditor(result)` (exig./test) ; campagne → `navigate('/campaign/$id')` |
| `apps/desktop/src/renderer/routes/search.tsx` | branche édition (`SearchEditPane`) prioritaire sur la liste ; `handleOpen` → `openEditor` / navigation campagne |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `search.edit.back` |

## Documentation SPEC (dernier sprint)

- **`SPEC-ELECTRON-DESKTOP.md`** :
  - §19.3 (table des routes) — ajout de la ligne `/search`.
  - **§19.17 (nouvelle)** — « Vue Recherche » : panneau latéral, zone principale
    (liste `SearchResultsDoc` lecture seule / édition inline `SearchEditPane`),
    clic simple = goto, double-clic = édition ou page campagne, partage d'état
    `SearchProvider`/`SearchContext`, `useOptionalSearch`.
- **`SPEC-SYSTEM-VIEW.md`** §Goto — note : le mécanisme `useScrollToNode` +
  contour est réutilisé par la Vue Recherche (renvoi vers §19.17).
- **`SPEC-REQ-requirements.md`** §3.2a — `StaticRichTextViewer` prop
  `highlightRegex` (surbrillance des occurrences en lecture).
- **`SPEC-INDEX.md`** — nouvelle ligne §19.17 (`MAJ = T167`) ; `MAJ → T167` sur
  les lignes `SPEC-ELECTRON-DESKTOP §19.1,§19.3`, `SPEC-SYSTEM-VIEW §global`,
  `SPEC-REQ §3`.

## Corrections issues de `/code-review` (high) — sprint 2

Toutes dans `SearchEditPane.tsx`, gestion d'état des étapes de test :

1. **Édition d'étape perdue** au refetch de l'objet (que la pane déclenche
   elle-même après toute sauvegarde de champ/statut) ou en quittant dans la
   fenêtre de debounce : l'effet de synchro réinitialisait `testSteps` à chaque
   nouvelle référence `loadedObject`. → Reseed **uniquement** au 1er chargement /
   changement d'objet (`stepsSeededIdRef`), jamais sur refetch du même objet.
2. **`inlineEditTimers` = code mort** + commentaire trompeur (« debounce comme
   `SystemView.handleAutoInlineEdit ») : `onBlurField` d'`EditView` est immédiat
   (comme `SystemView.handleEditBlurField`), la coalescence richtext est interne
   à `EditView`. → Ref supprimée, commentaire corrigé.
3. **Autosave des étapes** n'invalidait aucune query (liste des résultats
   périmée au retour) et ne remettait pas `stepsDirtyRef` à `false` (sauvegardes
   répétées). → `flushSteps` : `invalidateQueries(['tests', repoPath])` +
   `['object', repoPath, 'test', id]`, `stepsDirtyRef = false` sur succès (remis
   à `true` sur échec). Flush des étapes non sauvegardées de l'objet sortant au
   changement d'élément / démontage (`useEffect` cleanup keyé sur `editing.id`).

## Vérifications

- `cd apps/desktop && npx tsc --noEmit -p tsconfig.json` → **0 erreur**.
- `npx electron-vite build` → **OK** (`EditView-*.js` + `search-*.js` générés).
- `turbo test` : échoue toujours sur `@polenta/api#test` (`jest` absent du
  worktree), sans rapport avec T167 ; pas de runner renderer.
- `routeTree.gen.ts` : non modifié.

## Divergences par rapport au design

- `SearchEditPane` : `flushSteps` + reseed conditionnel — le design décrivait un
  simple « état local + autosave debouncé (copie de `SystemView`) » ; la copie
  fidèle reproduisait un bug latent de `SystemView` (perte d'édition d'étape au
  refetch). Corrigé ici, pas rétro-porté sur `SystemView` (hors périmètre).
- Écart mineur `readOnly` : un nœud local `readonly: true` dont un élément
  apparaît dans les résultats resterait éditable via `SearchEditPane`
  (`useVersioning().isReadonly` ne couvre que le repo root figé sur baseline).
  Documenté comme accepté (cf. `T167-design.md` §6.3).

## Comment tester manuellement (scénarios sprint 2 de `T167-tests.md`)

1. `pnpm --filter @polenta/desktop dev`, ouvrir un projet, activité **Recherche**,
   lancer une recherche.
2. Double-clic sur une carte **exigence** → `EditView` dans la zone principale,
   `ViewHeader` « ← Retour aux résultats », URL toujours `/search`. Modifier un
   champ (texte + richtext), vérifier la persistance (fichier YAML). « Retour aux
   résultats » → la carte reflète la modif, recherche recalculée.
3. Double-clic sur une carte **test** → `EditView` + bloc Étapes éditable ;
   modifier une étape, attendre ~1 s → persistée ; retour → carte à jour.
4. Double-clic sur une carte **campagne** → navigation `/campaign/$id`.
5. En édition, section Liens → cliquer un id lié → ouverture dans un **nouvel
   onglet** ; ajouter un lien → badge couverture mis à jour.
6. Projet figé sur une baseline → double-clic → `EditView` en lecture seule.
7. `Échap` en édition → retour. Basculer d'activité en cours d'édition richtext →
   flush T159, retour sur Recherche = liste (pas l'éditeur).
8. Non-régression : Vue Système → double-clic dans l'arbre → `EditView` inchangé.
