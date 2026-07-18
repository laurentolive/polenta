# T84 — Scénarios de test

## Scénarios nominaux (golden path)

1. **"Publier" en conflit sur le repo root** : deux modifications concurrentes du même champ d'une
   même exigence sur deux branches `dev-*` distinctes issues de la même branche d'intégration ; la
   première "Publier" avec succès, la seconde échoue. La popup "Publication impossible" affiche le
   message générique existant **et** la liste des chemins de fichiers réellement en conflit (au
   moins le fichier de l'exigence modifiée des deux côtés). Cliquer "Résolution manuelle (Version)"
   navigue vers `/version-diff` avec le repo root sélectionné et le diff entre la branche `dev-*`
   courante et la branche d'intégration déjà ouvert (pas de re-sélection manuelle nécessaire).

2. **"Publier" en conflit sur un repo composant** (parcouru via `?repo=` dans la vue Système) : même
   scénario que 1, mais déclenché sur un composant. Vérifier explicitement que le repo affiché par
   `/version-diff` après le clic est bien le **composant** en conflit, pas le root — c'est le point
   que le lien `/graph` (avant ce ticket) traitait mal.

3. **Merge manuel en conflit depuis la vue Version (`graph.tsx`)** : sélectionner "merger dans…"
   entre deux branches arbitraires ayant un conflit réel. Le message affiché
   (`Conflits de merge : ...`) liste désormais les vrais fichiers au lieu d'être vide après "Conflits
   de merge : ". Aucune régression sur le comportement de succès (merge sans conflit inchangé).

## Cas limites

- **Conflit sur plusieurs fichiers simultanément** : la liste affichée dans
  `ModificationControl` et dans `graph.tsx` contient bien tous les fichiers en conflit, pas
  seulement le premier.
- **Conflit de type suppression** (`deleteByUs`/`deleteByTheirs` côté isomorphic-git — un fichier
  supprimé d'un côté, modifié de l'autre) : le fichier apparaît dans la liste au même titre qu'un
  conflit de contenu classique (pas de distinction visuelle requise, cf. hors scope de
  `T84.md`) ; à vérifier que `err.data.filepaths` inclut bien ce cas et pas seulement
  `bothModified`.
- **`err.data` absent ou de forme inattendue** (robustesse du cast optionnel) : le repli à `[]`
  préserve le comportement actuel (message générique sans liste) plutôt que de crasher ou
  d'afficher `undefined`.
- **Réessayer "Publier" sans résoudre le conflit** : échoue de nouveau avec la même liste de
  fichiers (pas de désynchronisation, pas de retry silencieux qui masquerait le problème — reprise
  du comportement déjà validé par `T83-tests.md`).
- **Cliquer "Résolution manuelle" puis revenir en arrière** : la branche `dev-*` et les
  modifications en attente de l'utilisateur ne sont pas affectées par la simple navigation vers
  `/version-diff` (lecture seule, aucune mutation déclenchée par l'ouverture de cette vue).
- **Changer de branche manuellement pendant que la popup d'échec est affichée** : comportement déjà
  couvert par l'effet existant (`ModificationControl.tsx:60-69`) qui ferme la popup au changement de
  `mode` — non-régression à vérifier, pas de nouveau code à tester spécifiquement ici.

## Vérification technique (non fonctionnelle, à faire en sprint)

- Confirmer empiriquement que `MergeConflictError` capturé par le `catch` de `merge()`/`mergeInto()`
  porte bien `.data.filepaths` à l'exécution (pas seulement dans le code source d'isomorphic-git) —
  logguer/inspecter lors d'un premier test manuel de conflit avant de considérer le correctif
  fiable.
- Confirmer que `graph.tsx` n'a effectivement besoin d'aucune modification (scénario nominal 3) —
  ne pas se contenter de l'analyse statique du design.

## Critères d'acceptation (repris de `T84.md`, formulés testables)

| # | Critère | Couvert par |
|---|---|---|
| 1 | `conflicts` non vide avec les chemins réels en cas d'échec de merge | Nominal 1, 2 — Vérification technique |
| 2 | Notification `ModificationControl` liste les fichiers en conflit | Nominal 1, 2 — Cas limite "plusieurs fichiers" |
| 3 | Lien de résolution manuelle scopé au repo réellement concerné (root ou composant) | Nominal 1, 2 |
| 4 | Merge manuel de `graph.tsx` affiche la vraie liste | Nominal 3 |
| 5 | Aucune UI de résolution champ par champ introduite | Revue de code (absence de nouveau composant de résolution) |
| 6 | TypeScript / lint : zéro nouvelle erreur | Vérification standard de fin de sprint |
