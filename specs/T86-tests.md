# T86-tests — Scénarios de test

## Scénarios nominaux (golden path)

1. **Sidebar Projet allégée** — ouvrir un projet, panneau latéral "Projet" : seule l'entrée "Modèle de données" est visible. Ni "Tableau de bord" ni "Droits" n'apparaissent.
2. **Atterrissage par défaut** — depuis l'écran d'accueil, ouvrir un projet existant (bouton "Ouvrir") : l'app atterrit sur `/schema` (onglet Structure), pas d'écran blanc ni d'erreur de résolution de `repoPath`.
3. **Redémarrage à froid** — fermer l'app avec un projet ouvert, la relancer : elle rouvre directement sur `/schema` du dernier projet (comportement équivalent à l'ancien atterrissage sur `/project/$id`).
4. **Clone / création de projet** — cloner un repo existant ou créer un nouveau projet depuis l'écran d'accueil : atterrit sur `/schema`.
5. **Lien "Récents"** — cliquer un projet dans la liste "Récents" de l'écran d'accueil : atterrit sur `/schema` de ce projet.
6. **Icône Projet de l'ActivityBar** — depuis n'importe quel autre panneau (Version, Système…), cliquer l'icône "Projet" : revient sur `/schema` du projet courant.
7. **Boutons "Retour"** — depuis une vue exigence (`req.$reqId`, `req.new`) ou test (`test.$testId`, `test.new`), cliquer "Retour" : revient sur `/schema`, pas d'erreur.
8. **Branche d'intégration déplacée** — dans l'onglet Structure, la ligne du repo root affiche en dessous d'elle le widget "Branche d'intégration" (et non plus "Baseline") avec la liste des branches `int-*`, le bouton "Définir comme branche d'intégration" quand applicable, et le sous-texte "Intégration configurée : …" — comportement identique à l'ancien `IntBranchSelector` de la page Tableau de bord (avant suppression).
9. **Sélecteur de branche par repo — checkout** — dans l'onglet Structure, sur une ligne de repo (root ou composant) dont la branche courante n'est ni `dev-*` ni verrouillée par des modifications en attente, choisir une autre branche existante dans le sélecteur inline : le repo est réellement checkout (vérifiable via le panneau Version, qui reflète la même branche).
10. **Sélecteur de branche par repo — création** — depuis ce même sélecteur, créer une nouvelle branche : la branche est créée et checkout, apparaît ensuite dans le panneau Version pour ce repo.
11. **Checkout inline = même pin que la modale "Modifier"** — sur un composant (non-root), checkout une branche via le sélecteur inline de l'arbre Structure, puis ouvrir la modale "Modifier" (crayon) de ce même composant : le champ "Branche" y reflète la branche fraîchement checkout (pas de désynchronisation entre les deux chemins d'édition).

## Cas limites

12. **Branche courante `dev-*`** — un repo (root ou composant) est actuellement sur une branche `dev-*` (modification en cours, T83) : le sélecteur inline de l'arbre Structure n'affiche **aucun** menu déroulant, uniquement le nom de la branche en lecture seule. Aucune interaction de checkout/création n'y est possible.
13. **Branche courante `int-*`** — le repo est sur une branche `int-*` : le sélecteur inline reste utilisable pour choisir/créer une autre branche (pas de restriction sur le sélecteur lui-même), mais l'édition du contenu du repo reste en lecture seule ailleurs dans l'app (comportement déjà existant, non modifié par ce ticket — juste vérifier l'absence de régression).
14. **Repo avec modifications en attente (staged/unstaged), hors `dev-*`** — tenter un checkout depuis le sélecteur inline : comportement identique à celui déjà en place dans le panneau Version (`VersionRepoFolder`) pour ce même repoPath, puisque `useBranchCheckout` est un hook partagé — pas de garde supplémentaire à inventer ici.
15. **Repo interface** (`node.isInterface`) — le sélecteur de branche s'affiche aussi sur les lignes d'interface, pas seulement les composants classiques.
16. **Conflit diamant annulé** — provoquer un diamond-conflict (ex: ajouter une dépendance créant un conflit), cliquer "Annuler" dans `DiamondConflictModal` : la modale se ferme, l'utilisateur reste sur l'onglet Structure (pas de navigation vers une route supprimée, pas d'écran blanc).
17. **`repoPath` absent au premier rendu de `/schema`** — naviguer vers `/schema` avec seulement `projectId` en search param (pas de `repoPath`) : la page résout `repoPath` elle-même (via `api.workspace.resolve`) sans erreur ni flash de contenu vide prolongé, une fois résolu l'arbre Structure se charge normalement.
18. **`useVersioning` scope root** — le widget "Branche d'intégration" (affiché uniquement sur la ligne root) montre bien le bandeau "Lecture seule" quand la branche root courante est `int-*`, cohérent avec le comportement déjà existant avant déplacement.

## Non-régression

19. **Panneau Version inchangé** — après extraction de `useBranchCheckout`, le panneau latéral Version (`VersionRepoFolder`) se comporte exactement comme avant : checkout, création, suppression de branche pour n'importe quel repo (y compris sur une branche `dev-*` ou `int-*` — aucune restriction n'y est ajoutée, contrairement au nouveau sélecteur de l'arbre Structure).
20. **Workflow "Faire une modification" / "Publier" / "Annuler" (T83)** — inchangé, aucun des boutons ni de la logique `useModificationMode` n'est touché par ce ticket.
21. **Mécanisme de baseline réel** — la route `/baseline` (git tag, snapshot) et son accès depuis le panneau Version restent inchangés et fonctionnels ; aucune confusion introduite avec le widget "Branche d'intégration" renommé.
22. **Dashboards personnalisables ("Suivi", T77)** — non affectés, aucune référence croisée avec ce ticket.
23. **Zéro référence résiduelle** — recherche globale de `/project/$id` dans le code source après implémentation : aucune occurrence restante (hors historique git), `routeTree.gen.ts` régénéré sans cette route.

## Critères d'acceptation (rappel, cf. `T86.md`)

- [ ] "Tableau de bord" et "Droits" ont disparu de `ProjectPanel.tsx`
- [ ] Route `/project/$id` et `SyncBar.tsx` supprimés, aucune référence résiduelle
- [ ] Widget "Branche d'intégration" fonctionnel sur la ligne root de l'arbre Structure
- [ ] Sélecteur de branche par repo (root + composants + interfaces) avec checkout/création réels
- [ ] Sélecteur en lecture seule sur une branche `dev-*`
- [ ] Checkout inline et modale "Modifier" partagent le même pin, pas de désynchronisation
- [ ] Aucune régression sur "Publier"/"Annuler" (T83) ni sur la route `/baseline`
