# GH40 — Scénarios de test

Pas de tests automatiques renderer dans le projet : vérification = `typecheck` + scénarios manuels
dans l'application, sur un workspace multi-repo (root + ≥ 1 composant).

## Panneau Version

| # | Scénario | Attendu |
|---|----------|---------|
| V1 | Cliquer l'icône graphe d'un composant (repo non sélectionné) | `/graph` s'ouvre sur le composant ; le composant est surligné comme sélectionné ; le dossier ne change pas d'état replié/déplié |
| V2 | Puis cliquer l'icône graphe du header | `/graph` reste sur le composant (sélection inchangée) |
| V3 | Icône graphe du root depuis `/baseline` | retour au graphe du root, panneau ré-affiche l'arbre |
| V4 | Repo propre, déplié | une seule ligne « Rien à commiter » ; aucune section Stagés/Modifications |
| V5 | Modifier un fichier (non stagé) | section Modifications seule, avec `+` / `↩` ; « Rien à commiter » disparaît |
| V6 | Stager tous les fichiers | section Stagés seule, avec `Commit…` / `−` |
| V7 | Stager une partie | les deux sections, séparées par une bordure |
| V8 | Commit sur un composant dont le root dépend (pin propagé manuellement) | après commit la section Stagés disparaît, l'avertissement de propagation de pin reste visible jusqu'au clic sur « fermer » |
| V9 | Ouverture du panneau / changement de projet | pas de flash « Rien à commiter » avant chargement du statut |
| V10 | Densité | ligne de repo ≤ 28 px, ligne de fichier ≤ 20 px (DevTools) ; combobox branche, Rafraîchir, graphe toujours cliquables et non tronqués ; arbre à 3 niveaux lisible à la largeur min du panneau |
| V11 | Ahead > 0 | ligne « N commit(s) à pousser » + Pousser affichée même si « Rien à commiter » |
| V12 | Repo replié | pastille de modifications en attente inchangée |

## Baselines

| # | Scénario | Attendu |
|---|----------|---------|
| B1 | Icône Baselines du header | `/baseline` ; panneau titré « Baselines » avec filtre + liste ; vue de droite = formulaire, sans popup |
| B2 | Aucune baseline | panneau : « Aucune baseline » ; formulaire utilisable |
| B3 | Filtre sur un tag puis sur un mot du message | liste filtrée ; aucun résultat → « Aucune baseline ne correspond au filtre » |
| B4 | Clic sur une baseline | dépliage sur place des composants (nom → tag) ; vue de droite inchangée ; baseline sans composant → « aucun composant » |
| B5 | Corbeille au survol → confirmer | modal de confirmation ; baseline retirée du panneau ; tags supprimés |
| B6 | Tous les repos propres, tag pré-rempli → Créer | baseline créée, apparaît en tête du panneau ; bandeau « Baseline vX créée » ; tag passe au suivant ; message vidé |
| B7 | `Ctrl+Entrée` dans le message | crée la baseline (si autorisé) ; `Entrée` seule insère un retour à la ligne ; `Entrée` dans le champ tag ne crée rien |
| B8 | Un repo avec modification en attente | readiness en rouge avec raison ; bouton désactivé ; `Ctrl+Entrée` sans effet |
| B9 | Saisir un tag déjà utilisé par une baseline / existant sur un repo | avertissements affichés ; bouton désactivé |
| B10 | Tag vide | bouton désactivé |
| B11 | Erreur de création (ex. tag refusé par git) | message d'erreur dans le formulaire ; saisie conservée |
| B12 | Quitter `/baseline` (graphe, retour, autre panneau puis retour sur Version) | panneau ré-affiche l'arbre des repos ; revenir via l'onglet Baseline ré-affiche la liste |
| B13 | Changer de langue en/fr | nouveaux libellés traduits |

## Non-régression
- Vue Comparer (`/version-diff`) : sélecteur toujours affiché dans le panneau.
- Commit, push, pull, discard, checkout de branche depuis l'arbre : inchangés.
- `pnpm --filter desktop typecheck` : zéro erreur nouvelle.
