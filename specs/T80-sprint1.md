# T80 — Sprint 1 (unique)

## Fichiers modifiés

- `apps/desktop/src/renderer/contexts/SelectedRepoContext.tsx` (**nouveau**) — état
  partagé "repo sélectionné" (`selectedRepoPath`, `rootRepoPath`, `selectRepo`).
  Consomme `useVersioning().repoPath` pour le root (pas de requête dupliquée).
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` — `deducePanel()`
  reconnaît désormais `/version-diff` comme panel `'version'` (correctif prérequis :
  sans lui, la sidebar basculait sur le panel Projet en quittant l'arbre Version pour
  la page Comparer, rendant le suivi en direct invisible). `SelectedRepoProvider` monté
  une seule fois avec `key={currentProjectId}` (remount = reset sur changement de
  projet, plus besoin d'effet de reset dédié).
- `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` — le
  clic sur une ligne sélectionne aussi le repo (`selectRepo(repoPath)`) ; la mise en
  évidence utilise `selectedRepoPath === node.repoPath` au lieu de l'ancien `isRoot`
  statique.
- `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` — l'icône "Comparer"
  ajoute `repoPath: selectedRepoPath` aux search params de navigation.
- `apps/desktop/src/renderer/routes/version-diff.tsx` — consomme `useSelectedRepo()`
  pour piloter `resolveRefs`/`diffBetween`/`diffFileBetween` ; ajoute `repoPath` à
  `validateSearch` ; affiche le nom du repo ciblé ; réinitialise Objet A/B/fichier au
  changement de repo (amorçage URL + suivi live, deux effets coordonnés par ref-guards).
- `apps/desktop/src/renderer/routes/graph.tsx` — les deux navigations existantes vers
  `/version-diff` (diff vs HEAD, diff vs branche depuis l'arbre de versions) passent
  désormais leur propre `repoPath`, découvert lors du typecheck (nouveau champ requis
  dans `validateSearch`).

## Comportement implémenté

Conforme à `specs/T80.md` et `specs/T80-design.md` : sélection d'un repo dans l'arbre
Version (même clic que l'ouverture/fermeture), suivi en direct par `/version-diff`
(refs, nom affiché, réinitialisation Objet A/B/fichier), amorçage depuis l'URL
(`repoPath`) pour les liens directs, retombée sur le root par défaut.

## Divergences par rapport au design

Le design proposait de dupliquer `['workspace', currentProjectId]` dans
`SelectedRepoContext` (comme documenté dans `T80-design.md` décision 2). Le sprint
consomme plutôt `useVersioning().repoPath` (queryKey déjà résolue un niveau au-dessus
dans `AppLayout`) — simplification identifiée en revue de code, zéro requête
supplémentaire au lieu d'une requête dupliquée. Idem pour `version-diff.tsx` : la
requête `['workspace', projectId]` locale a été supprimée au profit de `rootRepoPath`
exposé par le contexte. Le reset sur changement de projet (design : `useEffect` +
`setSelection(null)`) est devenu un remount via `key={currentProjectId}` sur
`SelectedRepoProvider` dans `AppLayout` — comportement identique, une dépendance de
moins.

## Revue de code (`/code-review high`, 8 angles)

Bug critique trouvé et corrigé (convergence indépendante des angles A, B et C) :
**`selectedRepoPath` persiste dans le contexte partagé à travers toute la session du
projet** (pas seulement le temps d'une navigation) — si l'utilisateur avait déjà
consulté un autre repo ailleurs dans l'app, ses refs pouvaient rester "chaudes" dans le
cache react-query. La résolution `ref1`/`ref2` → SHA sur `/version-diff` pouvait alors
s'exécuter contre ce **mauvais repo** avant que l'effet d'amorçage n'ait corrigé
`repoPath`, et le verrou `initializedRef` empêchait ensuite toute nouvelle tentative —
Objet A/B pouvait rester bloqué sur une valeur fausse ou jamais résolue, y compris une
fois le bon repo chargé. Corrigé en gatant l'effet de résolution sha1/sha2 sur
`seededRepoRef.current` (le repo cible doit être définitivement établi avant toute
résolution de nom de ref).

Autres correctifs appliqués (simplification/reuse, sans risque de régression) :
suppression de deux requêtes `['workspace', ...]` dupliquées (contexte + page),
suppression de l'effet de reset au profit d'un remount par `key`, fusion du montage du
provider dans `AppLayout` (dupliqué dans les deux branches avant), correction du
fallback d'affichage du nom de repo (`repoPath.slice(0,7)` — pertinent pour un SHA, pas
pour un chemin de fichier — remplacé par le dernier segment du chemin).

Findings identifiés mais non corrigés (hors scope / déjà tranché en phase Design) :
la disparition de l'indicateur visuel permanent "ceci est le root" (remplacé par la
mise en évidence de sélection) n'est pas requise par les critères d'acceptation de T78
ou T80 — non traité, mentionné ici pour trace. Le coût de `useWorkspaceStructure`
(fan-out de requêtes schema par repo) pour la seule résolution du nom affiché sur
`/version-diff` est réel en théorie mais neutralisé en pratique par le correctif
`deducePanel` : `VersionPanel` est désormais toujours monté en même temps que
`/version-diff`, donc les mêmes clés de requête sont déjà déduplquées par react-query
— pas de fetch à froid supplémentaire dans le cas visé par la remarque initiale.

## Vérification manuelle

Testé interactivement dans cette session via le driver Electron/Playwright
(`apps/desktop/.claude/skills/run-desktop`), projet fixture mono-repo
`C:/tmp/t78-test-project` :
- Panneau Version : root sélectionné et mis en évidence par défaut ✓
- Clic sur "Comparer" → `/version-diff` s'ouvre avec le panneau Version **toujours
  visible en sidebar** (correctif `deducePanel` validé en conditions réelles) ✓
- Nom du repo ("T78Test") affiché sous "Comparer" ✓
- Combobox Objet A/B alimentés par les refs du repo ciblé (branche `main`, commit
  initial) ✓
- Sélection de deux refs → liste de fichiers modifiés correcte (`M .gitignore`) ✓

Non testé faute de fixture multi-composant disponible dans cette session : le suivi en
direct proprement dit (changer la sélection dans l'arbre pendant que `/version-diff`
est déjà affichée avec un **deuxième** repo réel) et la réinitialisation Objet A/B qui
en découle. Le mécanisme (contexte partagé, effets coordonnés) est validé par le
mono-repo et par la revue de code, mais le scénario multi-repo complet attend une
validation manuelle humaine sur un workspace avec au moins un composant.

## Comment tester manuellement

1. Ouvrir un projet workspace avec au moins un composant (root + 1 composant minimum).
2. Panneau Version → vérifier la mise en évidence par défaut du root, cliquer sur le
   composant → vérifier le déplacement de la mise en évidence.
3. Cliquer "Comparer" → vérifier nom affiché + combobox scopés sur le composant.
4. Sans quitter la page, cliquer un autre repo dans l'arbre (toujours visible en
   sidebar) → vérifier la mise à jour en direct (nouvelles refs, Objet A/B/fichier
   réinitialisés).
5. Copier l'URL avec `repoPath`, recharger → vérifier l'amorçage correct.
