# GH173 — Design : bascule automatique sur `dev-auto`

> Phase Design (WORKFLOW.md). Spec : `specs/GH173.md`. **Un sprint.**

## 1. Vue d'ensemble

Toute la logique de bascule et de nettoyage vit dans le main process, dans une seule méthode
`SyncService.settleAutoBranch`. Elle est appelée par `autoSync` (tick d'auto-pull), par
`resyncIntegration` et, après « Tout annuler », par un nouveau channel IPC. Côté renderer, seul
« Publier » apprend à reconnaître `dev-auto[-n]` comme une branche éphémère, comme il le fait déjà
pour `dev-resync[-n]` (GH39).

Aucune nouvelle UI, aucune clé i18n.

## 2. Fichiers modifiés

### 2.1 `packages/types/src/branch.ts` — reconnaissance partagée

```ts
/** GH173 — branche de travail créée automatiquement sur des modifications locales de l'intégration. */
export const AUTO_BRANCH_PREFIX = 'dev-auto'
/** Noms exacts générés (`dev-auto`, `dev-auto-<n>`) — pas `dev-auto-notes` d'un utilisateur. */
export function isAutoBranch(branch: string): boolean
```

Placé dans `@polenta/types` pour que le main process (création, nettoyage) et le renderer
(Publier) partagent la même définition. `RESYNC_BRANCH_PREFIX`, aujourd'hui dupliqué entre
`sync.service.ts` et `publishWorkspace.ts`, n'est pas déplacé (hors scope, pas de refactoring
opportuniste).

### 2.2 `apps/desktop/src/main/services/sync.service.ts`

**`nextFreeBranchName(repoPath, prefix)`** (privée) : `prefix`, puis `prefix-2`, `prefix-3`… —
extraite de `setAside`, qui l'utilise désormais aussi (même comportement).

**`settleAutoBranch(repoPath, integrationBranch, remote = 'origin'): Promise<AutoBranchOutcome>`**
(publique) — opérations locales uniquement, jamais de réseau :

```ts
export type AutoBranchOutcome =
  | { action: 'none' }
  | { action: 'switched'; branch: string }   // intégration → dev-auto
  | { action: 'returned'; branch: string }   // dev-auto supprimée, retour sur l'intégration
```

1. Pas de remote `origin` (`getRemoteUrl`) ou `integrationBranch` vide → `none`.
2. **Nettoyage** : toute branche locale `isAutoBranch`, non checkoutée et `isMergedInto`
   l'intégration → `deleteBranch` (silencieux, best-effort). Fait en premier pour que la bascule
   reprenne le nom `dev-auto` libéré.
3. `current = git.currentBranch()` ; `HEAD` détaché → `none`.
4. **Bascule** : `current === integrationBranch` et `status()` non vide →
   `createBranch(repoPath, nextFreeBranchName(repoPath, AUTO_BRANCH_PREFIX))` (T87 :
   `noCheckout`, aucun fichier touché) → `switched`.
5. **Retour** : `isAutoBranch(current)`, `status()` vide et `isMergedInto(current, integration)` →
   `git.checkout(integrationBranch)` (copie de travail propre : sûr) puis `deleteBranch(current)`
   → `returned`.

**`autoSync`** — nouvel ordre :
1. remote absent → `no-remote` (inchangé) ;
2. **`settleAutoBranch`** — avant le fetch, donc aussi hors ligne ou accès révoqué ;
3. accès révoqué / fetch (inchangés) ;
4. branche courante propre → fast-forward de la branche courante (inchangé ; couvre le cas
   « `returned` » à l'étape 2 : l'intégration rattrape `origin` dans le même tick) ;
5. **nouveau** : branche courante ≠ `integrationBranch` → `fastForwardBranch(integrationBranch)`.
   Retour `diverged`/`no-remote-branch` ignoré (l'état est rapporté par `integrationState` comme
   aujourd'hui) ;
6. push relancé si `ahead` (inchangé).

**`resyncIntegration`** — `settleAutoBranch` en tout début : une intégration checkoutée avec
modifications bascule sur `dev-auto`, n'est donc plus checkoutée, et le merge se fait par
référence. La garde `integration-dirty` reste en place (filet de sécurité : repo sans remote,
échec de la bascule).

### 2.3 `apps/desktop/src/main/ipc/index.ts` et liste blanche web

- `sync:settle-auto-branch` (repoPath, integrationBranch) → `c.sync.settleAutoBranch`.
- Ajouté à la liste des channels `sync:*` exposés (ligne 189), pour le client web comme les autres
  (`SPEC-WEB.md`, `WEB_EXPOSED`).
- `renderer/api.ts` : `api.sync.settleAutoBranch`.

### 2.4 `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx`

`discardAllMutation` : après `discardAll`, `api.sync.settleAutoBranch(repoPath, integrationBranch)`
(intégration lue par `api.baseline.getIntegrationBranch`, comme `useAutoPull`), puis
invalidation de `sync:status`, `sync:branches`, `sync:integration-state`. Le retour est immédiat
(critère 6). L'annulation fichier par fichier n'appelle rien : le tick suivant s'en charge
(spec, « Retour sur l'intégration »).

### 2.5 `apps/desktop/src/renderer/lib/publishWorkspace.ts`

`readRepoState` :

```ts
const auto = isAutoBranch(status.branch)
const setAside = (isResyncBranch(status.branch) || auto)
  && !(await api.sync.isMergedInto(repoPath, status.branch, integrationBranch))
const continuingEphemeral = (ephemeral?.repoPath === repoPath && ephemeral.branch === status.branch)
  || auto || setAside
const hasWork = hasPendingChanges || (ephemeral?.repoPath === repoPath && ephemeral.branch === status.branch) || setAside
```

- `continuingEphemeral` vrai sur `dev-auto` → `publishRepo` prend le cas nominal : pas de nouvelle
  branche, fast-forward/fusion de l'intégration, commit, fusion, `leaveWorkBranch` (checkout de
  l'intégration + suppression). Rien d'autre à changer dans `publishRepo`.
- En conflit : `PublishConflictError(…, ephemeral = true)` → l'éditeur de résolution et
  `resumePublishAfterResolution` quittent et suppriment la branche (GH37, inchangé).
- `hasWork` faux pour une `dev-auto` propre déjà fusionnée (en attente de nettoyage par le tick) :
  pas de publication vide.

### 2.6 `apps/desktop/src/renderer/hooks/useModificationMode.ts`

`PendingRepo.setAside` : vrai aussi pour une `dev-auto` sans modification en attente mais avec des
commits absents de l'intégration (publication interrompue puis redémarrage, critère 11). Requête
`['sync:is-merged', repoPath, branch, integrationBranch]` uniquement pour les repos sur une
branche `isAutoBranch` avec `count === 0` (rare : pas de requête dans le cas courant). Le libellé
du popover reste « (commits mis de côté) », déjà existant — pas de nouveau texte.

`mode` : inchangé (`dev-auto` n'est pas une `int-*` → `active`).

### 2.7 Documentation (dernier commit du sprint)

- `SPEC-FORKS-BRANCHES-BASELINES.md` : §2.1 (ligne nominale + règle « toute modification transite
  par une `dev-*` »), §2.3 (cycle de vie : branche automatique), §2.5 (étapes de `autoSync`),
  §2.6 (Resynchroniser avec modifications en attente).
- `SPEC-INDEX.md` : mots-clés `dev-auto`, `settleAutoBranch`, `isAutoBranch`, ticket GH173.

## 3. Décisions techniques et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Bascule au tick d'auto-pull (+ Resynchroniser, + « Tout annuler » pour le retour) | Bascule à chaque écriture de l'application (hooks dans chaque service d'écriture) | La spec exige aussi les modifications hors application ; un seul point d'entrée suffit. Le délai est sans effet visible : rien n'est bloqué avant que l'auto-pull veuille avancer l'intégration. |
| Bascule au tick | Bascule au poll `sync:status` (3 s) du renderer | Une écriture git toutes les 3 s déclenchée par un poll de lecture, concurrente des écritures de l'application : risque inutile. |
| Logique dans le main process (`settleAutoBranch`) | Orchestration côté renderer comme `publishWorkspace` | Doit tourner aussi dans le client web et à chaque tick sans dépendre d'un écran ; opérations purement git locales. |
| Reconnaissance par le nom (`dev-auto[-n]`) | Marqueur persistant (fichier `.git/polenta-auto`, config git) | Même schéma que `dev-resync`, survit au redémarrage, rien à nettoyer en cas d'interruption. |
| Fast-forward de l'intégration non checkoutée quelle que soit la branche courante | Seulement sur `dev-auto` | Plus simple, sans risque (référence seule), utile aussi sur une `dev-*` manuelle (critère 12). |
| Pas de verrou avec « Publier » | Suspendre l'auto-pull pendant une publication | Les courses identifiées sont inoffensives (§4). |

## 4. Concurrence avec « Publier »

L'auto-pull tourne indépendamment de « Publier » (déjà le cas aujourd'hui). Cas examinés :
- tick entre le `createBranch` `dev-<slug>` de Publier et son commit : branche courante
  `dev-<slug>`, pas `isAutoBranch` → aucune action de `settleAutoBranch` ;
- tick juste avant Publier sur l'intégration modifiée : bascule sur `dev-auto` ; Publier relit
  l'état (`readRepoState`, refait juste avant chaque repo) et voit `dev-auto` → cas éphémère ;
- tick entre le merge et `leaveWorkBranch` sur `dev-auto` : `dev-auto` propre et fusionnée →
  retour + suppression par le tick ; `leaveWorkBranch` refait le checkout (idempotent) et sa
  suppression échoue en silence (déjà `.catch(() => {})`).

## 5. Interaction avec #133 (PR #143, non mergée)

Le prédicat « hors intégration » de GH133 doit exclure `isAutoBranch` comme il exclut
`continuingEphemeral` et `dev-resync`. Avec ce design, `continuingEphemeral` est déjà vrai sur
`dev-auto` : si GH133 s'appuie sur `continuingEphemeral` de `readRepoState`, rien à ajouter. Le
ticket mergé en second vérifie ce point.

## 6. Pin (T82)

La bascule et le nettoyage ne changent pas le commit checkouté, sauf le retour sur une intégration
avancée — même cas que le fast-forward actuel de l'auto-pull, qui ne propage pas de pin non plus.
Aucune propagation ajoutée.

## 7. Découpage

**Un sprint** : `settleAutoBranch` + `autoSync`/`resyncIntegration` + IPC, puis renderer (Publier,
`useModificationMode`, « Tout annuler »), tests, documentation SPEC.
