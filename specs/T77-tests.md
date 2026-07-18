# T77 — Scénarios de test

**Branche** : T77
**Worktree** : `../polenta-T77/`

---

## Scénarios nominaux (golden path)

### Sprint 1 — Requêtes

1. **Créer une requête via le builder** : ouvrir l'onglet dédié → vue Requêtes → sélectionner un type d'objet (ex. `exigence-systeme`) → ajouter une condition (`priority = high`) → le résultat s'affiche dans la table.
2. **Basculer en SQL avancé** : depuis une requête builder, basculer en mode SQL → le SQL généré équivalent est pré-rempli et modifiable → exécuter → même résultat (ou affiné).
3. **Sauvegarder une requête** : depuis un résultat courant → bouton Sauvegarder → titre + portée (privée) → apparaît dans la liste "Requêtes sauvegardées" du panneau latéral.
4. **Historique** : exécuter 3 requêtes différentes → la liste "Historique" affiche les 3, plus récente en premier → cliquer sur une entrée → recharge la requête dans l'éditeur adapté (builder ou SQL) avec le résultat actuel recalculé.
5. **Filtrer les listes** : taper un mot dans le filtre texte de "Requêtes sauvegardées" → seules les entrées correspondantes (titre ou contenu) restent visibles ; idem pour "Historique".
6. **Export Excel** : depuis un résultat → bouton Exporter → fichier `.xlsx` généré contenant les colonnes et lignes affichées.

### Sprint 2 — Widgets et Dashboards

7. **Créer un dashboard privé** : panneau latéral section "Dashboards" → Ajouter → titre → dashboard vide créé, sélectionné.
8. **Ajouter un widget** : dans un dashboard → Ajouter un widget → popup : titre, sélection d'une requête sauvegardée, type "barres", mapping catégorie/mesure → aperçu live s'actualise en fonction des choix → Enregistrer → le widget apparaît dans la grille.
9. **Réordonner** : glisser un widget avant un autre dans la grille → l'ordre est persisté (`widgetOrder`) après rechargement de la vue.
10. **Réordonner les sections latérales** : glisser une requête ou un dashboard dans le panneau latéral → l'ordre est conservé après rechargement.
11. **Partager un dashboard valide** : dashboard privé dont tous les widgets référencent des requêtes déjà partagées → passer le dashboard en "partagé" → réussi, fichier créé dans `dashboards/`.

### Sprint 3 — Dashboards pré-configurés

12. **Premier accès à l'onglet (dossier `dashboards/` vide)** : les 3 dashboards par défaut (Couverture, Avancement, Maturité) sont créés automatiquement et visibles dans le panneau latéral, portée partagée.
13. **Dashboard Maturité** : affiche un taux global cohérent avec le nombre d'exigences non conformes à au moins un critère (vérifiable manuellement sur un petit jeu de données).
14. **Retrait de l'ancien tableau de bord** : ouvrir la page Projet → plus de StatCards/répartitions/récemment modifiées ; le sélecteur de baseline et la `SyncBar` sont toujours présents.

---

## Cas limites

- **Aucune requête sauvegardée / historique vide** : les deux listes affichent un état vide explicite (pas une liste blanche muette).
- **Requête SQL invalide** (erreur de syntaxe) : message d'erreur affiché dans la vue Requêtes, pas de crash, pas de résultat périmé conservé à l'écran sans indication.
- **Requête SQL contenant une instruction interdite** (`INSERT`, `DELETE`...) : rejetée avant exécution avec un message explicite.
- **Entrée d'historique devenue invalide** (référence un champ/type supprimé du schéma depuis) : purgée automatiquement, n'apparaît plus dans la liste au chargement suivant.
- **Suppression d'une croix d'historique** : suppression immédiate, sans confirmation (cohérent avec la nature "jetable" de l'historique).
- **Suppression d'une requête utilisée par un widget** : bloquée, message listant le(s) dashboard(s)/widget(s) dépendants (partagés + privés de l'utilisateur courant).
- **Rétrogradation d'une requête partagée utilisée par un widget partagé** : bloquée, même message de dépendants.
- **Widget dont la requête sous-jacente a été supprimée entre-temps** (ne devrait pas arriver grâce au blocage ci-dessus, mais à vérifier en défense) : affichage d'un état "requête introuvable" plutôt qu'un crash du widget.
- **Ajout de widget dans un dashboard partagé** : le sélecteur de requête ne propose que les requêtes `scope: shared` — vérifier qu'une requête privée de l'utilisateur n'apparaît pas dans la liste, même s'il en est l'auteur.
- **Tentative de partage d'un dashboard avec au moins un widget référençant une requête privée** : bloquée avec message explicite désignant le(s) widget(s) fautif(s).
- **Résultat de requête vide (0 ligne)** : le widget affiche un état vide plutôt qu'un chart cassé (ex. camembert sans données).
- **Résultat à une seule colonne/une seule valeur** utilisé dans un widget "table" ou "barres" (combinaison inhabituelle, désormais permise sans contrainte) : ne doit pas crasher, doit s'afficher sans erreur même si peu lisible — l'aperçu live sert justement à laisser l'utilisateur s'en rendre compte.
- **Périmètre multi-composants** : requête filtrant sur `component = 'x'` où `x` n'est pas un composant du projet courant → résultat vide, pas d'erreur.
- **Utilisateur sans aucun projet/composant submodule** (repo produit simple, sans submodule) : le moteur de requête fonctionne sur le seul repo courant, colonne `component` absente ou constante — pas de régression pour un projet mono-repo.

---

## Critères d'acceptation vérifiables

Repris et détaillés depuis `specs/T77.md` § Critères d'acceptation — chaque case doit être vérifiable manuellement via les scénarios ci-dessus à la fin du sprint correspondant.

- Sprint 1 : scénarios 1–6 passent, plus les cas limites "requête invalide", "instruction interdite", "historique invalide purgé", "listes vides".
- Sprint 2 : scénarios 7–11 passent, plus les cas limites de blocage de suppression/rétrogradation/partage.
- Sprint 3 : scénarios 12–14 passent.
