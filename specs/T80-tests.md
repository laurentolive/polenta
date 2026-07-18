# T80 — Scénarios de test

## Golden path

1. Ouvrir un projet multi-composants (root + au moins 2 composants) → le panneau
   Version affiche l'arbre, le root est sélectionné et mis en évidence par défaut.
2. Cliquer sur la ligne d'un composant dans l'arbre → il devient le repo sélectionné
   (mise en évidence déplacée du root vers ce composant), le dossier s'ouvre/se ferme
   normalement selon son état précédent (comportement de clic inchangé par ailleurs).
3. Cliquer sur l'icône "Comparer" (GitCompare) du header avec ce composant sélectionné
   → `/version-diff` s'ouvre, affiche le nom du composant, les combobox Objet A/Objet B
   listent les branches/tags/commits de **ce composant** (pas ceux du root).
4. Sélectionner Objet A et Objet B, ouvrir un fichier modifié → le diff s'affiche
   normalement (comportement inchangé par rapport à l'existant, juste scopé sur le bon
   repo).
5. Toujours sur `/version-diff`, avec Objet A/B déjà choisis : cliquer sur un **autre**
   repo dans l'arbre Version (toujours visible en sidebar) → la page se met à jour
   sans reclic ni rechargement : nouvelles refs listées pour ce nouveau repo, Objet A,
   Objet B et le fichier sélectionné sont réinitialisés (retour à l'état "Sélectionnez
   deux objets").
6. Depuis `/version-diff`, cliquer sur le root dans l'arbre → même effet : refs du root
   réaffichées, sélection précédente réinitialisée.

## Cas limites

- **Lien direct avec `repoPath`** : ouvrir `/version-diff?projectId=...&repoPath=<repo
  composant>` sans être jamais passé par l'arbre → la page est scopée sur ce composant
  dès le premier rendu (combobox + nom affiché correspondent au composant, pas au
  root).
- **Lien direct sans `repoPath`** : ouvrir `/version-diff?projectId=...` seul → retombe
  sur le root (comportement actuel inchangé).
- **`repoPath` d'URL invalide** (composant retiré du workspace depuis, chemin
  inconnu) : pas de crash de la page ; les combobox affichent "Aucun résultat" (refs
  vides), le nom affiché retombe sur un fallback lisible plutôt que de planter.
- **Changement de projet ouvert** (fermer le projet courant, en ouvrir un autre) : la
  sélection retombe sur le root du nouveau projet — pas de résidu de repo sélectionné
  de l'ancien projet.
- **Changer de panel sidebar puis revenir** : sélectionner un composant dans l'arbre
  Version, basculer sur le panel Projet, revenir sur le panel Version → la sélection
  du composant est toujours active (état vit dans le contexte partagé, pas dans
  `VersionPanel`/`VersionRepoFolder`).
- **Fermer le dossier du repo sélectionné** dans l'arbre (sans en sélectionner un
  autre) → il reste le repo sélectionné (mise en évidence conservée sur la ligne
  fermée), `/version-diff` reste scopée dessus si elle est ouverte.
- **Repo root en cours de résolution** (ouverture de projet tout juste lancée,
  `api.workspace.resolve` pas encore répondu) : pas de réinitialisation intempestive
  des refs de `/version-diff` amorcées depuis l'URL — la transition `'' → repoPath du
  root` ne doit pas être traitée comme un changement de sélection déclenché par
  l'utilisateur (cf. T80-design décision 5).

## Critères d'acceptation (repris de `T80.md`)

1. Cliquer sur la ligne d'un repo dans l'arbre Version le sélectionne (mise en
   évidence visuelle) sans changer le comportement d'ouverture/fermeture existant.
2. Un seul repo est mis en évidence comme sélectionné à la fois dans l'arbre.
3. Au premier affichage du panneau Version, le root est sélectionné par défaut.
4. Fermer le dossier du repo sélectionné ne change pas la sélection.
5. Cliquer sur l'icône "Comparer" ouvre `/version-diff` avec les combobox Objet A/B
   alimentés par les refs du repo sélectionné au moment du clic (pas toujours le root).
6. `/version-diff` affiche visiblement le nom du repo ciblé.
7. Si `/version-diff` est déjà affichée et que l'utilisateur sélectionne un autre repo
   dans l'arbre Version (toujours visible en sidebar), la page se met à jour sans
   reclic ni rechargement : nouvelles refs listées, Objet A/B et fichier sélectionné
   réinitialisés.
8. Changer la sélection de repo avant d'ouvrir `/version-diff` a le même effet de
   réinitialisation que d'en changer pendant que la page est déjà ouverte.
9. Un lien vers `/version-diff` avec un paramètre d'URL `repoPath` valide ouvre la page
   scopée sur ce repo ; en son absence, retombe sur le repo root.
10. Aucune régression sur le comportement de comparaison existant pour le repo root
    (cas mono-repo actuel).

## Comment tester manuellement

1. Ouvrir un projet workspace avec au moins un composant (ex. via `apps/desktop`,
   projet de test multi-repo existant).
2. Panneau Version (icône Historique dans l'`ActivityBar`) → vérifier la mise en
   évidence par défaut du root.
3. Cliquer sur un composant, vérifier le déplacement de la mise en évidence.
4. Cliquer sur "Comparer" (icône GitCompare du header) → vérifier titre/nom affiché et
   contenu des combobox Objet A/B.
5. Sans quitter `/version-diff`, cliquer sur un autre repo dans l'arbre (sidebar
   toujours visible) → vérifier la mise à jour en direct de la page.
6. Recharger l'app (ou copier l'URL avec `repoPath`) pour vérifier l'amorçage depuis
   l'URL.
