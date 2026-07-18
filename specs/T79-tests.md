# T79 — Scénarios de test

## Scénarios nominaux (golden path)

1. **Workspace mono-repo (pas de composant/interface déclaré)** : la section "État des repos"
   n'affiche qu'une ligne (root). Si le root est sur sa branche d'intégration configurée sans
   modification en attente, le bouton "Créer la baseline" est actif dès qu'un tag valide est
   saisi — comportement identique à aujourd'hui (non-régression).

2. **Workspace avec 2 composants, tous conformes** (chacun sur sa branche d'intégration
   configurée, aucune modification en attente) : la section "État des repos" affiche 3 lignes
   toutes ✓, le bouton "Créer la baseline" est actif. Créer la baseline pose un tag de même nom
   sur les 3 repos (chacun à sa propre HEAD). La baseline listée dans la colonne de droite,
   dépliée, affiche les 2 composants avec leur tag.

3. **Un composant sur la mauvaise branche** : la section "État des repos" marque ce composant en
   défaut avec sa branche courante et la branche attendue ; le bouton "Créer la baseline" est
   désactivé tant que ce repo n'est pas remis sur sa branche d'intégration (checkout depuis le
   panneau Version, puis retour sur la page Baseline → l'état se met à jour après rafraîchissement).

4. **Un composant avec des modifications en attente** (stagées ou non) : même comportement que le
   scénario 3, raison affichée "modifications en attente" au lieu de "mauvaise branche".

5. **Tag déjà utilisé sur un composant mais pas sur le root** : la saisie du tag affiche
   l'avertissement existant étendu ("Ce tag git existe déjà sur `<nom du composant>`"), création
   bloquée même si le root est libre.

## Cas limites

- **`config/project.yaml` absent ou sans `integrationBranch`** sur un repo composant :
  `getIntegrationBranch` retombe sur `'main'` (comportement déjà existant côté
  `ActionService.readIntegrationBranch`, repris tel quel) — le repo est considéré en défaut si sa
  branche courante n'est pas `main`, pas de crash.
- **`api.sync.status` en erreur pour un composant** (repo déclaré mais dossier absent sur disque —
  même cas que T78 décision 9) : le repo est traité comme en défaut (impossible de prouver la
  conformité), affiché avec une raison distincte ("état illisible") plutôt que de bloquer
  silencieusement ou de crasher la page.
- **Beaucoup de repos (10+)** : les requêtes `sync:status`/`baseline:get-integration-branch`/
  `sync:tags` se déclenchent en parallèle via `useQueries`, sans regroupement — cohérent avec la
  décision déjà prise pour T78 de ne pas batcher tant qu'un problème de perf réel n'est pas
  constaté.
- **Un composant échoue à être tagué pendant la création** (race condition post-validation) : la
  baseline est quand même créée (comportement du handler conservé), message d'avertissement non
  bloquant si `components.length` créé est inférieur au nombre de repos hors-root attendus.
- **Rafraîchir l'état pendant que le formulaire est rempli** : invalider les query keys
  status/integration-branch/tags ne réinitialise pas le champ tag saisi par l'utilisateur.

## Critères d'acceptation (repris de `T79.md`, formulés testables)

| # | Critère | Couvert par |
|---|---|---|
| 1 | Liste des repos + état visible avant tentative de création | Nominal 1, 2 |
| 2 | Création bloquée si repo en défaut (branche ou modifs en attente), avec raison affichée | Nominal 3, 4 |
| 3 | Tag posé sur chaque repo à sa propre HEAD une fois tous conformes | Nominal 2 |
| 4 | Baseline listée avec `components` non vide après création | Nominal 2 |
| 5 | Unicité du tag vérifiée sur tout le workspace, pas seulement le root | Nominal 5 |
| 6 | Cas mono-repo inchangé (non-régression) | Nominal 1 |
| 7 | Échec de tag isolé sur un composant n'empêche pas la création, averti non bloquant | Cas limite "composant échoue à être tagué" |
