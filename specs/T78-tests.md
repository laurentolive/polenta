# T78 — Scénarios de test

## Scénarios nominaux (golden path)

1. **Workspace mono-repo (pas de composant/interface déclaré)** : l'arbre affiche un seul
   dossier "root", ouvert par défaut et mis en évidence. Committer/stager/désindexer/
   annuler/checkout se comportent exactement comme l'actuel `VersionPanel` (non-régression).

2. **Workspace avec 2 composants** : l'arbre affiche 3 dossiers (root + 2 composants),
   tous ouverts par défaut, seul le root est mis en évidence.

3. **Détection dirty sans ouvrir** : modifier un fichier dans le repo d'un composant en
   dehors de l'app (ex. éditeur externe), attendre ≤3s (intervalle de polling) → le badge
   dirty apparaît sur le dossier fermé de ce composant, sans qu'il ait été ouvert.

4. **Stage/commit scopé à un composant** : ouvrir le dossier d'un composant dirty → la
   liste Modifications montre les bons fichiers (et seulement ceux de ce repo) → stager un
   fichier → il passe dans Stagés → committer → le badge dirty disparaît (fermé) et les
   listes se vident (ouvert).

5. **Checkout scopé à un composant** : dans le dossier ouvert d'un composant, sélectionner
   une autre branche via le combobox → seul ce repo change de branche ; la branche du root
   et des autres composants reste inchangée (vérifier via leur propre vignette checkout).

6. **Deux dossiers ouverts en parallèle, indépendance** : ouvrir root et un composant en
   même temps, avoir des modifications non liées dans chacun → stager un fichier dans l'un
   n'affecte ni la liste ni les compteurs de l'autre ; ouvrir la modale de commit sur l'un
   n'empêche pas d'interagir avec l'autre dossier.

7. **Badge persistant dossier fermé** : stager (mais ne pas committer) un fichier dans un
   composant, puis refermer son dossier → le badge dirty reste affiché (le stage compte
   comme modification en attente).

## Cas limites

- **Erreur de résolution du workspace** (`useWorkspaceStructure.error` non nul — ex.
  conflit diamant, répertoire non reconnu) : le message d'erreur existant s'affiche,
  l'arbre ne crashe pas (mêmes garde-fous que `StructureTab`).
- **Repo composant non résolvable** (déclaré mais dossier absent/`sync.status` échoue) :
  vignette checkout vide (`—`), pas de badge dirty, pas de crash — le dossier reste
  ouvrable mais sans contenu Stagés/Modifications exploitable.
- **Workspace avec beaucoup de repos** (10+) : toutes les requêtes `status`/`branches`/
  `tags` se déclenchent en parallèle au montage du panneau — vérifier qu'il n'y a pas de
  blocage UI perceptible ; pas d'optimisation de regroupement attendue dans ce sprint.
- **Checkout avec modifications en attente sur un composant (pas le root)** : la modale de
  confirmation ("Forcer le checkout ?") s'affiche scopée à ce repo précis, sans affecter
  l'état des autres dossiers ouverts.
- **Fermeture du panneau Version pendant que des dossiers sont ouverts** : changer d'onglet
  sidebar puis revenir sur Version → l'état repart du défaut (tout ouvert, root en
  évidence) ; pas de persistance de l'état ouvert/fermé attendue (contrairement à T52 pour
  la vue Système, non demandée ici).
- **Fermeture du panneau arrête le polling** : changer d'onglet sidebar → aucune requête
  `sync:status` résiduelle pour les repos composants (root peut continuer de poller via
  `VersioningContext`, qui est global et hors scope T78).
- **Repo interface (`isInterface: true`)** : dossier affiche l'icône dédiée (`GitFork`,
  cohérent avec `RepoRow`), le checkout fonctionne de façon identique à un composant
  standard — aucune restriction de lecture seule appliquée ici (le champ
  `SystemNode.readonly` du schéma ne concerne que l'édition d'éléments, pas le contrôle de
  version du repo).

## Critères d'acceptation (repris de `T78.md`, formulés testables)

| # | Critère | Couvert par |
|---|---|---|
| 1 | Arbre liste tous les repos du workspace | Nominal 2 |
| 2 | Dossier fermé affiche réf + badge dirty sans ouverture | Nominal 3, 7 |
| 3 | Actions scopées uniquement au repo du dossier ouvert | Nominal 4, 5, cas limite "checkout avec modifs" |
| 4 | Deux dossiers ouverts sans interférence d'état | Nominal 6 |
| 5 | Tous ouverts par défaut, root en évidence, au premier affichage | Nominal 1, 2 |
| 6 | Fermer le panneau arrête le polling par repo | Cas limite "fermeture arrête le polling" |
| 7 | Bouton "Publier" absent | Revue visuelle directe (pas de scénario dédié — vérification statique du rendu) |
| 8 | Pas de régression sur le repo root vs `VersionPanel` actuel | Nominal 1 |
