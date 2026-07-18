# T57-design — Menu contextuel (clic droit) dans l'arbre de versions

## Vue d'ensemble

La feature T57 ajoute un menu contextuel sensible au contexte (branche / tag / commit) sur la page `/graph`. Elle se décompose en :

1. Couche service (nouveaux appels isomorphic-git + IPC handlers)
2. Couche API client (nouveaux types + méthodes exposées)
3. Couche UI (composant `GraphContextMenu` + intégration dans `graph.tsx`)

Découpage en **2 sprints** (voir section en fin de document).

---

## Fichiers à modifier

| Fichier | Raison |
|---|---|
| `apps/desktop/src/main/services/sync.service.ts` | Ajouter 7 nouvelles méthodes git |
| `apps/desktop/src/main/ipc/index.ts` | Enregistrer les nouveaux handlers IPC |
| `packages/api-client/src/types.ts` | Étendre l'interface `ApiClient.sync` + nouveaux types |
| `packages/api-client/src/ipc-client.ts` | Implémenter les nouvelles entrées du client IPC |
| `apps/desktop/src/renderer/routes/graph.tsx` | Intégrer le menu contextuel, le panel diff, les mutations |

---

## Sprint 1 — Services et IPC (pas d'UI)

Objectif : tous les nouveaux appels git fonctionnels, zéro UI ajoutée.

### 1.1 Nouveaux types TypeScript partagés

Dans `packages/api-client/src/types.ts` :

```typescript
// Résultat d'un merge (déjà dans SyncService, à exporter aussi via types.ts)
export interface MergeResult {
  success: boolean
  conflicts: string[]   // liste de chemins de fichiers en conflit
}

// Résultat d'un diff entre deux commits
// (réutilise SyncFileStatus déjà défini)
```

> `MergeResult` existe déjà dans `sync.service.ts` avec une structure légèrement différente (`YamlConflict[]`). On simplifie la surface exposée : le renderer n'a besoin que des `filePath` en conflit.

### 1.2 Nouvelles méthodes SyncService

**`merge(repoPath, fromBranch)`** — déjà implémenté dans `SyncService`. Il manque uniquement le handler IPC.

**`rebase(repoPath, onto)`**
```typescript
async rebase(repoPath: string, onto: string): Promise<void>
```
- `onto` peut être un nom de branche ou un SHA court/long.
- Résolution du SHA : `git.resolveRef({ ref: onto })` pour les branches, sinon utiliser directement.
- isomorphic-git n'a pas d'API `rebase` native. Implémentation manuelle :
  1. `git.resolveRef` pour obtenir le SHA de `onto`
  2. Récupérer la liste des commits entre HEAD et l'ancêtre commun via `git.log` + `git.findMergeBase`
  3. Hard-reset de HEAD sur `onto` via `git.writeRef` + `git.checkout`
  4. Rejouer les commits un à un via `git.cherryPick` si disponible — **sinon** : lancer un `git rebase` via `child_process.execFile('git', ['rebase', onto], { cwd: repoPath })` comme fallback.
- En cas d'erreur (conflits), rethrow avec message explicite.

**`pushBranch(repoPath, branchName, remote?)`**
```typescript
async pushBranch(repoPath: string, branchName: string, remote = 'origin'): Promise<void>
```
- Identique à `push()` mais avec `ref: branchName` passé à `git.push`.

**`createBranchAt(repoPath, name, sha)`**
```typescript
async createBranchAt(repoPath: string, name: string, sha: string): Promise<void>
```
- `git.branch({ ref: name, object: sha, checkout: false })`

**`deleteRemoteBranch(repoPath, name, remote?)`**
```typescript
async deleteRemoteBranch(repoPath: string, name: string, remote = 'origin'): Promise<void>
```
- `git.push({ remote, delete: true, remoteRef: name })`

**`deleteTag(repoPath, tagName)`**
```typescript
async deleteTag(repoPath: string, tagName: string): Promise<void>
```
- `git.deleteRef({ ref: 'refs/tags/' + tagName })`

**`diffBetween(repoPath, sha1, sha2)`**
```typescript
async diffBetween(repoPath: string, sha1: string, sha2: string): Promise<SyncFileStatus[]>
```
- Utilise `git.walk` avec `git.TREE({ ref: sha1 })` et `git.TREE({ ref: sha2 })`.
- Même pattern que `commitFiles()` (déjà en place), mais compare deux SHA arbitraires sans notion de "parent".

### 1.3 Nouveaux handlers IPC (index.ts)

```typescript
ipcMain.handle('sync:merge', (_e, repoPath: string, fromBranch: string) =>
  c.sync.merge(repoPath, fromBranch))
ipcMain.handle('sync:rebase', (_e, repoPath: string, onto: string) =>
  c.sync.rebase(repoPath, onto))
ipcMain.handle('sync:push-branch', (_e, repoPath: string, branchName: string, remote?: string) =>
  c.sync.pushBranch(repoPath, branchName, remote))
ipcMain.handle('sync:create-branch-at', (_e, repoPath: string, name: string, sha: string) =>
  c.sync.createBranchAt(repoPath, name, sha))
ipcMain.handle('sync:delete-remote-branch', (_e, repoPath: string, name: string, remote?: string) =>
  c.sync.deleteRemoteBranch(repoPath, name, remote))
ipcMain.handle('sync:delete-tag', (_e, repoPath: string, tagName: string) =>
  c.sync.deleteTag(repoPath, tagName))
ipcMain.handle('sync:diff-between', (_e, repoPath: string, sha1: string, sha2: string) =>
  c.sync.diffBetween(repoPath, sha1, sha2))
```

### 1.4 Extension de l'interface ApiClient

Dans `packages/api-client/src/types.ts`, étendre `ApiClient.sync` :

```typescript
sync: {
  // ... existant ...
  merge(repoPath: string, fromBranch: string): Promise<MergeResult>
  rebase(repoPath: string, onto: string): Promise<void>
  pushBranch(repoPath: string, branchName: string, remote?: string): Promise<void>
  createBranchAt(repoPath: string, name: string, sha: string): Promise<void>
  deleteRemoteBranch(repoPath: string, name: string, remote?: string): Promise<void>
  deleteTag(repoPath: string, tagName: string): Promise<void>
  diffBetween(repoPath: string, sha1: string, sha2: string): Promise<SyncFileStatus[]>
}
```

Et dans `ipc-client.ts`, implémenter les 7 nouvelles méthodes :
```typescript
merge: (p, branch) => invoke('sync:merge', p, branch),
rebase: (p, onto) => invoke('sync:rebase', p, onto),
pushBranch: (p, name, remote) => invoke('sync:push-branch', p, name, remote),
createBranchAt: (p, name, sha) => invoke('sync:create-branch-at', p, name, sha),
deleteRemoteBranch: (p, name, remote) => invoke('sync:delete-remote-branch', p, name, remote),
deleteTag: (p, tagName) => invoke('sync:delete-tag', p, tagName),
diffBetween: (p, sha1, sha2) => invoke('sync:diff-between', p, sha1, sha2),
```

---

## Sprint 2 — UI : composant GraphContextMenu + intégration

### 2.1 Détection du contexte du clic droit

**Problème clé** : la ligne de tableau contient à la fois des badges de branches/tags et des cellules de texte. Il faut distinguer sur quoi l'utilisateur a fait clic droit.

**Solution retenue** : poser `onContextMenu` sur chaque badge individuellement ET sur la ligne globale avec propagation stoppée sur les badges.

```typescript
// Sur chaque badge de branche
<span
  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(e, { type: 'branch', name: ref, sha: row.commit.sha, isCurrent: ..., isClean }) }}
  ...
>
  {ref}
</span>

// Sur la ligne (fallback = menu commit)
<tr
  onContextMenu={e => { e.preventDefault(); openMenu(e, { type: 'commit', sha: row.commit.sha, isCurrent: row.commit.isCurrent, isClean }) }}
  ...
>
```

Pour discriminer branches vs tags dans les `refs` du commit : les tags sont déjà dans `GraphCommit.refs` mélangés avec les branches. Il faut enrichir `GraphCommit` **ou** interroger `sync:tags` pour disposer de la liste des tags et faire l'intersection. Solution retenue : interroger `api.sync.tags(repoPath)` (déjà existant) avec `staleTime: Infinity` pour construire un `Set<string>` de tags connus, et tester `tagSet.has(ref)` lors de l'affichage des badges.

### 2.2 Nouveau type `GraphContextMenuTarget`

À déclarer dans `graph.tsx` (type local, pas besoin de le partager) :

```typescript
type GraphContextMenuTarget =
  | { type: 'branch'; name: string; sha: string; isCurrent: boolean }
  | { type: 'tag';    name: string; sha: string }
  | { type: 'commit'; sha: string;  isCurrent: boolean }

interface GraphContextMenuState {
  x: number
  y: number
  target: GraphContextMenuTarget
}
```

### 2.3 Composant `GraphContextMenu`

Nouveau composant dans `graph.tsx` (composant interne, pas de fichier séparé car il est très lié à la page).

Props :
```typescript
interface GraphContextMenuProps {
  state: GraphContextMenuState
  repoPath: string
  isClean: boolean
  currentBranch: string
  allBranches: string[]     // pour le sélecteur "Diff vs branche…"
  onClose: () => void
  onInvalidate: (keys: ('status' | 'graph' | 'current')[]) => void
}
```

Structure du composant :
- Utilise le pattern `useRef` + `mousedown` hors du menu pour fermer (identique à `ElementTree.tsx`).
- Utilise `useEffect` pour écouter `Escape`.
- Positionné `fixed` à `{ left: state.x, top: state.y }`, avec ajustement si débordement hors de la fenêtre (clamp sur `window.innerWidth/Height`).
- Rendu conditionnel des items selon le type de cible et les conditions (`isCurrent`, `isClean`).

**Items et mutations** (pattern `useMutation` de React Query) :

| Item | Mutation | Invalidations après |
|---|---|---|
| Checkout branche | `api.sync.checkoutBranch` | status, graph, current |
| Checkout tag/commit | `api.sync.checkoutCommit` | status, graph, current |
| Merger → courant | `api.sync.merge` | status, graph |
| Rebaser courant sur | `api.sync.rebase` | status, graph |
| Pousser branche | `api.sync.pushBranch` | status |
| Supprimer branche locale | `api.sync.deleteBranch` | graph |
| Supprimer branche remote | `api.sync.deleteRemoteBranch` | graph |
| Supprimer tag | `api.sync.deleteTag` | graph |
| Créer branche depuis SHA | `api.sync.createBranchAt` | graph |
| Créer tag sur SHA | `api.sync.createTag` (avec sha) | graph |
| Diff vs HEAD | query `diffBetween(sha, headSha)` | — |
| Diff vs branche… | sélecteur + query `diffBetween` | — |

**Gestion spinner** : chaque mutation a son propre `isPending`. L'item concerné affiche `<Loader2 size={11} className="animate-spin" />` à la place de l'icône pendant la mutation.

**Items destructifs** (rouge, double-confirmation) :

Implémentés via un état local `pendingConfirm: string | null` dans `GraphContextMenu`. Si `pendingConfirm === item.id`, l'item affiche "Confirmer ?" en rouge ; le clic confirme. Un click ailleurs ou un autre item reset `pendingConfirm`.

Items concernés : "Supprimer (locale)", "Supprimer remote", "Supprimer tag".

**Prompts inline (créer branche / créer tag)** :

État local `inlinePrompt: { mode: 'branch' | 'tag'; value: string } | null`. Quand actif, remplace la liste d'items par un mini-formulaire `<input>` + boutons Valider/Annuler (ou Enter/Escape). Si le menu est réaffiché pendant l'édition (clic sur autre row), fermer l'input sans valider.

### 2.4 Panel "Diff vs HEAD / Diff vs branche" inline

Deux approches pour l'affichage du diff :

**Option A (retenue)** : Réutiliser `CommitFilesRow` en y ajoutant la capacité d'afficher un diff entre deux SHA quelconques (pas seulement commit vs parent). Ajouter une prop optionnelle `diffShas?: { sha1: string; sha2: string }` qui bascule le queryKey et la queryFn.

**Option B (rejetée)** : Créer une nouvelle `DiffBetweenRow` séparée. Rejetée car duplication inutile avec `CommitFilesRow`.

Modification de `CommitFilesRow` :
```typescript
interface CommitFilesRowProps {
  sha: string
  repoPath: string
  projectId: string
  graphW: number
  colSpan: number
  diffShas?: { sha1: string; sha2: string }  // si présent, utilise diffBetween au lieu de commitFiles
}
```

Le `queryKey` devient `['sync:diff-between', repoPath, sha1, sha2]` si `diffShas` est présent.

**Sélecteur "Diff vs branche"** : afficher dans le menu un `<select>` (ou liste de boutons radio) des branches connues. Au choix : résoudre le SHA de la tête de branche via `GraphCommit.refs` et ouvrir le panel.

### 2.5 Intégration dans `graph.tsx`

Ajouts dans le composant `GraphPage` :

1. Query pour les tags : `useQuery(['sync:tags', repoPath], ...)` → `Set<string>` nommé `tagSet`.
2. Query pour les branches : utiliser les données déjà présentes dans `commits` (les refs), pas besoin d'une query supplémentaire — extraire la liste des noms de branches depuis `commits.flatMap(c => c.refs).filter(r => !tagSet.has(r))`.
3. État `contextMenuState: GraphContextMenuState | null`.
4. État `diffTarget: { rowSha: string; diffShas: { sha1: string; sha2: string } } | null` pour afficher le panel diff sous la ligne concernée.
5. Modifier le rendu des badges pour ajouter `onContextMenu`.
6. Modifier le rendu des `<tr>` pour ajouter `onContextMenu` (fallback commit).
7. Afficher `<GraphContextMenu>` si `contextMenuState !== null`.
8. Modifier `CommitFilesRow` usage : si `diffTarget?.rowSha === row.commit.sha`, passer `diffShas`.

---

## Décisions techniques

### Rebase via isomorphic-git vs child_process

isomorphic-git n'expose pas d'API `git.rebase()`. Options :
- **Cherry-pick manuel** : complexe, fragile face aux conflits (gestion des conflits non supportée dans isomorphic-git).
- **`child_process.execFile('git', ['rebase', onto])`** : simple, fiable, gère les conflits via codes de retour. Requiert que `git` soit installé sur le système (hypothèse valide pour une app desktop).
- **Retenu** : `child_process.execFile` avec parsing du stderr pour détecter les conflits et retourner un message d'erreur explicite.

### Enrichissement GraphCommit vs query tags séparée

Le `GraphCommit.refs` mélange branches et tags sans distinction. Options :
- **Enrichir `GraphCommit`** : ajouter `tagRefs: string[]` au niveau service. Simple mais change le contrat de `sync:graph`.
- **Query tags séparée** (retenue) : `sync:tags` est déjà implémenté, peu coûteux, permet de construire un `Set` côté renderer sans modifier le contrat graph existant.

### Positionnement du menu (hors écran)

Le menu peut déborder en bas ou à droite. Ajustement post-rendu via `useLayoutEffect` + `getBoundingClientRect` sur le ref du menu, avec clamp `Math.min(x, window.innerWidth - menuWidth)` et idem pour Y. Alternative : CSS `transform` — moins précis sans connaître la taille avant rendu. Retenu : `useLayoutEffect`.

### Confirmation destructive : double-clic vs état intermédiaire

- **Double-clic** : difficile à implémenter proprement sur mobile/touchpad.
- **État intermédiaire "Confirmer ?"** (retenu) : premier clic affiche le texte de confirmation, second clic déclenche l'action. Reset automatique si le curseur quitte l'item (ou autre clic).

### Diff vs branche : sélecteur inline vs navigation

- **Navigation vers une autre page** : casse l'expérience contextuelle.
- **Sélecteur inline dans le menu** (retenu) : plus cohérent UX, reste sur la page graph.

---

## Découpage en sprints

### Sprint 1 — Services + IPC (≈3h)

**Périmètre** :
- `sync.service.ts` : 7 nouvelles méthodes
- `ipc/index.ts` : 7 nouveaux handlers
- `packages/api-client/src/types.ts` : MergeResult exporté + 7 signatures
- `packages/api-client/src/ipc-client.ts` : 7 invocations

**Critère de fin de sprint** : TypeScript compile sans erreur, pas d'UI modifiée.

### Sprint 2 — UI : GraphContextMenu + intégration (≈4h)

**Périmètre** :
- `graph.tsx` :
  - Query tags + calcul tagSet
  - Typage `GraphContextMenuTarget`
  - Composant `GraphContextMenu` complet
  - Modification `CommitFilesRow` (prop `diffShas`)
  - Intégration dans `GraphPage` (contextMenuState, diffTarget, badges onContextMenu, tr onContextMenu)

**Critère de fin de sprint** : tous les scénarios de `T57-tests.md` vérifiables manuellement.
