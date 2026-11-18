# GH387 — Sprint 2 : une pile par worker

## Fichiers modifiés

- `apps/desktop/e2e-web/support/stack.ts` (nouveau) — pile d'un worker : ports (libres, ou base forcée
  + 10·i), forge git HTTP, faux service d'administration et serveur web en process enfants (stderr
  préfixé `[w<i>]`), attente `/healthz`, arrêt de l'arbre de process.
- `apps/desktop/e2e-web/support/env.ts` — champs propres à la pile lus dans `<run>/stacks.json` selon
  `TEST_PARALLEL_INDEX` ; `serverEnv(stack)`.
- `apps/desktop/e2e-web/support/global-setup.ts` — repo nu de la démo cloné une fois (`<run>/seed`),
  N piles démarrées en parallèle, `stacks.json`, teardown.
- `apps/desktop/playwright.config.ts` — `workers` = `POLENTA_E2E_WORKERS` (défaut 4) ; `webServer`
  limité au serveur oidc.
- `apps/desktop/e2e-web/support/session.ts` — `baseURL` explicite, modèles sous le dossier de la pile.
- `apps/desktop/e2e-web/gh222-tree-merge.spec.ts` — R8 : titre « Merge finalisé » ciblé par son rôle
  (le texte transitoire « … (merge finalisé ou …) » correspondait aussi).
- `apps/desktop/e2e-web/gh246-render-loop.spec.ts` — GH246-1 : 60 exigences créées page fermée
  (72 s → quelques secondes), puis rechargement comme avant.
- `apps/desktop/src/renderer/hooks/useTreeEditLock.ts` — relecture annulée par react-query
  (`CancelledError`) non signalée en erreur console.

## Comportement

- Vérifié par une spec sonde (non commitée) : la config est rechargée dans chaque worker, `baseURL` et
  `E2E.*` y désignent la pile du worker ; aucun process de pile ne reste après la fin de la suite.
- Aucune dépendance entre fichiers révélée par le passage parallèle : les 3 échecs de M2 étaient des
  courses que la charge rendait visibles.

## Divergences par rapport au design

- Modification du renderer (`useTreeEditLock`) hors du périmètre « outillage seul » : console.error
  sur une relecture annulée, source d'échec instable sous charge (gh106-designate). Correctif d'une
  ligne, sans changement de comportement.
- Découvertes hors périmètre, en issues : #396 (serveur arrêté, 0xC0000409), #397 (écritures en
  rafale lentes quand l'application est ouverte).

## Mesures

`specs/GH387.md` § 6 : M2 (485 s, 3 courses), M3 (**439 s**, 384 ✓). Tests unitaires : `pnpm test` vert
(desktop 2018/2018).
