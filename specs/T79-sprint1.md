# T79 — Sprint 1 (dernier sprint)

## Fichiers modifiés

- `apps/desktop/src/main/services/git.service.ts` — nouvelle méthode `getIntegrationBranch(repoPath)`
  (lit `config/project.yaml` → `integrationBranch`, fallback `'main'`).
- `apps/desktop/src/main/services/action.service.ts` — `readIntegrationBranch` (privé) délègue
  désormais à `GitService.getIntegrationBranch` au lieu de dupliquer la lecture YAML.
- `apps/desktop/src/main/ipc/index.ts` — nouveau handler `baseline:get-integration-branch`.
  Handler `baseline:create` **réécrit** (voir "Divergences" ci-dessous) : itère désormais
  `dto.components` (au lieu de tous les nœuds de `workspaceTree.readCache`) et ne renvoie dans
  `record.components` que les composants effectivement tagués avec succès.
- `packages/api-client/src/types.ts` / `ipc-client.ts` — exposition de
  `ApiClient.baseline.getIntegrationBranch(repoPath)`.
- `apps/desktop/src/renderer/routes/baseline.tsx` — réécriture : section "État des repos" (une
  ligne par repo du workspace, ✓/✗ + raison), vérification d'unicité du tag étendue à tous les
  repos, construction de `dto.components` + `workspaceDir` dans `createMutation`, avertissement
  non bloquant si des composants n'ont pas pu être tagués, message d'erreur/conflit de dépendances
  repris de `useWorkspaceStructure` (au lieu d'un "Vérification…" indéfini).
- `specs/SPEC-FORKS-BRANCHES-BASELINES.md` — §5.2 (nouvelle condition bloquante multi-repo),
  §5.3 (note sur la structure réelle de `components`, plus simple que
  `BaselineComponentSnapshot`).
- `specs/SPEC-INDEX.md` — colonne `MAJ` de la ligne `SPEC-FORKS-BRANCHES-BASELINES.md §5` → `T79`.

## Comportement implémenté

Conforme à `specs/T79.md` et `specs/T79-design.md`. Avant de pouvoir créer une baseline, la page
affiche l'état de chaque repo du workspace (root + composants + interfaces, via
`useWorkspaceStructure`) : branche courante vs branche d'intégration configurée
(`config/project.yaml`), présence de modifications en attente. Tant qu'un repo est en défaut, la
création est bloquée et le repo est listé avec sa raison. Une fois tous les repos prêts, un tag de
même nom est posé sur chaque repo à sa propre HEAD ; la baseline créée liste dans `components`
uniquement les composants effectivement tagués. La vérification d'unicité du tag (déjà existante
pour le root) couvre désormais tous les repos du workspace.

## Divergences par rapport au design

Trois ajustements identifiés pendant `/code-review high` (8 angles), tous des corrections de bugs
introduits par cette implémentation plutôt que des changements de périmètre :

1. **`baseline:create` réécrit pour suivre le succès réel par composant.** Le design ne prévoyait
   aucun changement à ce handler (déjà écrit pour T69 sprint 3). La revue a montré que
   `record.components` était construit par un simple `dto.components.map(...)`, sans tenir compte
   du résultat du `try/catch` de tag au-dessus — le champ `components` de la baseline créée
   contenait donc toujours l'intégralité des composants demandés, même si certains avaient échoué
   à être tagués. Le nouvel avertissement `tagWarning` de `baseline.tsx` (`record.components.length
   < componentNodes.length`) était donc du code mort : cette comparaison ne pouvait jamais être
   vraie. Corrigé en réécrivant la boucle pour itérer `dto.components` (plutôt que tous les nœuds
   de `workspaceTree.readCache`, une lecture séparée et potentiellement périmée par rapport à ce
   que l'utilisateur a validé comme "prêt") et ne pousser dans `record.components` que les
   composants réellement tagués avec succès.
2. **`readinessLoading` incluait `statusQueries`/`integrationBranchQueries` mais pas
   `tagsQueries`.** Un repo pouvait donc passer "prêt" (bouton actif) avant que ses tags existants
   aient fini de charger, laissant une fenêtre où un conflit de tag réel sur un composant n'était
   pas encore détecté. Corrigé : `loading` par repo inclut désormais les trois requêtes ; le champ
   `errored` (redondant avec `!status`/`!integrationBranch`, relevé en revue) a été supprimé au
   passage.
3. **`baseline.tsx` ne surfaçait pas `error`/`conflicts` de `useWorkspaceStructure`.** Dans un
   workspace en conflit de dépendances (diamant) ou dont le manifeste ne parse pas, `flatNodes`
   restait `[]` indéfiniment et la section "État des repos" affichait "Vérification…" sans jamais
   se résoudre, sans indice pour l'utilisateur — contrairement à `VersionPanel` qui affiche ces
   états pour le même `workspaceDir`. Corrigé en reprenant le même message ("conflit de
   dépendances, résoudre depuis l'onglet Structure") que `VersionPanel`.

Un point d'efficacité relevé en revue a aussi été corrigé sans changer le comportement observable :
`refreshReadiness()` et le `onSuccess` de `createMutation` invalidaient les query keys un repo à la
fois (`3×N` puis `N` appels) ; remplacé par une invalidation par préfixe de famille (`['sync:status']`,
`['sync:tags']`, `['baseline:integration-branch']`), react-query matchant par défaut toute entrée
dont la clé commence par ce préfixe.

**Non retenu** (relevé en revue mais délibérément non traité dans ce sprint, cohérent avec les
décisions déjà actées en phase Design) :
- Duplication de la logique "repo dirty" (`staged.length + unstaged.length > 0`) entre
  `readinessIssue` (baseline.tsx) et `VersionRepoFolder.tsx` — pas de hook partagé introduit ; le
  périmètre T79 ne justifiait pas une extraction pour un unique second call site.
- Namespace IPC `baseline:get-integration-branch` plutôt qu'un namespace générique — décision
  explicite du design (YAGNI, cf. `T79-design.md` décision technique 1). Si T83 (workflow
  "Publier") a besoin de la même donnée, ce sera le moment de généraliser.
- Pas de re-vérification de la readiness au moment précis du clic sur "Créer la baseline" (fenêtre
  de course entre le dernier fetch et la soumission) — même limitation que la vérification
  d'unicité de tag pré-existante ; le bouton "Rafraîchir" explicite est la mitigation voulue (design
  décision 3, pas de polling continu sur cette page).

## Mises à jour SPEC

- `SPEC-FORKS-BRANCHES-BASELINES.md` §5.2 : ajout de la condition bloquante multi-repo (branche
  d'intégration + absence de modification en attente, par repo), non contournable contrairement
  aux avertissements existants.
- `SPEC-FORKS-BRANCHES-BASELINES.md` §5.3 : note sur la structure réelle de `components`
  (`{name, tag}`, cf. `BaselineComponentRecord`) — plus simple que la structure logique
  `BaselineComponentSnapshot` documentée, et qui n'omet que les composants dont le tag a
  effectivement échoué.
- `SPEC-INDEX.md` : colonne `MAJ` de `SPEC-FORKS-BRANCHES-BASELINES.md §5` → `T79`.
- `SPEC-SYSTEM-VIEW.md` §global (référencé dans `## Refs SPEC` de `T79.md`) : aucune mise à jour —
  vérifié, ce fichier ne mentionne pas `baseline.tsx` ni de logique spécifique à cette page, il
  documente uniquement le pattern général d'arbre/repo réutilisé (même conclusion que T78
  sprint1 pour ce même fichier).

## Comment tester manuellement

1. Ouvrir un projet Polenta mono-repo (pas de composant) : la section "État des repos" affiche une
   seule ligne (root). Créer une baseline avec un tag libre doit fonctionner comme avant T79 (non-
   régression).
2. Ouvrir un workspace avec au moins un composant, composant sur sa branche d'intégration
   configurée sans modification en attente : la section affiche toutes les lignes en ✓, le bouton
   "Créer la baseline" est actif dès qu'un tag valide est saisi. Créer la baseline, vérifier
   `git tag` dans le repo du composant (pas seulement le root), et que l'élément déplié dans
   "Baselines existantes" liste ce composant.
3. Checkout un composant sur une branche différente de sa branche d'intégration configurée (depuis
   le panneau Version) : revenir sur la page Baseline, cliquer "Rafraîchir" — la ligne du composant
   passe en ✗ avec la raison ("sur X, attendu Y"), le bouton "Créer la baseline" est désactivé.
4. Modifier un fichier dans un composant sans committer : même comportement, raison "modifications
   en attente".
5. Saisir un tag déjà utilisé comme tag git sur un composant (mais pas sur le root) : message
   d'avertissement listant ce composant, création bloquée.
6. Provoquer un conflit de dépendances (diamant) dans le workspace : la section "État des repos"
   affiche le message de conflit (au lieu de "Vérification…" indéfiniment), bouton désactivé.
