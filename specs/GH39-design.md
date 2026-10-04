# GH39 — Design technique

Spec : `specs/GH39.md`. Deux sprints.

## Découpage

| Sprint | Périmètre |
|---|---|
| 1 | Backend (`SyncService` : état d'intégration, resynchronisation, auto-sync), IPC + api-client, "Publier" (pré-contrôle divergence, merge d'origin, `dev-resync` publiable, pas de commit vide), auto-pull (fetch systématique, relance du push, dernière erreur mémorisée) |
| 2 | UI : pastille d'en-tête + popover, badge `↑N ↓M` et bouton Resynchroniser dans le panneau Version, masquage pendant le push post-Publier, i18n, mise à jour SPEC |

## Backend — `apps/desktop/src/main/services/sync.service.ts`

```ts
export type IntegrationRemoteStateKind = 'no-remote' | 'up-to-date' | 'behind' | 'ahead' | 'diverged'
export interface IntegrationRemoteState { state: IntegrationRemoteStateKind; ahead: number; behind: number }
export type ResyncOutcome =
  | { outcome: 'up-to-date' | 'fast-forwarded' | 'pushed' | 'merged' }
  | { outcome: 'set-aside'; branch: string }
```

- `integrationState(repoPath, branch, remote='origin')` — **local, sans réseau** (refs du dernier
  fetch). Pas de remote / pas de `refs/heads/<branch>` / pas de `refs/remotes/origin/<branch>` →
  `no-remote`. Sinon `isDescendent` dans les deux sens pour l'état, comptes `ahead`/`behind` par
  différence d'ensembles de `git.log` (profondeur 500, même méthode que `status()`).
- `canMergeRemoteIntoIntegration(repoPath, branch)` → `{ ok: true } | { ok: false; conflicts }` —
  `git.merge({ dryRun: true })` d'`origin/<branch>` dans `<branch>`, rien n'est écrit.
- `resyncIntegration(repoPath, branch)` — action explicite (§3.2 de la spec) : fetch, état,
  garde `integration-dirty` (intégration checkoutée + modifications en attente, pour `behind`/
  `diverged`), fast-forward / push / merge + push. Mise à jour du répertoire de travail quand
  l'intégration est checkoutée : `git.merge` puis `git.checkout({ ref: branch })` (mécanique de
  `git.pull`). Conflit → `setAside` : branche `dev-resync[-n]` sur l'ancien commit local, `HEAD`
  déplacé dessus sans toucher les fichiers (`checkout({ noCheckout: true })`, comme
  `createBranch` T87) **avant** de réécrire `refs/heads/<branch>` sur `origin/<branch>`.
- `autoSync(repoPath, integrationBranch)` — un tick d'auto-pull, **un seul fetch** : fetch (même
  repo sale) ; repo propre → fast-forward local de la branche courante sur `origin/<courante>`
  (`git.merge({ fastForwardOnly: true })` + `checkout`), non-fast-forward ignoré ; intégration
  `ahead` → `pushBranch`. Retourne l'état final. Erreurs propagées (le renderer les mémorise).
- `isMergedInto(repoPath, branch, into)` → `true` si `branch` n'a aucun commit absent de `into`.

Erreurs métier transmises par message (l'IPC perd la classe) : `integration-dirty`.

## IPC / api-client

`sync:integration-state`, `sync:can-merge-remote`, `sync:resync-integration`, `sync:auto-sync`,
`sync:is-merged` — `apps/desktop/src/main/ipc/index.ts`, `packages/api-client/src/{types,ipc-client}.ts`
(types dupliqués côté api-client comme `IntegrationSyncResult`).

## "Publier" — `renderer/lib/publishWorkspace.ts`

- Nouvelle erreur `PublishDivergedError(repos: { repo, conflicts }[])`.
- Pré-contrôle après les fetchs, avant toute écriture : pour chaque candidat, `integrationState`
  ; `diverged` → `canMergeRemoteIntoIntegration` ; un échec → `PublishDivergedError` (tous les
  repos en conflit listés).
- `publishRepo` : après `fastForwardBranch`, si `'diverged'` → `mergeInto(origin/<int>, <int>)`
  (par référence — on est déjà sorti de l'intégration) ; conflit improbable (contrôlé avant) →
  erreur générique.
- `dev-resync*` : `readRepoState` le traite comme une branche éphémère (`continuingEphemeral`) si
  `isMergedInto` est faux → `hasWork`, cas nominal (retour sur l'intégration + suppression).
- `stageAll` + `commit` seulement s'il y a des modifications en attente (plus de commit vide).

`ModificationControl` : message dédié pour `PublishDivergedError` (liste repo : fichiers) ;
`pushPublished` enregistre la dernière erreur par repo (`['sync:last-error', repoPath]` dans le
cache react-query) et l'efface sur succès.

`useModificationMode` : un repo du workspace sur `dev-resync*` figure dans `pendingRepos`
(`setAside: true`, `count: 0`) → "Publier" actif ; le popover l'affiche « commits mis de côté ».

## Auto-pull — `renderer/hooks/useAutoPull.ts`

Remplace status + `pullFastForwardOnly` par `getIntegrationBranch` + `autoSync`. Dernière erreur
par repo dans `['sync:last-error', repoPath]` (effacée sur succès), toujours `console.warn`.
Intervalle et premier tick inchangés.

## Alternatives rejetées

- Calculer l'état d'intégration dans `status()` : `status()` est poll toutes les 3 s pour la
  branche courante ; mélanger l'intégration compliquerait tous ses consommateurs.
- Faire l'auto-pull en `fetch` + `pullFastForwardOnly` : double appel réseau par tick.
- Mémoriser `dev-resync` en état React (comme `ephemeralBranch`) : perdu au redémarrage ; le
  préfixe de nom suffit et survit.
