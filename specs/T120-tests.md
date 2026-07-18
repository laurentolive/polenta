# T120 — Scénarios de test

## Scénarios nominaux (golden path)

1. **Projet sans sous-composant local** (un seul `SystemNode` par repo, cas le plus courant) —
   ouvrir la Vue Système : un seul combobox "Composant" est visible, aucun combobox
   "Sous-composant" ; la liste et les libellés sont identiques à avant ce ticket.
2. **Repo à plusieurs `SystemNode` locaux** — le combobox "Composant" affiche un séparateur
   visuel (optgroup) portant l'identité du repo, et sous ce séparateur une entrée par
   `SystemNode` (root inclus), chacune libellée par son propre `label`.
3. **Sélection d'un sous-composant local** depuis le combobox fusionné : le combobox "Élément"
   et l'arbre se rechargent sur les types de ce node précis, en une seule interaction (pas de
   sélection en cascade).
4. **Lien direct existant** (`?repo=X&node=Y` sur `/product`, ou `?repo=X&component=Y` sur
   `/components`) résout exactement le même composant qu'avant ce ticket — le combobox affiche
   la bonne entrée pré-sélectionnée (dans son groupe si applicable).
5. **Restauration de dernière sélection (T52)** — fermer puis rouvrir la Vue Système (ou
   redémarrer l'app) sur un projet dont la dernière sélection pointait vers un sous-composant
   local : la sélection est restaurée à l'identique.
6. **Structure — parité visuelle** : un sous-composant local affiche une icône dédiée et un
   poids visuel de libellé comparable à une ligne de repo, tout en restant imbriqué sous son
   repo conteneur ; les actions `+ élément`/renommer/supprimer restent fonctionnelles.
7. **Création d'exigence sur un sous-composant local** sélectionné via le combobox fusionné :
   l'ID généré porte le préfixe du node réellement sélectionné (non-régression du bug corrigé en
   T113 sprint1, cf. `nextId()`/`findObjectTypeDef`).

## Cas limites

- **Schéma d'un repo pas encore chargé** (`schemasByRepoPath.get(repoPath)` retourne
  `undefined` pendant le chargement) : l'entrée du combobox pour ce repo apparaît quand même
  (repli sur le mount name, une seule entrée, pas d'optgroup) — pas de flash d'erreur, pas
  d'entrée manquante.
- **Deux repos différents partageant un nom de `SystemNode` identique** (ex. deux repos ayant
  chacun un sous-composant local nommé `turbine`) : les deux apparaissent sans collision grâce à
  la clé composite (repo + node) — sélectionner l'un ne sélectionne jamais l'autre par erreur.
- **Nom de repo ou de `SystemNode` contenant le séparateur `::`** utilisé pour la clé composite
  du combobox : vérifier qu'aucune collision ou mauvais parsing ne se produit (cf. Design,
  décision à trancher en sprint — indexation par position plutôt que parsing de chaîne si un nom
  existant contient déjà `::`).
- **Mono-repo (pas de workspace) avec plusieurs sous-composants locaux** : l'optgroup s'affiche
  normalement même s'il n'y a qu'un seul repo au total — le regroupement dépend du nombre de
  `SystemNode` de ce repo, pas du nombre de repos du workspace.
- **Suppression du dernier sous-composant local d'un repo** (retour à un seul `SystemNode`,
  `root`) : après rechargement du schéma, le combobox repasse automatiquement en une seule
  entrée sans optgroup pour ce repo, sans action manuelle supplémentaire.
- **Changement de composant avec modifications en attente** (arbre dirty, non sauvegardé) : le
  comportement de confirmation/sauvegarde existant n'est pas régressé par la fusion des
  handlers `handleRepoChange`/`handleNodeChange` en `handleComponentChange`.
- **Repo en lecture seule** (baseline figée, tag/SHA) : le bandeau d'avertissement
  (`isRepoReadonly`) continue de s'afficher normalement après sélection via le combobox fusionné,
  y compris pour un sous-composant local de ce repo.

## Critères d'acceptation vérifiables

Repris de `specs/T120.md` :

- [ ] Combobox "Sous-composant" absent de `SystemPanel.tsx`.
- [ ] Projet sans sous-composant local : liste "Composant" identique à avant (non-régression).
- [ ] Repo à plusieurs `SystemNode` : séparateur + entrées par node dans "Composant".
- [ ] Sélection d'un node local recharge Élément + arbre en une seule interaction.
- [ ] Lien direct existant (`repo`+`node`/`component`) résout le même composant qu'avant.
- [ ] Restauration T52 fonctionne à l'identique.
- [ ] Structure : icône dédiée + poids visuel de repo pour un sous-composant local.
- [ ] Aucun libellé visible utilisateur ne contient "sous-composant" (Vue Système + Structure).
- [ ] TypeScript/lint : zéro nouvelle erreur.
