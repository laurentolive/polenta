# GH414 — Design

## 1. Service (`sync.service.ts`)

Trois méthodes nouvelles, toutes locales sauf le fetch du clic.

- `refreshState(repoPath, integrationBranch): Promise<RefreshState>` — compteur, sans réseau.
  `{ branch, integration, onIntegration, behind, dirty, integrationState }`.
  `behind` = nombre de commits de l'intégration (locale) absents de la branche courante.
- `refreshBranch(repoPath, integrationBranch): Promise<RefreshOutcome>` — le clic.
- `undoRefreshWip(repoPath, wip): Promise<{ undone: boolean }>` — « Abandonner » après conflit.

```ts
export type RefreshOutcome =
  | { outcome: 'offline' }                                   // fetch impossible : rien écrit
  | { outcome: 'integration-updated' }                       // sur l'intégration : autoSync
  | { outcome: 'up-to-date' }                                // rien à récupérer : rien écrit
  | { outcome: 'merged'; sha: string; pulled: number; wip?: string }
  | { outcome: 'conflicts'; conflicts: string[]; wip?: string; leftRef: string; rightRef: string }
```

Le message du commit WIP est une constante : `REFRESH_WIP_MESSAGE = 'WIP — Rafraîchir (GH414)'`.

### Algorithme de `refreshBranch`

1. Branche courante = intégration → `autoSync` (même chemin que l'auto-pull). `offline` → `{outcome:'offline'}`.
2. Sinon, fetch. Erreur réseau (`isNetworkUnreachable`) → `{outcome:'offline'}` ; autre erreur → propagée.
3. `integrationState` :
   - `diverged` → `resyncIntegration(repoPath, integration)` (GH39 : merge propre + push, ou mise de côté sur `dev-resync`). Pas de fichier touché, la branche courante n'est pas l'intégration.
   - `behind` → `fastForwardBranch(repoPath, integration)` (par référence).
   - `ahead` / `up-to-date` / `no-remote` → rien.
4. `behind = countBehind(integration → current)`. `0` → `{outcome:'up-to-date'}`.
5. Modifs en cours (`status` staged + unstaged > 0) → `stageAll` + `commit(REFRESH_WIP_MESSAGE)` ; `wip = sha`.
6. `mergeInto(repoPath, integration, current)` (existant) :
   - `success` → `{outcome:'merged', sha, pulled: behind, wip}`. Pas de conflit : rien d'autre.
   - `!success` → `{outcome:'conflicts', conflicts, wip, leftRef: integration, rightRef: current}`.
     `mergeInto` n'écrit rien dans l'arbre ni dans l'index en cas de conflit (`mergeRecursive`
     `abortOnConflict`) : aucun état à défaire hormis le WIP.

### `countBehind`

`git.log` sur l'intégration et sur la branche, `depth` 500 (comme `status` avec 100, plus large ici
parce qu'on compte). Au-delà de 500 commits de retard, le compteur est plafonné : accepté.

### `undoRefreshWip(repoPath, wip)`

- HEAD ≠ `wip` (l'utilisateur a commité par-dessus, ou changé de branche) → `{undone:false}`, rien
  n'est touché. L'abandon ne doit jamais défaire un travail postérieur.
- Sinon : `parent = wip.parents[0]`.
  - Fichiers modifiés par le WIP : `git.walk` sur `TREE(parent)` et `TREE(wip)`, fichiers dont l'OID diffère (les dossiers sont ignorés).
  - Référence de la branche écrite sur `parent` (`writeRef`, force), même technique que `setAside`.
  - Pour chaque fichier modifié : `git.resetIndex` → l'index retrouve la version du parent. L'arbre de
    travail n'est pas modifié : les modifs reviennent en « non indexées ».

## 2. IPC et API

- `apps/desktop/src/main/ipc/index.ts` : canaux `sync:refresh-state`, `sync:refresh-branch`,
  `sync:undo-refresh-wip` (liste des canaux + handlers, à côté de `sync:settle-auto-branch`).
- `apps/desktop/src/web-server/channel-policy.ts` : mêmes canaux, avec la règle d'argument `[0]` (dépôt) comme les autres `sync:*`.
- `packages/api-client/src/ipc-client.ts` et `types.ts` : méthodes `sync.refreshState`, `sync.refreshBranch`, `sync.undoRefreshWip`.
- Types `RefreshState`, `RefreshOutcome` : exportés depuis `packages/types` (même place que les autres types de sync, à confirmer à l'implémentation).

## 3. Origine de la résolution (GH37)

Réutilisation de `MergeOrigin` `{ kind: 'merge'; from; into }` (déjà utilisée par la vue graphe).
Ajout d'un champ optionnel `wip?: string` pour retrouver le commit WIP à l'abandon.

- `open(repo, leftRef = integration, rightRef = branche, { kind:'merge', from, into, wip })` :
  `targetSide` = `right` (la branche de travail), donc la finalisation crée le merge sur elle. Aucun changement de `merge-resolution.service.ts`.
- « Terminer » : `finalize` (inchangé). La branche est propre grâce au WIP.
- « Abandonner » (`MergeResolvePage`) : `mergeResolution.abandon(id)` puis, si `origin.wip`, `sync.undoRefreshWip(repoPath, wip)`.

## 4. UI (`ModificationControl.tsx`)

- Query `['sync:refresh-state', repoPath, integration]`, `refetchInterval` 3000 (même cadence que `sync:status`), activée seulement en mode `active`.
- Bouton « Rafraîchir » avant « Publier ». Badge discret = `behind` (masqué si 0). Info-bulle :
  « N commits de l'équipe à récupérer » / « Intégration divergée : Resynchroniser » / « Rien à récupérer ».
- Au clic : `refreshBranch`, puis selon le résultat :
  - `conflicts` → `useOpenMergeResolution.open(...)` avec l'origine ci-dessus.
  - `merged` / `integration-updated` / `up-to-date` / `offline` → notification discrète dans la pile existante (`showNotifications`) ; `wip` présent → mention « Vos modifs en cours ont été enregistrées dans un commit WIP ».
  - erreur → notification d'erreur.
  - toujours : `invalidateAll()`.
- Masqué en mode `blocked` / `other`.
- Libellés `fr.json` / `en.json` sous `layout.modificationControl.refresh*`.

## 5. Décisions rejetées

- **Rebase** : réécrit l'historique, impose une gestion à part pour les branches poussées. Rejeté
  (demande de l'humain : un seul comportement, merge).
- **Stash** au lieu de WIP : la réapplication peut conflicter sur les fichiers de l'utilisateur. Rejeté.
- **Merge réel dans l'arbre avec conflit** : écrit des marqueurs dans les fichiers de l'utilisateur.
  Rejeté : la résolution GH37 travaille sur les objets, sans toucher à l'arbre avant « Terminer ».
- **Supprimer le bouton T153** : hors scope, à trancher après usage.

## 6. Fichiers touchés (prévision)

- `apps/desktop/src/main/services/sync.service.ts` (3 méthodes, constante WIP, types)
- `apps/desktop/src/main/services/sync.service.gh414.test.ts` (nouveau)
- `apps/desktop/src/main/ipc/index.ts`, `apps/desktop/src/web-server/channel-policy.ts`
- `packages/api-client/src/ipc-client.ts`, `packages/api-client/src/types.ts`
- `packages/types/src/merge-resolution.ts` (champ `wip` sur l'origine `merge`)
- `apps/desktop/src/renderer/components/layout/ModificationControl.tsx`
- `apps/desktop/src/renderer/components/merge/MergeResolvePage.tsx` (abandon)
- `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json`
