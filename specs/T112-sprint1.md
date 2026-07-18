---
ticket: T112
sprint: 1
type: sprint-summary
---

# T112 — Sprint 1 (final)

## Fichiers modifiés

- `packages/types/src/requirement.ts`, `packages/types/src/test.ts` — `createdAt`/
  `createdBy`/`updatedAt`/`updatedBy` élargis de `string` à `string | null`.
- `apps/desktop/src/main/services/git.service.ts` — nouvelle méthode `fileHistory()`
  (section `File history (git log)`) dérivant créé/modifié le/par du `git log` filtré
  sur le chemin du fichier.
- `apps/desktop/src/main/services/audit-fields.util.ts` (nouveau) — `omitAuditFields()`,
  helper partagé pour omettre les 4 champs juste avant `git.writeYaml`.
- `apps/desktop/src/main/services/requirements.service.ts`,
  `apps/desktop/src/main/services/tests.service.ts` — `create`/`update`/`openDraft`/
  `transition` ne fixent plus ces champs à la main ; `create()` les met à `null`
  (fichier neuf, aucun commit) ; `update`/`openDraft`/`transition` les laissent
  transiter tels quels via `...existing`. Correctif au passage : `TestsService.findOne`
  et `update` contournaient l'index (`git.readYaml` direct) — passent maintenant par
  `testsIndex.findById`, comme `RequirementsService` le faisait déjà.
- `apps/desktop/src/main/services/requirements-index.service.ts`,
  `apps/desktop/src/main/services/tests-index.service.ts` — `build()` appelle
  `git.fileHistory()` pour chaque fichier lu et écrase sans condition les 4 champs sur
  l'objet en mémoire.
- `apps/desktop/src/main/services/repo-watcher.service.ts` — second watcher chokidar
  scopé à `.git/HEAD` + `.git/refs/**`, invalide l'index sans condition sur tout
  changement de ref (commit/merge/rebase/checkout ne touchant aucun fichier du working
  tree, donc invisible au watcher principal).
- `apps/desktop/src/main/services/workspace.service.ts`,
  `apps/desktop/src/main/container.ts` — **découverte en cours de sprint** :
  `RepoWatcherService.watch()` n'était jamais appelé nulle part dans l'app (service
  câblé dans le conteneur DI mais jamais démarré — vrai pour le watcher principal
  existant aussi, pas seulement le nouveau). `WorkspaceService.openWorkspace()` démarre
  maintenant le watcher pour chaque repo du workspace dès qu'il est ouvert
  (`watch()` étant idempotent, sans risque à rappeler). Réordonnancement de
  `container.ts` nécessaire (`reqIndex`/`testsIndex`/`watcher` construits avant
  `workspace`, qui en a maintenant besoin).

## Comportement implémenté

Conforme à `specs/T112.md` — `createdAt`/`createdBy`/`updatedAt`/`updatedBy` ne sont
plus jamais écrits dans le YAML, dérivés du `git log` du fichier à la lecture,
`null` tant que non commité, figés sur le dernier commit tant qu'une édition n'est
pas commitée, rafraîchis en direct (sans redémarrer l'app) dès qu'un commit touche
le fichier.

## Divergences par rapport au design

Aucune divergence sur le cœur du design (`specs/T112-design.md`). Seul ajout non
anticipé : le fix de câblage du watcher (`WorkspaceService`/`container.ts`), nécessaire
pour que le point 6 du design (watcher `.git/HEAD`/`.git/refs`) produise un effet réel —
sans lui, le nouveau watcher (et l'ancien) restaient du code mort, jamais démarré.

## Comment tester manuellement

1. Ouvrir un projet, créer une exigence ou un test → le fichier YAML sur disque ne
   contient aucun des 4 champs ; l'app affiche "—" pour Créé le/Modifié le si ces
   colonnes/champs sont rendus visibles (gear "Champs visibles").
2. Commiter (panel Version) → rouvrir l'objet → dates/auteur cohérents avec le commit.
3. Éditer sans commiter → Modifié le reste sur le commit précédent.
4. Commiter l'édition → Modifié le se met à jour sans redémarrer l'app.

Vérifié via `run-desktop` (build + driver Playwright) sur `C:\Dev\polenta-demo`,
directement par appels IPC (`requirements:create`/`get`/`update`, `sync:stage-all`/
`commit`) pour isoler précisément chaque étape du cycle non-commité → commit → édition
non commitée → commit, dans une session app continue (sans redémarrage), confirmant le
rafraîchissement en direct du watcher. `pnpm typecheck` propre sur `@polenta/desktop` et
`@polenta/api-client`.
