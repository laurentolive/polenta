# T83 — Scénarios de test

## Scénarios nominaux (golden path)

1. **Repo root sur sa branche d'intégration configurée, aucune modification en attente** :
   `ModificationControl` affiche le bouton unique "Faire une modification", indicateur de mode
   "Lecture".

2. **Cycle complet simplifié** : cliquer "Faire une modification" → popup titre uniquement →
   saisir "Fix seuils température turbo mode" → valider → branche `dev-fix-seuils-temperature-
   turbo-mode` créée et checkoutée, popup fermée, `ModificationControl` bascule immédiatement en
   "Publier"/"Annuler" + indicateur "Édition", sans navigation manuelle. Éditer une exigence
   (déjà possible aujourd'hui sur toute branche non-`int-*`, non-régression). "Publier" devient
   actif dès la première modification de fichier. Cliquer "Publier" → stage + commit (message =
   titre saisi) + merge dans la branche d'intégration → retour automatique sur la branche
   d'intégration, branche `dev-*` locale supprimée, indicateur repasse "Lecture".

3. **"Annuler" en cours d'édition** : après avoir créé la branche `dev-*` et modifié une exigence,
   cliquer "Annuler" → confirmation demandée → confirmer → modifications rejetées, retour sur la
   branche d'intégration, branche `dev-*` locale supprimée, indicateur "Lecture". L'exigence
   modifiée n'apparaît plus modifiée sur la branche d'intégration (rien n'a été mergé).

4. **Configuration de la branche d'intégration depuis la vue Projet** : dans `IntBranchSelector`,
   sélectionner une branche `int-*` existante et valider "Définir comme branche d'intégration" →
   persisté dans `config/project.yaml` → fermer et rouvrir le projet → la même branche reste
   désignée comme branche d'intégration (relue via `api.baseline.getIntegrationBranch`).

5. **Repo composant (multi-repo) parcouru dans la vue Système** : naviguer vers un composant via
   `?repo=<nom>` — `ModificationControl` reflète l'état git de **ce** repo (pas du root) ; créer
   une modification dessus crée la branche `dev-*` dans le repo composant, pas dans le root.

## Cas limites

- **Titre avec caractères spéciaux / accents / très long** : le slug généré reste un nom de
  branche git valide (minuscules, tirets, pas de caractères interdits par git), tronqué à une
  longueur raisonnable.
- **Collision de nom de branche** (`dev-<slug>` existe déjà, ex. deux modifications successives
  avec un titre identique ou très proche) : suffixe numérique automatique (`dev-<slug>-2`), pas
  d'erreur visible pour l'utilisateur.
- **"Publier" avec conflit de merge** : l'utilisateur reste sur `dev-*`, aucune perte de travail,
  notification affichée avec un lien vers la vue Version en mode avancé. Réessayer "Publier" sans
  résoudre le conflit échoue à nouveau de la même façon (pas de retry silencieux qui masquerait le
  problème).
- **"Publier" cliqué avec zéro modification en attente** : bouton désactivé, pas d'appel réseau/IPC
  déclenché.
- **Redémarrage de l'application pendant une édition en cours** : au redémarrage,
  `ModificationControl` détecte correctement le mode Édition (dérivé de la branche git courante,
  pas d'un état applicatif perdu) ; le message de commit par défaut d'un "Publier" ultérieur
  retombe sur un message générique puisque le titre saisi n'est plus en mémoire.
- **`config/project.yaml` absent ou sans `integrationBranch`** sur le repo concerné :
  `getIntegrationBranch` retombe sur `'main'` (comportement existant, repris tel quel) — si la
  branche courante n'est pas `main`, `ModificationControl` affiche l'état "autre" (ni bouton ni
  paire Publier/Annuler), pas de crash.
- **Branche courante ni la branche d'intégration configurée, ni `dev-*`** (ex. utilisateur a
  checkouté manuellement une branche arbitraire depuis le panneau Version) : `ModificationControl`
  neutre/masqué, comportement volontairement hors scope (cf. spec).
- **Changer de repo concerné pendant que `ModificationControl` est en mode Édition** (naviguer vers
  un autre composant dans la vue Système alors qu'une modification `dev-*` est en cours sur le
  repo précédent) : l'élément reflète l'état du **nouveau** repo concerné (peut redevenir "Lecture"
  ou "autre" selon son état), la modification en cours sur l'ancien repo n'est pas perdue (elle vit
  dans son propre repo git, indépendante de la navigation) — juste plus visible tant qu'on n'y
  renavigue pas.

## Suppression du flux Action (sprint 2) — non-régression

- Naviguer manuellement vers `/action/new` ou `/action/$actionId` (URL directe) : route inexistante
  (404 du routeur), cohérent avec la suppression.
- Aucune erreur TypeScript/lint résiduelle après suppression de `ActionService`/`Action`/
  `CreateActionDto`/`ActionStatus` et de leurs imports dans les fichiers listés en design.
- Les fonctionnalités de Review génériques restantes (si atteintes par un autre moyen que la route
  Action supprimée) ne régressent pas — à vérifier explicitement puisque `ReviewsService` n'est
  que partiellement nettoyé (cf. décision technique 5 du design).
- `GitService.writeYaml` ne référence plus `ActionService` ; écrire un fichier `requirements/*.yaml`
  ou `tests/*.yaml` fonctionne toujours normalement (juste sans le tracking automatique
  d'`affectedItems`, qui n'a plus de consommateur).

## Critères d'acceptation (repris de `T83.md`, formulés testables)

| # | Critère | Couvert par |
|---|---|---|
| 1 | Bouton "Faire une modification" visible uniquement sur la branche d'intégration configurée | Nominal 1 |
| 2 | Popup titre seul → création + checkout `dev-<slug>` sans navigation supplémentaire | Nominal 2 |
| 3 | Bascule immédiate en "Publier"/"Annuler" + indicateur Édition | Nominal 2 |
| 4 | Édition possible sur `dev-*`, aucune régression `isReadonly` | Nominal 2 |
| 5 | "Publier" désactivé sans modification en attente | Cas limite "Publier cliqué avec zéro modification" |
| 6 | "Publier" avec modifications : stage+commit+merge+retour Lecture+suppression branche | Nominal 2 |
| 7 | "Publier" en conflit : notification, aucune perte, lien Version avancé | Cas limite "Publier avec conflit de merge" |
| 8 | "Annuler" (confirmé) : discard+checkout+suppression branche | Nominal 3 |
| 9 | Vue Projet désigne/persiste la branche d'intégration | Nominal 4 |
| 10 | Aucune trace résiduelle du flux Action (sauf infra Review générique) | Suppression flux Action — tous les points |
| 11 | TypeScript / lint : zéro nouvelle erreur | Suppression flux Action — 2e point |
