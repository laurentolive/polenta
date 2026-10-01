# SPEC-ELECTRON-DESKTOP — Architecture Client Lourd Electron

> Dernière révision : 2026-07-21 (T130)  
> Remplace la couche NestJS HTTP pour la distribution desktop.  
> La spec fonctionnelle des modules (Requirements, Tests, Traceability, Reviews…) reste inchangée.  
> §2-17 décrivaient la structure **cible initiale** (2026-06-12), jamais suivie telle quelle en
> pratique — corrigés à T130 pour refléter la structure **réelle**.

---

## 1. Philosophie & principes

```
Remote git (GitHub / GitLab / self-hosted — T130 : support Gitea retiré)
        ↑ push / pull (action utilisateur explicite)
┌───────────────────────────────────────────────────┐
│  Electron Desktop App                             │
│                                                   │
│  Main Process (Node.js)                           │
│  ├── Services (business logic)                    │
│  ├── GitService  → lit/écrit le working tree      │
│  ├── SyncService → commit / push / pull           │
│  ├── AuthService → PAT dans keychain OS           │
│  └── IPC Handlers → répondent au renderer        │
│                   ↕ contextBridge                 │
│  Renderer Process (React)                         │
│  └── ApiClient  → window.polenta.invoke(channel)  │
└───────────────────────────────────────────────────┘
        ↓ read / write
Local git working tree (clone du remote)
```

**Règles fondamentales :**
1. **Pas de serveur HTTP.** Les controllers NestJS deviennent des handlers IPC.
2. **Lecture/écriture = working tree.** `fs.readFile` sur les fichiers du repo cloné. Pas de `git show`.
3. **Git commit = action utilisateur explicite.** Les services écrivent sur disque (`fs.writeFile`) sans committer. L'utilisateur décide quand committer.
4. **Chaque modification passe par une branche git.** Une branche = une intention de travail. Elle peut toucher N exigences et N tests. Le merge ne requiert pas de review — la review est un workflow indépendant sur les exigences/tests, découplé du cycle de vie des branches.
5. **isomorphic-git** remplace `simple-git`. Pur JS, pas de binaire git système requis.
6. **schemaVersion** vérifié à l'ouverture de chaque repo.

> **Précision (T122)** : la règle 1 vise l'absence de serveur **HTTP** exposant l'app à
> un réseau. Le serveur MCP (`apps/desktop/src/mcp-server/`, cf.
> `SPEC-MCP-SERVER.md`) n'est pas une exception à cette règle — c'est un **second
> point d'entrée** en couche fine sur le même noyau de services, en **stdio** (pas de
> port réseau), lancé à la demande par le client MCP comme un process autonome
> indépendant du process Electron principal. Il respecte les règles 1 et 3 à
> l'identique : pas de port HTTP, pas de commit/push automatique.

---

## 2. Structure du monorepo

```
apps/
  api/          ← conservé pour la version web (inchangé)
  web/          ← conservé pour la version web (inchangé)
  desktop/      ← application Electron
    package.json
    tsconfig.json
    electron.vite.config.ts
    electron-builder.yml
    src/
      main/                        ← Node.js process (main)
        index.ts                   ← BrowserWindow, app lifecycle, appelle createContainer()
        ipc/                       ← T130 : un seul point d'enregistrement, pas un fichier par domaine
          index.ts                 ← registerIpcHandlers() — tous les channels (schema, workspace,
                                       sync, baseline, requirements, tests, traceability, campaigns,
                                       reviews, dashboards, queries, tree, image, drawio, export…)
          pref.handlers.ts         ← channels `pref:*` (préférences utilisateur .pref)
        services/                  ← T130 : tous les services à plat, pas de sous-dossiers par domaine
          git.service.ts           ← working tree reads/writes
          sync.service.ts          ← commit / push / pull / status / merge (inclut ce que le plan
                                       initial appelait "merge.service.ts" et "branch.service.ts")
          auth.service.ts
          workspace.service.ts
          workspace-tree.service.ts   ← T69, cache de l'arbre du workspace plat (polenta-repo.yaml)
          polenta-repo.service.ts     ← T69, lecture/écriture de polenta-repo.yaml
          repo-watcher.service.ts
          schema.service.ts
          requirements.service.ts / requirements-index.service.ts
          tests.service.ts / tests-index.service.ts
          traceability.service.ts
          tree.service.ts            ← .polenta/trees/<nœud>/<type>.yaml
          campaigns.service.ts
          reviews.service.ts
          baseline.service.ts
          interface-compliance.service.ts   ← T123, matrice de conformité par rôle
          element-move.service.ts
          dashboards.service.ts / dashboard-seed.service.ts / query-engine.service.ts / saved-queries.service.ts
          export.service.ts / export/
          … (utilitaires : id-counter, id-scope, audit-fields, mcp-launch, agents-md.template, pdf, schema-lookup, pref-store)
        container.ts               ← DI manuel (instanciation des ~22 services + registerIpcHandlers())
      preload/
        index.ts                   ← contextBridge → expose window.polenta
      renderer/
        index.html
        src/
          api/
            ipc-client.ts          ← implémente ApiClient via ipcRenderer (30+ espaces de noms)
          ... (composants React réutilisés depuis apps/web)
    mcp-server/                    ← point d'entrée MCP stdio, cf. SPEC-MCP-SERVER.md
packages/
  types/        ← inchangé
  zod-schemas/  ← inchangé
  api-client/   ← interface ApiClient partagée web + desktop
    src/
      index.ts  ← interface ApiClient + types de retour
      http-client.ts   ← implémentation HTTP (pour apps/web)
      ipc-client.ts    ← implémentation IPC (pour apps/desktop)
```

**Note (T130)** : le plan initial (ci-dessus avant correction) prévoyait un service dédié
`branches/branch.service.ts` et un `merge.service.ts` séparé avec conflits `YamlConflict[]`
granulaires par champ. Dans le code réel, toutes ces responsabilités vivent dans `SyncService`
(`merge()`/`mergeInto()`), avec des conflits remontés au niveau fichier (`{ conflicts: string[] }`),
pas champ par champ.

---

## 3. Dépendances `apps/desktop`

```json
{
  "dependencies": {
    "isomorphic-git": "^1.25.0",
    "keytar": "^7.9.0",
    "chokidar": "^3.6.0",
    "js-yaml": "^4.1.0",
    "zod": "^3.25.76",
    "@polenta/types": "workspace:*",
    "@polenta/zod-schemas": "workspace:*",
    "@polenta/api-client": "workspace:*"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^24.0.0",
    "electron-vite": "^2.3.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.4.0"
  }
}
```

---

## 4. `GitService` — working tree

Remplace entièrement le `GitService` NestJS. Opère sur le **filesystem local** du repo cloné.

### Interface

```typescript
// apps/desktop/src/main/services/git/git.service.ts

export interface GitAuthor {
  name: string
  email: string
}

export class GitService {
  // ── Lecture ──────────────────────────────────────────────────────────────

  /** Lit un fichier YAML depuis le working tree */
  async readYaml<T>(repoPath: string, filePath: string): Promise<T | null>

  /** Liste tous les fichiers du working tree sous un préfixe (T130 : `prefix` non optionnel) */
  async listFiles(repoPath: string, prefix: string): Promise<string[]>

  // ── Écriture ─────────────────────────────────────────────────────────────

  /** Écrit un fichier YAML sur le working tree (sans committer) */
  async writeYaml(repoPath: string, filePath: string, content: unknown): Promise<void>

  /** Supprime un fichier du working tree (sans committer) */
  async deleteFile(repoPath: string, filePath: string): Promise<void>

  // ── Branches ─────────────────────────────────────────────────────────────

  /** Branche courante */
  async currentBranch(repoPath: string): Promise<string>

  /** Liste toutes les branches locales */
  async listBranches(repoPath: string): Promise<string[]>

  /** Crée une branche depuis la branche courante */
  async createBranch(repoPath: string, name: string): Promise<void>

  /** Checkout une branche existante (T130 : `branchName`, + `create?` pour créer si absente) */
  async checkout(repoPath: string, branchName: string, create?: boolean): Promise<void>

  /** Supprime une branche locale */
  async deleteBranch(repoPath: string, name: string): Promise<void>

  // ── Lecture git objects (lecture seule, autres branches) ─────────────────

  /** Lit un fichier YAML depuis un ref git (pour comparer, pas pour éditer) */
  async readYamlRef<T>(repoPath: string, ref: string, filePath: string): Promise<T | null>

  /** SHA du commit HEAD */
  async headSha(repoPath: string): Promise<string>

  /** SHA de l'ancêtre commun de deux branches (pour merge 3-way) */
  async mergeBase(repoPath: string, branchA: string, branchB: string): Promise<string>
}
```

### Implémentation

```typescript
import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import git from 'isomorphic-git'

// readYaml — lit directement depuis le disque
async readYaml<T>(repoPath: string, filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(repoPath, filePath), 'utf-8')
    return yaml.load(raw) as T
  } catch {
    return null
  }
}

// listFiles — fs.readdir récursif (T130 : prefix non optionnel dans le code réel)
async listFiles(repoPath: string, prefix: string): Promise<string[]> {
  const walk = async (dir: string, base: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const results: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) results.push(...await walk(path.join(dir, entry.name), rel))
      else results.push(rel)
    }
    return results
  }
  const files = await walk(repoPath, '')
  return files.filter(f => f.startsWith(prefix))
}

// writeYaml — crée les dossiers intermédiaires si nécessaire
async writeYaml(repoPath: string, filePath: string, content: unknown): Promise<void> {
  const full = path.join(repoPath, filePath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, yaml.dump(content, { lineWidth: 120 }), 'utf-8')
}

// readYamlRef — lecture depuis git objects (isomorphic-git)
async readYamlRef<T>(repoPath: string, ref: string, filePath: string): Promise<T | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir: repoPath, oid: ref, filepath: filePath })
    return yaml.load(Buffer.from(blob).toString('utf-8')) as T
  } catch {
    return null
  }
}
```

---

## 5. `SyncService` — commit / push / pull

```typescript
// apps/desktop/src/main/services/git/sync.service.ts

// T130 : interface réelle `SyncStatus` (pas `GitStatus`) — workflow stage/unstage ajouté,
// pas de `remoteUrl` :
export interface SyncStatus {
  branch: string
  staged: SyncFileStatus[]
  unstaged: SyncFileStatus[]
  ahead: number
  behind: number
}

export interface SyncFileStatus {
  path: string
  marker: 'M' | 'A' | 'D'
}

export interface CommitResult {
  sha: string
  message: string
  timestamp: string
}

export class SyncService {
  constructor(private readonly authService: AuthService) {}

  /** État du working tree */
  async status(repoPath: string): Promise<SyncStatus>

  /**
   * Crée un commit git avec tous les fichiers modifiés/non-trackés.
   * N'est appelé QUE par action utilisateur explicite (bouton "Committer").
   */
  async commit(repoPath: string, message: string, author: GitAuthor): Promise<CommitResult>

  /** Pousse la branche courante vers le remote */
  async push(repoPath: string, remote?: string): Promise<void>

  /** Tire les changements depuis le remote */
  async pull(repoPath: string, remote?: string): Promise<void>

  /** Clone un repo distant en local */
  async clone(remoteUrl: string, localPath: string, onProgress?: (p: number) => void): Promise<void>

  /** Merge une branche feature dans la branche courante */
  async merge(repoPath: string, fromBranch: string): Promise<MergeResult>
}

// T130 : conflits remontés au niveau FICHIER dans le code réel, pas de granularité par champ
// (pas de `YamlConflict`/`conflictingFields` — détection via `instanceof git.Errors.MergeConflictError`) :
export type MergeResult =
  | { success: true; sha: string }
  | { success: false; conflicts: string[] }  // chemins de fichiers en conflit
```

**Règle :** `SyncService.commit()` stage TOUS les fichiers modifiés (`git add -A`) avant de committer. Le service ne choisit pas quels fichiers stager — c'est délégué au workflow de l'utilisateur (une branche = un sujet).

---

## 6. Migration des services métier

Les services existants (`RequirementsService`, `TestsService`, `TraceabilityService`) sont **portés tels quels** avec deux modifications :

### 6.1 Suppression des décorateurs NestJS

```typescript
// Avant (NestJS)
@Injectable()
export class RequirementsService {
  constructor(
    private readonly git: GitService,
    private readonly index: RequirementsIndexService,
    private readonly registry: ProjectsRegistryService,
  ) {}
}

// Après (plain TypeScript)
export class RequirementsService {
  constructor(
    private readonly git: GitService,
    private readonly index: RequirementsIndexService,
  ) {}
}
```

### 6.2 Signature des méthodes

`projectId + branchId` → `repoPath` (le repo est déjà checké sur la bonne branche).

```typescript
// Avant
async findAll(projectId: string, branchId: string, filters: RequirementFilters)

// Après
async findAll(repoPath: string, filters: RequirementFilters)
```

### 6.3 `writeAndCommit` → `writeYaml`

```typescript
// Avant
await this.git.writeAndCommit(projectId, branch.name, files, message, author)

// Après
for (const file of files) {
  await this.git.writeYaml(repoPath, file.path, file.content)
}
// PAS de commit ici — c'est l'utilisateur qui committe
```

### 6.4 Tableau de correspondance complet

| Service NestJS | Service Desktop | Changement |
|---------------|-----------------|------------|
| `GitService` (apps/api) | `GitService` (apps/desktop) | Réécriture complète — working tree |
| `RequirementsService` | `RequirementsService` | Supprimer `@Injectable`, adapter signature |
| `TestsService` | `TestsService` | Idem |
| `TraceabilityService` | `TraceabilityService` | Idem |
| `BranchesService` | *(pas de service dédié, T130)* | Réparti entre `GitService` et `SyncService` — voir §8 |
| `ProjectsRegistryService` | `WorkspaceService` | Réécriture — workspace plat (T69), pas de registre de projets persistant |
| `RequirementsIndexService` | `RequirementsIndexService` | Adapter `build()` pour working tree |
| `TestsIndexService` | `TestsIndexService` | Idem |

---

## 7. `AuthService`

```typescript
// apps/desktop/src/main/services/auth/auth.service.ts

export interface UserIdentity {
  name: string
  email: string
  login: string          // username du remote (GitHub…)
  avatarUrl: string | null
}

export interface RemoteCredentials {
  remoteUrl: string
  username: string
  token: string          // PAT
}

export class AuthService {
  private static readonly KEYCHAIN_SERVICE = 'polenta'

  /**
   * Stocke un PAT dans le keychain OS.
   * keytar.setPassword(service, account, password)
   * account = `${host}:${username}` ex: "github.com:laurent"
   */
  async saveToken(remoteUrl: string, username: string, token: string): Promise<void>

  /** Récupère le token depuis le keychain */
  async getToken(remoteUrl: string, username: string): Promise<string | null>

  /** Supprime le token du keychain */
  async deleteToken(remoteUrl: string, username: string): Promise<void>

  /**
   * Teste la connexion et récupère l'identité utilisateur.
   * Pour GitHub : GET https://api.github.com/user avec le token.
   * Pour autres (T130 : support Gitea retiré) : identité minimale de repli.
   */
  async resolveIdentity(remoteUrl: string, token: string): Promise<UserIdentity>

  /** Construit le GitAuthor pour les commits depuis l'identité courante */
  async getAuthor(repoPath: string): Promise<GitAuthor>

  /**
   * Credentials isomorphic-git.
   * Appelé automatiquement par SyncService lors de push/pull.
   */
  async getHttpsCredentials(url: string): Promise<{ username: string; password: string } | null>
}
```

**Stockage de l'identité active :**  
`app.getPath('userData')/auth.json` — fichier local hors git :
```json
{
  "accounts": [
    { "remoteHost": "github.com", "username": "laurent", "name": "Laurent Olive", "email": "yo@example.com" }
  ],
  "defaultAccount": "github.com:laurent"
}
```

---

## 8. Gestion des branches de travail — pas de `BranchService` dédié (T130)

Une **branche git** est l'unité de travail dans Polenta. Elle représente une intention de
modification (correction, ajout, refonte…). Il n'y a pas de fichier YAML de métadonnées — la
branche git est l'unique source de vérité.

**T130 : il n'existe pas de classe `BranchService`.** Les opérations sont réparties entre
`GitService` (lecture/écriture bas niveau) et `SyncService` (opérations qui impliquent une décision
de flux — merge, push) :

```typescript
// GitService (apps/desktop/src/main/services/git.service.ts)
async currentBranch(repoPath: string): Promise<string>
async listBranches(repoPath: string): Promise<string[]>
async createBranch(repoPath: string, branchName: string): Promise<void>
async checkout(repoPath: string, branchName: string, create?: boolean): Promise<void>
async deleteBranch(repoPath: string, name: string): Promise<void>

// SyncService (apps/desktop/src/main/services/sync.service.ts)
async listBranches(repoPath: string): Promise<{ name: string; isCurrent: boolean; type: 'int' | 'dev' | 'other' }[]>
async createBranch(repoPath: string, name: string): Promise<void>
async createBranchAt(repoPath: string, name: string, sha: string): Promise<void>
async checkoutBranch(repoPath: string, name: string): Promise<void>
async deleteBranch(repoPath: string, name: string): Promise<void>
async deleteRemoteBranch(repoPath: string, name: string, remote?: string): Promise<void>
async pushBranch(repoPath: string, branchName: string, remote?: string): Promise<void>
async merge(repoPath: string, fromBranch: string): Promise<MergeResult>
async mergeInto(repoPath: string, fromBranch: string, intoBranch: string): Promise<MergeResult>
```

Conflit de merge → `MergeResult` avec `conflicts: string[]` (chemins de fichiers, pas de résolution
champ par champ — voir §5). Il n'y a pas de méthode `applyConflictResolution` par champ ni
d'`affectedItems()` séparée sous ce nom ; le calcul des items affectés par une branche est décrit
dans `SPEC-TRACEABILITY.md`/`SPEC-FORKS-BRANCHES-BASELINES.md`.

---

## 9. `WorkspaceService`

**T130 : modèle entièrement différent du plan initial ci-dessous (avant correction).** Pas de
registre `WorkspaceProject[]`/`workspace.json` listant des projets indépendants — depuis T69, un
**workspace plat** regroupe un repo racine et ses dépendances (`polenta-repo.yaml`), et
`WorkspaceService` expose :

```typescript
// apps/desktop/src/main/services/workspace.service.ts

export class WorkspaceService {
  async detectWorkspace(dir: string): Promise<'workspace' | 'repo' | 'unknown'>
  async openProject(dir: string): Promise<WorkspaceOpenResult>
  async createNewProject(containerDir: string, name: string): Promise<WorkspaceOpenResult>
  async createFromClone(/* … */): Promise<WorkspaceOpenResult>
  async resolve(workspaceDir: string): Promise<ProjectInfo>
  async initWorkspace(workspaceDir: string, rootRepoPath: string): Promise<void>
  async openWorkspace(workspaceDir: string): Promise<WorkspaceOpenResult>
  async listRecents(): Promise<ProjectRecent[]>
  async markRecent(workspaceDir: string): Promise<void>
  async getLastOpened(): Promise<ProjectRecent | null>
  async clearLastOpened(): Promise<void>
  async ensureAgentFiles(/* … */): Promise<void>   // régénère AGENTS.md/.mcp.json si version périmée
  async getCacheTree(workspaceDir: string): Promise<WorkspaceTree | null>
  async rebuildTree(workspaceDir: string): Promise<WorkspaceOpenResult>
  async setMountOverride(workspaceDir: string, override: MountOverride): Promise<void>
}
```

Il n'y a pas de `checkSchemaCompatibility()` distincte ni de type `WorkspaceProject` — les types
réels sont `ProjectInfo`/`ProjectRecent`/`WorkspaceOpenResult`/`WorkspaceTree` (`@polenta/types`).
Pas de registre "liste de projets" persistant : `listRecents()`/`getLastOpened()` ne retiennent que
l'historique de navigation, pas une source de vérité sur les projets existants — le disque local
l'est. La découverte des composants en repo séparé passe par `PolentaRepoService` et
`WorkspaceTreeService` (`polenta-repo.yaml`, voir §22).

---

## 10. `RepoWatcherService`

Invalide l'index cache quand des fichiers changent sur le disque (suite à un pull par exemple).

```typescript
// apps/desktop/src/main/services/watcher/repo-watcher.service.ts

export class RepoWatcherService {
  private watchers = new Map<string, chokidar.FSWatcher>()

  constructor(
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
  ) {}

  /** Démarre la surveillance d'un repo */
  watch(repoPath: string): void {
    const watcher = chokidar.watch(repoPath, {
      ignored: [/\.git/, /\.polenta\/branches/],
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    })

    watcher
      .on('change', (filePath) => this.onFileChanged(repoPath, filePath))
      .on('add',    (filePath) => this.onFileChanged(repoPath, filePath))
      .on('unlink', (filePath) => this.onFileChanged(repoPath, filePath))

    this.watchers.set(repoPath, watcher)
  }

  /** Arrête la surveillance d'un repo */
  unwatch(repoPath: string): void {
    this.watchers.get(repoPath)?.close()
    this.watchers.delete(repoPath)
  }

  private onFileChanged(repoPath: string, absolutePath: string): void {
    const rel = path.relative(repoPath, absolutePath)
    if (rel.startsWith('requirements/')) this.reqIndex.invalidateFile(repoPath, rel)
    else if (rel.startsWith('tests/') || rel.startsWith('test-runs/')) this.testsIndex.invalidateFile(repoPath, rel)
    else if (rel.startsWith('links/') || rel.startsWith('versions/')) this.reqIndex.invalidate(repoPath)
  }
}
```

---

## 11. Couche IPC

### 11.1 Preload (`apps/desktop/src/preload/index.ts`)

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('polenta', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => cb(...args))
  },
  off: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.off(channel, cb)
  },
})

declare global {
  interface Window {
    polenta: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, cb: (...args: unknown[]) => void) => void
      off: (channel: string, cb: (...args: unknown[]) => void) => void
    }
  }
}
```

### 11.2 Channels IPC — référence complète

Format : `domaine:action`. Arguments passés comme objet unique `{ repoPath, ...params }`.

#### Dialog (OS natif)
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `dialog:pick-folder` | `{ title?: string }` | `string \| null` |

#### Workspace

**T130 : channels réels, sans rapport avec la table précédente** (pas de `workspace:list`/
`add-local`/`clone`/`create`/`remove`/`get` — modèle "liste de projets" remplacé par le workspace
plat T69, voir §9 et §22) :

`workspace:list-recents` · `workspace:mark-recent` · `workspace:get-last-opened` ·
`workspace:clear-last-opened` · `workspace:resolve` · `workspace:open-project` ·
`workspace:create-new` · `workspace:create-from-clone` · `workspace:detect` · `workspace:init` ·
`workspace:open` · `workspace:get-tree` · `workspace:rebuild-tree` · `workspace:set-mount-override` ·
`workspace:remove-repo-dir` · `workspace:rename-repo-dir`

Composants en repo séparé : `polenta-repo:get` / `polenta-repo:save` (voir §22).

#### Auth
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `auth:save-token` | `{ remoteUrl, username, token }` | `void` |
| `auth:get-token` | `{ remoteUrl }` | `string \| null` |
| `auth:delete-token` | `{ remoteUrl }` | `void` |
| `auth:resolve-identity` | `{ remoteUrl }` | `UserIdentity` |
| `auth:project-username` | `{ repoPath }` | `string` — login du compte connecté pour le remote `origin` du repo (sinon github.com / gitlab.com), `local` si aucun ; nom du fichier `.{username}.pref`. Fusionne une fois `.local.pref` dans `.{login}.pref` (GH29) |
| `auth:has-any-account` | — | `boolean` |
| `auth:setup` | `{ remote, pat }` | `UserIdentity` |

#### Git / Sync
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `sync:status` | `repoPath: string` | `SyncStatus` (`{ staged, unstaged, ahead, behind }`) |
| `sync:commit` | `repoPath, message` | `CommitResult` (commit les fichiers stagés uniquement) |
| `sync:push` | `repoPath` | `void` |
| `sync:pull` | `repoPath` | `void` |
| `sync:log` | `repoPath, limit?` | `CommitEntry[]` |
| `sync:checkout-commit` | `repoPath, sha` | `void` |
| `sync:stage` | `repoPath, filepath` | `void` |
| `sync:stage-all` | `repoPath` | `void` |
| `sync:unstage` | `repoPath, filepath` | `void` |
| `sync:unstage-all` | `repoPath` | `void` |
| `sync:discard` | `repoPath, filepath` | `void` |

#### Branches — pas de préfixe `branches:` (T130)

Il n'existe aucun channel `branches:*`. Toutes les opérations de branche sont sous `sync:*` :
`sync:branches` · `sync:create-branch` · `sync:create-branch-at` · `sync:checkout-branch` ·
`sync:delete-branch` · `sync:delete-remote-branch` · `sync:push-branch` · `sync:merge` ·
`sync:merge-into`. Pas de channel `resolve-conflict` par champ ni `affected-items` séparé.

#### Requirements
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `requirements:list` | `{ repoPath, filters? }` | `Requirement[]` |
| `requirements:get` | `{ repoPath, id }` | `Requirement` |
| `requirements:versions` | `{ repoPath, id }` | `RequirementVersion[]` |
| `requirements:links` | `{ repoPath, id }` | `RequirementLink[]` |
| `requirements:create` | `{ repoPath, dto: CreateRequirementDto }` | `Requirement` |
| `requirements:update` | `{ repoPath, id, dto: UpdateRequirementDto }` | `Requirement` |
| `requirements:transition` | `{ repoPath, id, dto: TransitionRequirementDto }` | `Requirement` |
| `requirements:open-draft` | `{ repoPath, id, comment }` | `Requirement` |

#### Tests
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `tests:list` | `{ repoPath }` | `TestCase[]` |
| `tests:get` | `{ repoPath, id }` | `TestCase` |
| `tests:runs` | `{ repoPath, testCaseId }` | `TestRun[]` |
| `tests:create` | `{ repoPath, dto: CreateTestCaseDto }` | `TestCase` |
| `tests:update` | `{ repoPath, id, dto: UpdateTestCaseDto }` | `TestCase` |
| `tests:execute` | `{ repoPath, testCaseId, dto: ExecuteTestCaseDto }` | `TestRun` |

#### Traceability
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `traceability:matrix` | `{ repoPath, filters? }` | `TraceabilityMatrix` |
| `traceability:missing-links` | `{ repoPath }` | `MissingLinksResult` |
| `traceability:impact` | `{ repoPath, reqId, depth? }` | `ImpactReport` |
| `traceability:acknowledge` | `{ repoPath, reqId, dto }` | `ImpactAcknowledgement` |
| `traceability:test-plan` | `{ repoPath, dto }` | `TestPlanDraft` |
| `traceability:export-csv` | `{ repoPath, filters? }` | `MatrixExportRow[]` |

#### Reviews
> Les reviews sont désormais décorrélées des branches. Elles s'attachent aux exigences/tests et sont initiées depuis leurs fiches ou depuis le panel Produit.

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `reviews:list` | `{ repoPath, status? }` | `Review[]` |
| `reviews:get` | `{ repoPath, id }` | `Review` |
| `reviews:create` | `{ repoPath, dto }` | `Review` |
| `reviews:approve-object` | `{ repoPath, reviewId, objectId }` | `Review` |
| `reviews:revoke-approval` | `{ repoPath, reviewId, objectId }` | `Review` |
| `reviews:close` | `{ repoPath, reviewId, status: 'approved' \| 'closed' }` | `Review` |
| `reviews:add-comment` | `{ repoPath, reviewId, dto }` | `ReviewComment` | ⚠ non implémenté |
| `reviews:resolve-comment` | `{ repoPath, reviewId, commentId }` | `ReviewComment` | ⚠ non implémenté |

#### Baselines — préfixe singulier `baseline:` (T130)

`baseline:list` · `baseline:get` · `baseline:create` · `baseline:delete` ·
`baseline:get-integration-branch` · `baseline:set-integration-branch`. Pas de channel
`baseline:diff` — `BaselineDiff` existe dans `@polenta/types` mais n'est exposé par aucun handler
(cf. `SPEC-AUDIT.md`).

#### Templates — n'existe pas (T130)

Aucun channel `templates:*` n'est enregistré. L'application d'un template à la création de projet,
décrite en tant que fonctionnalité courante dans `SPEC-TEMPLATES.md` §5, n'est **pas implémentée** —
voir `SPEC-TEMPLATES.md` §5 (mis à jour) pour le détail.

#### Menu (événements push main → renderer)

**T130 : menu natif désactivé.** `main/index.ts` appelle `Menu.setApplicationMenu(null)` — la
fonction `buildMenu()` qui enregistrerait ces channels n'est jamais invoquée. Les actions "Ouvrir un
projet"/"Fermer le projet" passent par l'UI in-app (panneau Projet, voir §19.8), pas par un menu OS
natif. Le hook renderer `useMenuEvents` appelle `api.workspace.clearLastOpened()` (pas
`mark-last-opened`, channel qui n'existe plus) et `markProjectJustClosed()`.

#### Notifications (événements push main → renderer)
```typescript
// Abonnement côté renderer (via window.polenta.on)
window.polenta.on('notifications:new', (notification: AppNotification) => { ... })

// Types d'événements
interface AppNotification {
  type: 'review_assigned' | 'review_approved' | 'review_closed' | 'comment_added' | 'pull_completed'
  title: string
  body: string
  reviewId?: string
  repoPath: string
  timestamp: string
}
```

### 11.3 Pattern d'un handler IPC

**T130 : un seul point d'enregistrement**, pas un fichier `*.ipc.ts` par domaine :

```typescript
// apps/desktop/src/main/ipc/index.ts

export function registerIpcHandlers(services: {
  requirements: RequirementsService
  tests: TestsService
  // … tous les autres services du container, voir §11.4
}): void {
  ipcMain.handle('requirements:list', (_e, repoPath, filters) => services.requirements.findAll(repoPath, filters))
  ipcMain.handle('requirements:get', (_e, repoPath, id) => services.requirements.findOne(repoPath, id))
  ipcMain.handle('requirements:create', (_e, repoPath, dto) => services.requirements.create(repoPath, dto))
  // … un ipcMain.handle par channel de la référence §11.2, tous dans ce même fichier
}
```

Il n'existe pas de fonction `registerRequirementsHandlers` séparée par domaine — tout est déclaré
dans `registerIpcHandlers()`, plus `apps/desktop/src/main/ipc/pref.handlers.ts` pour les channels
`pref:*`.

### 11.4 Container (`apps/desktop/src/main/container.ts`)

DI manuel — instancie les services et appelle `registerIpcHandlers()` une seule fois. **T130 : 22
services**, pas 9 :

```typescript
// apps/desktop/src/main/container.ts (services réels, ordre de dépendance)

const auth = new AuthService()
const git = new GitService()
const reqIndex = new RequirementsIndexService(git)
const testsIndex = new TestsIndexService(git)
const watcher = new RepoWatcherService(reqIndex, testsIndex)
const sync = new SyncService(auth)
const polentaRepo = new PolentaRepoService()                          // T69
const workspaceTree = new WorkspaceTreeService(sync, polentaRepo)     // T69
const workspace = new WorkspaceService(sync, workspaceTree, watcher)
const schema = new SchemaService(auth, workspaceTree)
const interfaceCompliance = new InterfaceComplianceService(workspaceTree, reqIndex)  // T123
const tree = new TreeService()                                        // .polenta/trees/
const requirements = new RequirementsService(git, reqIndex, schema, tree)
const tests = new TestsService(git, testsIndex, schema, tree)
const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
const reviews = new ReviewsService(git)
const campaigns = new CampaignsService(git, tests)
const elementMove = new ElementMoveService(schema, requirements, tests, tree)
const baseline = new BaselineService()
const queryEngine = new QueryEngineService(reqIndex, testsIndex, schema, traceability, workspaceTree)
const dashboards = new DashboardsService(git)
const savedQueries = new SavedQueriesService(git, schema, dashboards)
const dashboardSeed = new DashboardSeedService(git, dashboards, savedQueries)
const exportSvc = new ExportService()

registerIpcHandlers({ /* … tous les services ci-dessus */ })
```

Il n'y a pas de `BranchService` dans ce container (voir §8) ; `TreeService` **est** injecté (T138 —
sans lui, les objets créés via le serveur MCP n'apparaissent jamais dans SystemView/ExcelView, voir
`SPEC-MCP-SERVER.md`).

---

## 12. Package `@polenta/api-client` — abstraction web + desktop

Permet aux composants React d'être identiques en mode web (HTTP) et desktop (IPC).

```typescript
// packages/api-client/src/index.ts

export interface ApiClient {
  requirements: {
    list(repoPath: string, filters?: RequirementFilters): Promise<Requirement[]>
    get(repoPath: string, id: string): Promise<Requirement>
    create(repoPath: string, dto: CreateRequirementDto): Promise<Requirement>
    update(repoPath: string, id: string, dto: UpdateRequirementDto): Promise<Requirement>
    transition(repoPath: string, id: string, dto: TransitionRequirementDto): Promise<Requirement>
    openDraft(repoPath: string, id: string, comment: string): Promise<Requirement>
  }
  tests: {
    list(repoPath: string): Promise<TestCase[]>
    get(repoPath: string, id: string): Promise<TestCase>
    runs(repoPath: string, testCaseId: string): Promise<TestRun[]>
    create(repoPath: string, dto: CreateTestCaseDto): Promise<TestCase>
    update(repoPath: string, id: string, dto: UpdateTestCaseDto): Promise<TestCase>
    execute(repoPath: string, testCaseId: string, dto: ExecuteTestCaseDto): Promise<TestRun>
  }
  traceability: {
    matrix(repoPath: string, filters?: MatrixFiltersDto): Promise<TraceabilityMatrix>
    missingLinks(repoPath: string): Promise<MissingLinksResult>
    impact(repoPath: string, reqId: string, depth?: number): Promise<ImpactReport>
    acknowledgeImpact(repoPath: string, reqId: string, dto: AcknowledgeImpactDto): Promise<ImpactAcknowledgement>
    generateTestPlan(repoPath: string, dto: GenerateTestPlanDto): Promise<TestPlanDraft>
    exportCsv(repoPath: string, filters?: MatrixFiltersDto): Promise<MatrixExportRow[]>
  }
  // T130 : pas de namespace `branches` séparé — les opérations de branche vivent sous `sync`
  // (voir §8/§11.2), avec les signatures réelles de SyncService (listBranches, createBranch,
  // checkoutBranch, deleteBranch, merge, mergeInto…), pas celles ci-dessus.
  sync: {
    status(repoPath: string): Promise<SyncStatus>
    commit(repoPath: string, message: string): Promise<CommitResult>
    push(repoPath: string): Promise<void>
    pull(repoPath: string): Promise<void>
    // + listBranches/createBranch/checkoutBranch/deleteBranch/merge/mergeInto/… (§8, §11.2)
  }
  // T130 : pas de `list()/addLocal()/clone()/remove()` avec un `WorkspaceProject[]` — modèle
  // workspace plat réel (§9), méthodes réelles : detectWorkspace/openProject/createNewProject/
  // createFromClone/resolve/listRecents/markRecent/getLastOpened/clearLastOpened/…
  workspace: {
    getLastOpened(): Promise<ProjectRecent | null>
    clearLastOpened(): Promise<void>
    // + le reste de WorkspaceService, voir §9
  }
  auth: {
    saveToken(remoteUrl: string, username: string, token: string): Promise<void>
    resolveIdentity(remoteUrl: string): Promise<UserIdentity>
    hasAnyAccount(): Promise<boolean>
    setup(remote: string, pat: string): Promise<UserIdentity>
  }
  // + schema, campaigns, reviews, baseline, dashboards, queries, tree, polentaRepo, interface,
  // image, drawio, export, pref — voir §11.2 pour la liste complète des channels réels.
}
```

```typescript
// packages/api-client/src/ipc-client.ts
// Implémentation desktop — utilisée dans apps/desktop/src/renderer/

export function createIpcClient(): ApiClient {
  const invoke = <T>(channel: string, args?: object): Promise<T> =>
    window.polenta.invoke(channel, args) as Promise<T>

  return {
    requirements: {
      list: (repoPath, filters) => invoke('requirements:list', { repoPath, filters }),
      get: (repoPath, id) => invoke('requirements:get', { repoPath, id }),
      create: (repoPath, dto) => invoke('requirements:create', { repoPath, dto }),
      // ...
    },
    // ...
  }
}
```

```typescript
// packages/api-client/src/http-client.ts
// Implémentation web — utilisée dans apps/web/

export function createHttpClient(baseUrl: string): ApiClient {
  return {
    requirements: {
      list: (repoPath, filters) =>
        fetch(`${baseUrl}/projects/${repoPath}/requirements?${qs(filters)}`).then(r => r.json()),
      // ...
    },
    // ...
  }
}
```

---

## 13. `apps/desktop/src/main/index.ts` — entry point

**T130 : pas d'appel individuel par domaine** — `createContainer()` instancie les ~22 services
**et** appelle `registerIpcHandlers()` en une fois (voir §11.4). `main/index.ts` se contente
d'appeler `createContainer()`, définir le menu (`Menu.setApplicationMenu(null)` — menu natif
désactivé, voir §11.2 "Menu"), et ouvrir la `BrowserWindow` :

```typescript
import { app, BrowserWindow } from 'electron'
import { createContainer } from './container'
import * as path from 'path'

app.whenReady().then(() => {
  createContainer()   // instancie les services ET enregistre tous les handlers IPC

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,  // OBLIGATOIRE pour la sécurité
    },
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

---

## 14. `electron.vite.config.ts`

Config de base ci-dessous conservée pour l'essentiel, **avec 3 ajouts non documentés à l'origine
(T123/T126)** : plugin `@tanstack/router-plugin/vite` (génération des routes), alias
`@polenta/types`/`@polenta/zod-schemas` pour le renderer, et `externalizeDepsPlugin({ exclude:
['@polenta/types'] })` côté main (nécessaire pour éviter des problèmes de résolution ESM sur ce
package).

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@polenta/types'] })],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    plugins: [tanstackRouter(), react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@polenta/types': resolve(__dirname, '../../packages/types/src'),
        '@polenta/zod-schemas': resolve(__dirname, '../../packages/zod-schemas/src'),
      },
    },
  },
})
```

---

## 15. Contraintes & règles pour les sous-agents

### Ce qu'il FAUT faire
- Toujours lire depuis le working tree (`fs.readFile`), jamais via `git show` sauf pour `readYamlRef` (lecture historique)
- Toujours créer/changer de branche via `GitService`/`SyncService` (pas de `BranchService` dédié, voir §8), jamais directement depuis un service métier
- Stocker les tokens via `AuthService.saveToken()` uniquement — jamais dans un fichier texte ou dans le repo git
- Valider les DTOs avec Zod dans les handlers IPC (même pattern que les pipes NestJS)
- Setter `nodeIntegration: false` et `contextIsolation: true` dans `BrowserWindow` — c'est une règle de sécurité Electron non négociable

### Ce qu'il NE FAUT PAS faire
- ❌ Appeler `SyncService.commit()` depuis un service métier (Requirements, Tests…) — c'est une action utilisateur
- ❌ Stocker des métadonnées de branche dans des fichiers YAML (`actions/*.yaml`) — la branche git est l'unique source de vérité
- ❌ Faire des requêtes réseau depuis le renderer — tout passe par IPC
- ❌ Exposer `ipcRenderer` directement dans le preload — uniquement via `contextBridge`
- ❌ Stocker le PAT en clair dans `userData` ou dans le repo
- ❌ Réutiliser `simple-git` — uniquement `isomorphic-git`
- ❌ Supprimer ou modifier `apps/api` — la version web reste fonctionnelle en parallèle
- ❌ Éditer `.polenta/trees/<nœud>/<type>.yaml`, `polenta-repo.yaml` généré, ou tout fichier `.polenta/*.cache.yaml` manuellement — maintenus par l'application (T130 : pas de `.gitmodules`, ce mécanisme n'existe pas — voir §22)
- ❌ Éditer `tree.yaml` manuellement — il est généré par `scripts/update-tree.py` via le hook pre-commit
- ❌ Ajouter/supprimer un composant autrement qu'en modifiant `schema.components` via `schema:save`

---

## 16. Écran de démarrage — flux d'initialisation

Au lancement de l'app, le renderer exécute un flux de navigation automatique avant d'afficher quoi que ce soit à l'utilisateur.

### 16.1 Flux de démarrage

```
App ouvre (route "/" chargée)
       │
       ▼
  auth:has-any-account ?
       │
       ├─ NON → /login
       │         L'utilisateur saisit : URL remote + PAT
       │         [Se connecter] → auth:setup(remote, pat)
       │           ├─ Succès → workspace:clear-last-opened → /
       │           └─ Erreur → afficher message d'erreur
       │
       └─ OUI
              │
              ▼
         workspace:get-last-opened ?
              │
              ├─ OUI → /dashboard?projectId=…  (ouverture directe du dernier projet — T102)
              │
              └─ NON → /             (écran de chargement de projet)
                        ├─ [Cloner un repo] — URL remote + dossier local
                        └─ [Ouvrir un dossier existant] — dossier déjà cloné
```

> **T102** — au démarrage (`lastOpenedId` connu), la page d'atterrissage est `/dashboard`
> et non `/schema`. `/schema` reste la page d'atterrissage pour une navigation *explicite*
> vers un projet (clic sur "Récents", création, clone — cf. §19.3), qui reste inchangée.

### 16.2 Channels IPC nécessaires

| Channel | Paramètres | Retour | Description |
|---------|-----------|--------|-------------|
| `auth:has-any-account` | — | `boolean` | Vrai si au moins un compte (ou token bare) est configuré |
| `auth:setup` | `{ remote, pat }` | `UserIdentity` | Enregistre le PAT + résout l'identité + persiste le compte |
| `workspace:get-last-opened` | — | `ProjectRecent \| null` | Dernier projet ouvert (T130 : pas de `workspace.json` registre — historique de navigation seulement) |
| `workspace:clear-last-opened` | — | `void` | Efface le dernier projet ouvert (T130 : pas de `mark-last-opened(id)` — channel réel sans paramètre) |
| `workspace:mark-recent` | `workspaceDir: string` | `void` | Marque un projet comme récemment ouvert |
| `workspace:is-empty-dir` | `dir: string` | `boolean` | GH27 — `true` si le dossier n'existe pas ou ne contient aucune entrée (fichiers cachés compris) ; utilisé par le bouton Démo |

### 16.3 Routes renderer

| Route | Condition d'accès | Comportement |
|-------|------------------|--------------|
| `/login` | Aucun compte configuré | Formulaire remote + PAT ; redirige vers `/` après succès |
| `/` | Compte configuré | Si aucun `lastOpenedId` : boutons Démo / Ouvrir / Depuis un repo / Créer (GH27, §16.5) ; sinon redirige vers `/dashboard?projectId=…` (T102) |
| `/dashboard?projectId=…` | Dernier projet connu (démarrage) | Page Suivi/Dashboard du projet ; `dashboardId` absent → redirige vers le premier dashboard en ordre panneau latéral, ou invite à en créer un si le projet n'en a aucun (T109) |

### 16.4 Écran Login (`/login`)

```
┌─────────────────────────────────────────┐
│  Bienvenue dans Polenta                 │
│                                         │
│  Remote git                             │
│  [ https://github.com              ▾ ]  │  ← select ou saisie libre
│                                         │
│  Personal Access Token (PAT)            │
│  [ ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●● ]   │
│                                         │
│  [    Se connecter    ]                 │
│                                         │
│  ⓘ Créez un PAT sur GitHub :           │
│  Settings → Developer settings →        │
│  Personal access tokens → Fine-grained  │
│  Permissions requises : repo (read/write)│
└─────────────────────────────────────────┘
```

### 16.5 Écran Workspace (`/`) — layout

> **GH27** : la page ne contient plus de formulaires. Elle propose quatre boutons d'action et ne
> demande chaque information qu'au moment où elle est nécessaire : dossier par le sélecteur
> natif, texte par un popup à un seul champ. Le but est de minimiser le nombre de clics.
> La liste des projets récents reste dans la sidebar uniquement (T108).

```
┌──────────────────────────────────────────────┐
│ ✨ Découvrir Polenta avec le projet de        │  ← mis en avant (bg-prim)
│    démonstration                             │
│    Lave-linge LL800 — toutes les fonctionnalités sur un projet complet
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ 📂 Ouvrir un projet existant                  │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ ⬇  Ouvrir un projet depuis un repo existant   │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ ＋ Créer un nouveau projet                    │
└──────────────────────────────────────────────┘
```

Chaque bouton porte un titre et une ligne d'aide. Pendant une opération, la ligne d'aide du
bouton concerné est remplacée par un libellé de chargement, et les autres boutons sont
désactivés. Une erreur s'affiche sous le bouton concerné et disparaît au lancement suivant.

| Bouton | Enchaînement | Opération |
|--------|--------------|-----------|
| Démo | sélecteur natif → | dossier contenant `.polenta/workspace.yaml` (`workspace:detect`) : `workspace:open-project` ; sinon dossier vide ou inexistant (`workspace:is-empty-dir`) : `workspace:create-from-clone` avec l'URL fixe `DEMO_PROJECT_URL` (`renderer/lib/demoProject.ts`) ; sinon erreur « dossier non vide » |
| Ouvrir un projet existant | sélecteur natif → | `workspace:open-project` (`not-a-workspace` → erreur) |
| Depuis un repo existant | popup « URL du repo Git » → sélecteur natif → | `workspace:create-from-clone` |
| Créer un nouveau projet | popup « Nom du projet » → sélecteur natif → | `workspace:create-new` |

- **Popup** (`components/home/TextPromptModal.tsx`) : un seul champ, qui a le focus à l'ouverture.
  `Entrée` valide, `Échap` ou un clic sur l'overlay annule, et la validation est impossible si le
  champ est vide.
- **Annuler** le popup ou le sélecteur natif ne déclenche rien et n'affiche aucun message.
- **Succès** : `workspace:mark-recent` puis navigation vers `/schema`.
- **Dossier choisi = dossier conteneur** du workspace : le repo est placé dans
  `<dossier>/<nom-du-repo>` ou `<dossier>/<nom>`. Si `workspace:create-from-clone` échoue, il
  supprime le sous-dossier qu'il a lui-même créé, pour qu'une nouvelle tentative dans le même
  dossier reste possible.

**Menu déroulant `[user▾]` :**

```
┌──────────────────────────────┐
│  Laurent Olive               │  ← name depuis UserIdentity
│  yogavernon@gmail.com        │  ← email
│  github.com                  │  ← remoteHost
├──────────────────────────────┤
│  Changer de compte…          │  → /login (réinitialise le flux auth)
│  Se déconnecter              │  → supprime le token keychain + /login
└──────────────────────────────┘
```

Le bouton `[user▾]` est présent sur toutes les routes sauf `/login`.

Les boutons de `/` qui demandent un dossier ouvrent directement le sélecteur de dossier natif de l'OS via `dialog:pick-folder` (GH27).

### 16.6 Channel IPC `dialog:pick-folder`

| Channel | Paramètres | Retour | Description |
|---------|-----------|--------|-------------|
| `dialog:pick-folder` | `{ title?: string }` | `string \| null` | Ouvre `dialog.showOpenDialog` côté main ; retourne le chemin absolu sélectionné, ou `null` si annulé |

**Implémentation main process :**

```typescript
ipcMain.handle('dialog:pick-folder', async (_event, { title } = {}) => {
  const result = await dialog.showOpenDialog({
    title: title ?? 'Sélectionner un dossier',
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})
```

**Usage renderer :**

```typescript
const picked = await api.dialog.pickFolder()
if (picked) setClonePath(picked)
```

L'`ApiClient` expose une namespace `dialog` :

```typescript
dialog: {
  pickFolder(title?: string): Promise<string | null>
}
```

---

## 17. Gestion de projet — menu File

Voir [SPEC-PROJECT-MANAGEMENT.md](SPEC-PROJECT-MANAGEMENT.md) pour la spécification complète.

**Résumé :**
- 1 fenêtre Electron = 1 projet actif à la fois.
- Pour travailler sur 2 projets simultanément, l'utilisateur ouvre une seconde fenêtre via **Fichier → Ouvrir dans une nouvelle fenêtre**.
- **Fichier → Fermer le projet** appelle `workspace:clear-last-opened` + navigue vers `/` (T130 : menu natif désactivé en pratique, voir §11.2 "Menu" — ce comportement est celui du bouton in-app équivalent).
- **Fichier → Ouvrir un projet…** fait de même (retour à l'écran Workspace).
- Le menu natif envoie des événements push (`menu:open-workspace`, `menu:close-project`) au renderer via `win.webContents.send`. Le renderer s'abonne via le hook `useMenuEvents`.

---

## 18. Design system — tokens et dark mode

**T130 : contenu déplacé vers `SPEC-THEMING.md` (T116), devenu la source unique de vérité.**
`theme.config.ts` génère `index.css`/`tailwind.theme.generated.js` — les tables de tokens/ratios
WCAG ci-dessous (état 2026-06-12) ont dérivé de cette génération et ne sont plus tenues à jour ici,
pour éviter une double source. Voir `SPEC-THEMING.md` pour les tokens actuels (familles
`status-*`, `chart-series-*`, `activity-*`, `print-*`, overlay) et le mécanisme de génération.

Seul invariant encore pertinent ici : l'**activity bar** reste toujours sombre
(`slate-900`/`slate-800`/`slate-700`), identique à VS Code, quel que soit le thème choisi.

Classes de boutons : voir §19.16 (`btn-primary`/`btn-secondary`/`btn-danger`/`btn-icon`/`btn-close`/
`btn-sm`, système complet documenté à T115).

---

## 19. Layout global — barre latérale VS Code

> Remplace le layout avec header horizontal (§16.5). Le bandeau supérieur est supprimé.  
> Cette section décrit la nouvelle architecture visuelle de l'application.

### 19.1 Structure générale

```
┌──────────────────────────────────────────────────────────────────┐
│ Barre de titre OS : "Polenta — mon-projet — C:\projets\…"        │
├──────────────────────────────────────────────────────────────────┤
│ Barre d'onglets : [Onglet A][Onglet B ●][Onglet C] … [+][▾]      │  ← T101
├────┬───────────────────┬─────────────────────────────────────────┤
│    │                   │                                         │
│ A  │  Sidebar          │  Main frame                             │
│ c  │  (~280 px)        │                                         │
│ t  │                   │  Vue par défaut du panel actif,         │
│ i  │  Contrôles        │  ou détail d'un élément sélectionné.   │
│ v  │  auxiliaires :    │                                         │
│ i  │  filtre, type,    │  Rendu par TanStack Router <Outlet>.    │
│ t  │  état git en      │  L'URL est la source de vérité.        │
│ y  │  cours…           │                                         │
│    │                   │                                         │
└────┴───────────────────┴─────────────────────────────────────────┘
```

**Badge de mise à jour (GH26)** : `UpdateBadge` en bas de l'ActivityBar (`mt-auto`), rendu seulement quand `UpdateState.status === 'ready'` (mise à jour téléchargée) — icône + pastille, info-bulle « Polenta vX.Y.Z est disponible », jamais de popup. Clic → popover (version actuelle → nouvelle, « Voir les nouveautés » via `app:open-release-page`, « Plus tard », « Redémarrer pour installer »). Si des onglets de la fenêtre sont dirty (`TabsContext.dirtyTabIds`), le premier clic affiche un avertissement et le bouton devient « Installer quand même » (les onglets dirty des autres fenêtres ne sont pas vus — limite acceptée).

**Principe fondamental :** cliquer une icône dans l'ActivityBar change **simultanément** la sidebar (panneau de contrôle) et le main frame (vue par défaut du panneau). L'`activePanel` est **dérivé de l'URL courante** — aucun état React séparé n'est nécessaire.

- **Barre d'onglets** (T101, ~32 px, au-dessus de tout le reste) : onglets façon Firefox, un onglet = une URL complète (pathname + search params) mémorisée par `TabsContext`/`TabsProvider` (`apps/desktop/src/renderer/contexts/TabsContext.tsx`). Changer d'onglet fait un `navigate()` vers l'URL mémorisée — l'ActivityBar/Sidebar en dessous suivent automatiquement puisqu'ils dérivent de l'URL courante, comme pour toute navigation normale. Bouton "+"/Ctrl+T (nouvel onglet sur la page d'accueil), croix/Ctrl+W (fermer, avec confirmation si l'onglet est enregistré "dirty" via `useRegisterTabDirty` — schema.tsx, req.$reqId.tsx, test.$testId.tsx, campaign.$campaignId.tsx), bouton flèche vers le bas (menu déroulant filtrable listant les onglets ouverts + "Récemment fermés", limité à 10 entrées, en mémoire). Le dernier onglet d'une fenêtre n'est jamais fermé : son contenu est réinitialisé sur la page d'accueil. Scope par fenêtre Electron (`createAppWindow()`) — pas de persistance entre redémarrages. Titre par onglet dérivé par défaut de la route (`useSetTabTitle` l'affine ensuite avec le nom réel de l'entité affichée).
- **Activity bar** (~48 px) : navigation entre les panneaux.
- **Sidebar** (~280 px) : contrôles du panneau actif — filtre texte, filtre par type, actions (créer, committer…). Ne contient pas de liste principale.
- **Main frame** (`<main>`, reste) : contenu principal rendu par `<Outlet>`. Vue par défaut du panneau + vues de détail secondaires.

### 19.2 Activity bar — comportement au clic

Cliquer une icône déclenche `handlePanelSelect(panel)` qui navigue vers la **route par défaut** du panneau :

| Panel | Icône | Requiert projet | Route par défaut (main frame) | Sidebar |
|-------|-------|----------------|-------------------------------|---------|
| **Compte** | 👤 | Non | `/account` — tableau de bord utilisateur | Identité, préférences, déconnexion |
| **Projet** | 📁 | Non | `/project/$id` ou `/` si pas de projet | Projets récents, création, import |
| **Version** | ⎇ | Oui | `/graph?projectId=…` — arbre de versions git | Modification courante, fichiers stagés/modifiés |
| **Produit** | 📋 | Oui | `/product?projectId=…&tab=requirements` | Tabs Exigences / Tests / Campagnes, contenu piloté par schema produit |
| **Composants** | 🧩 | Oui | `/components?projectId=…&tab=requirements` | Sélecteurs `[composant▾][niveau▾]` sur une ligne + tabs Exigences / Tests / Campagnes |
| **Paramètres** *(T171)* | `(x)` | Oui | `/parameters?projectId=…&repo?` — bases de paramètres par repo | Liste des repos du workspace (filtre la vue) |

**Règles :**
- Le panneau actif (`activePanel`) est calculé depuis `pathname` : pas de `useState`, dérivé pur.
- Recliquer le panneau déjà actif re-navigue vers la route par défaut.
- "Version", "Produit", "Composants" sont grisés si aucun projet n'est chargé.
- Lorsque le main frame affiche un diff (`/diff`), le panel Version expose une icône `History` pour revenir à `/graph`.

### 19.3 Main frame — table des routes

| Route | Contenu main frame | Panel déduit |
|-------|--------------------|-------------|
| `/account` | **Tableau de bord utilisateur** (identité, préférences, thème) | Compte |
| `/` | Workspace (création, clone, récents) | Projet |
| `/schema?repoPath&projectId` | **Modèle de données** (onglet Structure par défaut) — page d'atterrissage du projet depuis T86, remplace `/project/$id` (retiré) | Projet |
| `/graph?projectId` | **Arbre de versions** (commits, refs de branches, checkout) | Version |
| `/diff?projectId&filepath` | Vue diff d'un fichier | Version |
| `/branch/new` | Formulaire nouvelle branche | Version |
| `/product?projectId&tab` | **Panel Produit** — liste exigences / tests / campagnes selon tab | Produit |
| `/parameters?projectId&repo?` | **Paramètres** (T171) — bases de paramètres, « Utilisé par », édition | Paramètres |
| `/req/new?projectId&component?&level?` | Formulaire nouvelle exigence | Produit ou Composants |
| `/req/$reqId?projectId&component?&level?` | Détail / édition d'une exigence | Produit ou Composants |
| `/test/new?projectId&component?&level?` | Formulaire nouveau cas de test | Produit ou Composants |
| `/test/$testId?projectId&component?&level?` | Détail / édition d'un cas de test | Produit ou Composants |
| `/campaign/new?projectId&component?&level?` | Formulaire nouvelle campagne | Produit ou Composants |
| `/campaign/$campaignId?projectId&component?&level?` | Détail / suivi d'une campagne | Produit ou Composants |
| `/components?projectId&component&level&tab` | **Panel Composants** — liste selon sélecteurs + tab | Composants |
| `/search?projectId` | **Vue Recherche** — liste des résultats (style Vue Word) ou édition inline d'un résultat (cf. §19.17) | Recherche |

> `component?` et `level?` sont optionnels : absents = contexte produit, présents = contexte composant. Le panel actif est déduit de leur présence.

### 19.4 Synchronisation sélecteurs sidebar ↔ main frame

L'état des sélecteurs (tab, component, level) est porté par l'URL.  
La sidebar lit les params URL courants (`useRouterState`) et navigue avec `replace: true` à chaque modification — pas de state local dupliqué.

### 19.5 Titre de fenêtre OS

Le titre de la `BrowserWindow` est mis à jour dynamiquement via IPC :

```
Aucun projet : "Polenta"
Projet chargé : "Polenta — mon-projet — C:\projets\mon-projet"
```

**Channel IPC `app:set-title` (one-way, renderer → main) :**

```typescript
// main
ipcMain.on('app:set-title', (_event, title: string) => {
  BrowserWindow.getFocusedWindow()?.setTitle(title)
})

// renderer — appelé quand un projet est chargé ou fermé
window.polenta.invoke('app:set-title', `Polenta — ${project.name} — ${project.localPath}`)
window.polenta.invoke('app:set-title', 'Polenta')  // à la fermeture
```

Appelé dans `ProjectPanel` (sidebar) via `useEffect` sur `project?.name` et `project?.localPath`.

> **T101** : ce titre de fenêtre OS reste scopé au projet, mis à jour uniquement à
> l'ouverture/fermeture d'un projet — il ne change pas quand on bascule entre onglets. Le titre
> par onglet (barre d'onglets, §19.1) est un mécanisme entièrement séparé, tenu côté renderer par
> `TabsContext`, sans lien avec `app:set-title`.

### 19.6 Panneau — Compte

```
┌─────────────────────────────┐
│  COMPTE                     │
│  ─────────────────────────  │
│  Laurent Olive              │
│  yogavernon@gmail.com       │
│  github.com                 │
│                             │
│  [ Changer de compte… ]     │
│  [ Se déconnecter     ]     │
└─────────────────────────────┘
```

Remplace le composant `AccountMenu` du header (supprimé).

Section **Préférences** (préférences de l'application, pas du projet) : thème et langue
(`localStorage`), et case « Mises à jour auto. » (GH26) liée à `app:get-settings`/`app:set-settings`
(`autoCheckUpdates`, `userData/app-settings.json` — lue par le main au démarrage, d'où pas de
`localStorage`) ; effective au prochain lancement.

### 19.7 Panneau — Projet (sans projet chargé)

Affiche la page de gestion de projets : Récents, Créer un projet, Charger un projet, Ouvrir un projet local (voir §16.5).

```
┌─────────────────────────────┐
│  PROJET                     │
│  ─────────────────────────  │
│  Récents                    │
│    mon-projet               │
│    autre-projet             │
│  ─────────────────────────  │
│  [ Créer un projet    ]     │
│  [ Charger un projet  ]     │
│  [ Ouvrir local       ]     │
└─────────────────────────────┘
```

### 19.8 Panneau — Projet (projet chargé) — hub de configuration

Le panneau Projet, quand un projet est chargé, est un hub de configuration. Il **ne contient plus de source control** (déplacé dans le panneau Version).

> **T86** : les entrées "Tableau de bord" (route `/project/$id`, avec son sélecteur de branche
> d'intégration mal nommé "Baseline" et la `SyncBar`) et "Droits" (stub désactivé, jamais
> implémenté) ont été retirées. `/schema` (Modèle de données) est désormais la seule entrée du
> panneau et la page d'atterrissage par défaut du projet. Le sélecteur de branche d'intégration a
> été déplacé (et renommé `IntegrationBranchSelector`) dans l'onglet Structure du Modèle de
> données, sous la ligne du repo root ; la capacité de push perdue avec `SyncBar` a été restaurée
> dans le panneau Version (`VersionRepoFolder`).

```
┌─────────────────────────────┐
│  PROJET                     │
│  mon-projet             [✕] │  ← bouton "Fermer le projet"
│  ─────────────────────────  │
│  CONFIGURATION              │
│  ⚙ Modèle de données        │  ← lien vers /schema
└─────────────────────────────┘
```

**Bouton "Fermer le projet" (✕) :**
- Affiché à droite du nom du projet dans le header du panneau
- Appelle `api.workspace.clearLastOpened()`, remet le titre à `'Polenta'`, navigue vers `/`

**Titre de fenêtre :**
- Mis à jour via `api.app.setTitle(...)` dans un `useEffect` sur `project?.name` / `project?.localPath`
- `ProjectPanel` est l'unique responsable du titre — `VersionPanel` ne l'appelle pas

### 19.8b Panneau — Version

Nouveau panneau dédié à la gestion de configuration, inspiré du panneau Source Control de VS Code.

**Principe :** la branche git courante est l'identité de la modification. Pas de métadonnées YAML séparées.

```
┌─────────────────────────────┐
│  VERSION           🌿 main  │  ← branche courante dans le header
│  ─────────────────────────  │
│  BRANCHE COURANTE           │
│  feat/fix-bat-thermal       │  ← nom de branche = identité du travail
│  [+ Nouvelle branche…] [✕ Supprimer]
│  ─────────────────────────  │
│  ITEMS AFFECTÉS (3)         │  ← calculé depuis git diff main..HEAD
│    SW-001  BAT-003  TEST-07 │
│  ─────────────────────────  │
│  STAGÉS (2)  [−Tout] [Committer…]
│    M  requirements/SW-001…  [−]  ← [−] = unstage
│    A  requirements/SW-002…  [−]
│  ─────────────────────────  │
│  MODIFICATIONS (3) [+Tout] [↩Tout]
│    M  requirements/SW-003…  [+][↩]  ← [+]=stage, [↩]=discard
│    A  requirements/SW-004…  [+][↩]
│    D  tests/TEST-001…       [+][↩]
│  ─────────────────────────  │
│  HISTORIQUE                 │
│    abc1234  Fix SW-001      │  ← ⎇ visible au survol si 0 mod.
│    def5678  Add SW-002      │
│    ghi9012  Init projet     │
└─────────────────────────────┘
```

Si on est sur la branche d'intégration (main) :
```
│  BRANCHE COURANTE           │
│  🌿 main                    │
│  [ + Nouvelle branche… ]    │  ← ouvre le formulaire inline
```

**Section "Branche courante" :**
- Affiche le nom de la branche active
- Sur la branche d'intégration (`main`) : bouton `+ Nouvelle branche…` uniquement
- Sur une branche de travail : bouton `[⎇ Merger]` + `[✕ Supprimer]`

**Bouton `[⎇ Merger]` :**
- Premier clic : confirmation inline "Merger dans main ? [Oui] [Non]" — **pas de `window.confirm()`**
- Oui → `api.branches.merge(repoPath, currentBranch)` → invalide les queries → navigue vers `/project/$id`
- Si conflit → affiche les conflits pour résolution (même UI que l'ancienne résolution Action)

**Bouton `[✕ Supprimer]` :**
- Premier clic : confirmation inline "Supprimer cette branche ? [Oui] [Non]"
- Oui → `api.branches.checkout(repoPath, integrationBranch)` puis `api.branches.delete(repoPath, branchName)`

**Section "Items affectés" :**
- Calculé via `api.branches.affectedItems(repoPath)` — `refetchInterval: 5000` ms
- Affichage informatif uniquement (badges d'IDs)
- Vide si on est sur `main` ou si aucun fichier spec n'a changé

**Formulaire "Nouvelle branche" (`/branch/new`) :**

```
┌─────────────────────────────────────┐
│  Nouvelle branche                   │
│  ───────────────────────────────── │
│  Nom de la branche *                │
│  [ feat/fix-bat-thermal         ]  │
│  ℹ Convention : feat/…, fix/…,     │
│    jira/PROJ-123-…                  │
│                                     │
│  [ Créer ]  Annuler                 │
└─────────────────────────────────────┘
```

- Valide que le nom est un identifiant git valide (pas d'espaces, pas de `..`)
- `api.branches.create(repoPath, name)` puis `navigate({ to: '/project/$id' })`

**Staging (section "Stagés") :**
- Affiche les fichiers dont l'index diffère de HEAD — ce sont les fichiers qui seront inclus dans le prochain commit
- Clic sur le nom du fichier → navigue vers `/diff?projectId=...&filepath=...`
- Bouton `−` par fichier → `api.sync.unstage(repoPath, filepath)` (désindexe le fichier)
- Bouton `−Tout` → confirmation inline "Désindexer tout ? [Oui] [Non]" → `api.sync.unstageAll(repoPath)`
- Bouton `Committer…` → ouvre la modal de commit — **visible et activé uniquement si `staged.length > 0`**
- `commitMutation.mutationFn` lance une erreur si `staged.length === 0` (double garde)

**Modifications non stagées (section "Modifications") :**
- Affiche les fichiers modifiés dans le workdir non encore indexés
- Clic sur le nom du fichier → navigue vers `/diff?projectId=...&filepath=...`
- Bouton `+` par fichier → `api.sync.stage(repoPath, filepath)` (indexe le fichier)
- Bouton `↩` par fichier → confirmation inline par fichier `[✓][✕]` → `api.sync.discard(repoPath, filepath)` (restaure depuis HEAD, ou supprime si fichier nouveau)
- Bouton `+Tout` → `api.sync.stageAll(repoPath)` (indexe tout)
- Bouton `↩Tout` → confirmation inline "Annuler tout ? [Oui] [Non]" → discard sur tous les fichiers unstaged

**Couleur des marqueurs de statut :**
- `A` (ajout) : vert
- `M` (modification) : ambre
- `D` (suppression) : rouge

**Boutons toujours visibles** — pas de `opacity-0 group-hover`. Les petits boutons `+`, `−`, `↩` sont affichés en permanence.

**Polling :** `refetchInterval: 3000` ms (3 secondes).

**Lien "Voir l'historique…" :**
- En bas du panneau Version
- Navigue vers `/graph?projectId=...`

**Channel IPC `sync:checkout-commit` :**

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `sync:checkout-commit` | `repoPath: string, sha: string` | `void` |

### 19.9 Panneau — Produit

Tabs `[Exigences | Tests | Campagnes]` directement sous le header. Contenu piloté par le schema produit (niveaux et types définis dans `.polenta/schema.yaml`).

```
┌─────────────────────────────┐
│  PRODUIT            [🔍][+] │
│  ─────────────────────────  │
│  Exigences|Tests|Campagnes  │
│  ─────────────────────────  │
│  ● SYS-001  Autonomie min…  │  ← dot statut
│  ● SYS-002  Sécurité surcha │
│  ● PROD-001 Temps charge <2h│
└─────────────────────────────┘
```

- Tab **Exigences** : liste plate filtrée, dot de statut, clic → `/req/$reqId?projectId`
- Tab **Tests** : liste avec icône dernier résultat (✓ ✗ ○), clic → `/test/$testId?projectId`
- Tab **Campagnes** : liste avec statut (planned/in-progress/completed), clic → `/campaign/$campaignId?projectId`
- `[+]` → crée un item dans le tab actif
- `[🔍]` → filtre texte en ligne

**Dot de statut exigences :**

| Statut | Couleur |
|--------|---------|
| `draft` | gris |
| `review` | orange |
| `approved` | vert |
| `obsolete` | barré |

**Icône dernier résultat tests :**

| Icône | Sens |
|-------|------|
| ✓ | Dernier run = passed |
| ✗ | Dernier run = failed |
| ○ | Jamais exécuté |

### 19.9.1 Route `/req/new` — Création d'exigence

Search params : `{ repoPath, projectId, component?, level? }`

Les types et champs disponibles sont chargés depuis le schema du contexte (produit si `component` absent, schema du composant sinon).

| Champ | Contrôle | DTO cible |
|-------|----------|-----------|
| Titre * | `input[text]` | `title` |
| Type * | `select` — valeurs depuis schema | `type` |
| Champs dynamiques | selon `FieldDefinition[]` du type sélectionné | `fields.*` |
| Exigence parente | `input[text]` (ID optionnel) | `parentId` |

Appel : `api.requirements.create(repoPath, { type, title, parentId, fields })`

Après succès : `navigate({ to: '/req/$reqId', params: { reqId: result.id }, search: { repoPath, projectId, component, level } })`

### 19.9.2 Route `/req/$reqId` — Détail/édition d'une exigence

Search params : `{ repoPath, projectId, component?, level? }`

Champs pré-remplis et éditables inline. Boutons :
- **Sauvegarder** : `api.requirements.update(repoPath, reqId, { title, fields, modificationComment })`
- **Transitions** : `draft` → review → approved → obsolete via `api.requirements.transition()`
- Si `component` présent dans les search params → champ en lecture seule si `readonly: true` dans `schema.components`

### 19.10 Panneau — Composants

Deux sélecteurs sur la même ligne, puis tabs identiques au panel Produit.

```
┌─────────────────────────────┐
│  COMPOSANTS         [🔍][+] │
│  [motor-ctrl ▾][Fonct.  ▾] │  ← même ligne
│  ─────────────────────────  │
│  Exigences|Tests|Campagnes  │
│  ─────────────────────────  │
│  ● REQ-MC-001  Couple max…  │
│  ● REQ-MC-002  Courant max… │
└─────────────────────────────┘
```

- **Sélecteur 1** `[composant▾]` : liste les `schema.components` du projet. Valeur persistée dans l'URL (`?component=motor-control`).
- **Sélecteur 2** `[niveau▾]` : liste les `schema.levels` du composant sélectionné (lu depuis son propre `.polenta/schema.yaml`). Valeur persistée dans l'URL (`?level=functional`).
- Tabs, dot statut, icônes résultat : identiques au panel Produit
- `[+]` désactivé si le composant est `readonly: true`

### 19.10.1 Route `/test/new` — Création de cas de test

Search params : `{ repoPath, projectId, component?, level? }`

| Champ | Contrôle | DTO cible |
|-------|----------|-----------|
| Titre * | `input[text]` | `title` |
| Type * | `select` — valeurs depuis schema | `type` |
| Préconditions | `textarea` | `preconditions` |
| Étapes | liste dynamique `[+][-]` : Action + Résultat attendu | `steps[]` |
| Postconditions | `textarea` | `postconditions` |
| Champs dynamiques | selon `FieldDefinition[]` du type | `fields.*` |

Appel : `api.tests.create(repoPath, { title, type, preconditions, steps, postconditions, fields })`

### 19.10.2 Route `/test/$testId` — Détail/édition d'un cas de test

Search params : `{ repoPath, projectId, component?, level? }`

Champs pré-remplis et éditables. Bouton **Sauvegarder** : `api.tests.update(...)`. Section **Historique des runs** sous le formulaire.

### 19.10.3 Route `/campaign/new` — Création d'une campagne

Search params : `{ repoPath, projectId, component?, level? }`

| Champ | Contrôle | DTO cible |
|-------|----------|-----------|
| Titre * | `input[text]` | `title` |
| Description | `textarea` | `description` |
| Baseline | `input[text]` — tag git ou SHA | `baselineRef` |
| Cas de test | liste multi-sélection depuis les tests du contexte | `testCaseIds` |

Appel : `api.campaigns.create(repoPath, { title, description, baselineRef, testCaseIds, level, component })`

### 19.10.4 Route `/campaign/$campaignId` — Suivi d'une campagne

Affiche les cas de test avec leur statut courant dans la campagne (pending / passed / failed / blocked / skipped). Permet d'exécuter chaque test directement depuis la campagne.

### 19.11 Création de branche — pas de route dédiée (T130)

**Il n'existe pas de route `/branch/new`.** La création de branche est inline dans
`BranchCombobox.tsx` (panneau Version, sidebar) :

**Champ :**
- `name` : nom de la branche (validé : pas d'espaces, pas de `..`, caractères git autorisés)
- Suggestion de format affichée : `feat/…`, `fix/…`, `jira/PROJ-123-…`

**Comportement :**
- `api.sync.createBranch(repoPath, name)` (channel `sync:create-branch`, pas `branches:create` — voir
  §8/§11.2) → crée et checkout la branche, reste sur la vue courante (pas de navigation de route)
- **Ne pas utiliser `window.confirm()`** — tout état de confirmation se gère via un `useState` React inline

**Bouton "Merger" dans le panneau Version :**
- Premier clic : confirmation inline — **pas de `window.confirm()`**
- Oui → `api.sync.merge(repoPath, currentBranch)` (channel `sync:merge`) → invalide les queries

### 19.12 Zone principale

Affiche le détail de l'élément sélectionné dans la sidebar. Par défaut (rien de sélectionné) : vide ou message d'accueil.

| Sélection sidebar | Zone principale |
|------------------|----------------|
| Aucune | Vide |
| Exigence | Détail de l'exigence (lecture/édition) |
| Test | Détail du test + historique des runs |
| Commit (historique) | Diff du commit |

### 19.13 Routing avec le nouveau layout

Le layout racine (`__root.tsx`) adopte la structure sidebar + main. La route `/login` reste plein écran (sans sidebar).

```
/ (root layout)
├── /login              → plein écran (pas de sidebar)
└── (avec sidebar)
    ├── /               → panneau Projet actif par défaut
    ├── /project/$id    → panneau Projet actif, currentProjectId lu depuis params
    ├── (pas de /branch/new — création de branche inline dans BranchCombobox, voir §19.11)
    ├── /schema         → panneau Projet actif, projectId depuis search param
    ├── /graph          → panneau Version actif, projectId depuis search param
    ├── /diff           → panneau Version actif, projectId + filepath depuis search param
    ├── /product        → panneau Produit actif, projectId + tab depuis search param
    ├── /req/new        → Produit si component absent, Composants sinon
    ├── /req/$id        → Produit si component absent, Composants sinon
    ├── /test/new       → Produit si component absent, Composants sinon
    ├── /test/$id       → Produit si component absent, Composants sinon
    ├── /campaign/new   → Produit si component absent, Composants sinon
    ├── /campaign/$id   → Produit si component absent, Composants sinon
    └── /components     → panneau Composants actif, projectId + component + level + tab
```

**`AppLayout` — lecture du `currentProjectId` :**
- `/project/$id` → lu depuis les path params
- Toutes les autres routes → lu depuis le search param `projectId`

```tsx
const { pathname, search } = useRouterState({
  select: s => ({ pathname: s.location.pathname, search: s.location.search })
})
const projectIdFromPath = pathname.match(/^\/project\/(.+)$/)?.[1] ?? null
const searchParams = new URLSearchParams(search ?? '')
const projectIdFromSearch = searchParams.get('projectId')
const currentProjectId = projectIdFromPath ?? projectIdFromSearch ?? null
```

Le type `Panel = 'account' | 'project' | 'version' | 'product' | 'components'`

Déduction du panel actif depuis `pathname` + search params :
- `/product` → `'product'`
- `/components` → `'components'`
- `/req/*`, `/test/*`, `/campaign/*` avec `?component=…` → `'components'`
- `/req/*`, `/test/*`, `/campaign/*` sans `component` → `'product'`
- `/branch/*`, `/graph`, `/diff` → `'version'`
- `/project/*`, `/schema` → `'project'`
- Sinon → `'project'`

### 19.14 Nouveaux channels IPC nécessaires

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `sync:log` | `repoPath: string, limit?: number` | `CommitEntry[]` |
| `sync:checkout-commit` | `repoPath: string, sha: string` | `void` |
| `app:set-title` | `title: string` | `void` (one-way) |
| `app:get-version` | — | `string` (`app.getVersion()`) |
| `app:get-settings` | — | `AppSettings` (GH26, `userData/app-settings.json`) |
| `app:set-settings` | `patch: Partial<AppSettings>` | `AppSettings` |
| `app:open-release-page` | `url: string` | `void` — `shell.openExternal`, restreint à `https://github.com/laurentolive/polenta/releases/` |
| `update:get-state` | — | `UpdateState` (GH26) |
| `update:install` | — | `void` — `quitAndInstall` si `status === 'ready'`, sinon no-op |
| `update:state-changed` | push main → **toutes** les fenêtres | `UpdateState` (`window.polenta.on`, hook `useUpdateState`) |
| `schema:get` | `repoPath: string` | `ProjectSchema` |
| `schema:save` | `repoPath: string, schema: ProjectSchema` | `void` |
| `branches:create` | `repoPath: string, name: string` | `void` |
| `branches:checkout` | `repoPath: string, name: string` | `void` |
| `branches:delete` | `repoPath: string, name: string, force?: boolean` | `void` |
| `branches:merge` | `repoPath: string, fromBranch: string` | `MergeResult` |
| `branches:affected-items` | `repoPath: string` | `string[]` |
| `dialog:pick-image-file` | — | `{ mimeType: string; base64: string } \| null` |
| `sync:stage` | `repoPath: string, filepath: string` | `void` |
| `sync:stage-all` | `repoPath: string` | `void` |
| `sync:unstage` | `repoPath: string, filepath: string` | `void` |
| `sync:unstage-all` | `repoPath: string` | `void` |
| `sync:discard` | `repoPath: string, filepath: string` | `void` (restaure depuis HEAD ou supprime si nouveau fichier) |
| `sync:graph` | `repoPath: string, limit?: number` | `GraphCommit[]` |
| `sync:diff` | `repoPath: string, filepath: string` | `{ oldContent: string; newContent: string }` |
| `campaigns:list` | `repoPath: string, component?: string, level?: string` | `TestCampaign[]` |
| `campaigns:get` | `repoPath: string, id: string` | `TestCampaign` |
| `campaigns:create` | `repoPath: string, dto: CreateCampaignDto, workspaceDir?: string` | `TestCampaign` (T171 : résout et fige les paramètres) |
| `campaigns:preview-params` | `repoPath, { campaignId? \| baselineRef? }, testCaseIds: string[], workspaceDir?` | `ParamResolutionPreview[]` (T171, sans écriture) |
| `parameters:list` / `parameters:usages` / `parameters:create` / `parameters:update` / `parameters:delete` | `repoPath` (repo de la base), …, `workspaceDir?` | T171 — base de paramètres (voir SPEC-REQ §3.2f) |
| `campaigns:update-run` | `repoPath: string, campaignId: string, testCaseId: string, status: TestRunStatus` | `TestCampaign` |
| `campaigns:close` | `repoPath: string, id: string, status: 'completed' \| 'abandoned'` | `TestCampaign` |

### 19.15 Barre de titre des vues (`ViewHeader`) et en-tête des panneaux latéraux (T92)

Toutes les vues principales (routes + `SystemView`) partagent un unique composant d'en-tête,
`components/layout/ViewHeader.tsx`, plutôt que de redéfinir chacune leur propre `<h1>` :

- Conteneur : `shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-edge bg-surface`.
- Slots : `back` (bouton retour optionnel), `title` (chaîne ou nœud React — un titre éditable
  inline comme sur Suivi passe directement son `<input>`), `subtitle` (ligne secondaire, ex. le
  nom de branche sur Version), `actions` (boutons propres à la vue : Enregistrer, Ajouter un
  widget, undo/redo, sélecteur de vue, `RichTextToolbar`…).
- Le slot Publier est **toujours réservé** en dernière position : `ViewHeader` monte lui-même
  `<ModificationControl currentProjectId={...} />` dès que `currentProjectId` est fourni (omis
  uniquement sur les vues hors contexte projet, ex. `/account`). `ModificationControl` n'est donc
  plus monté globalement par `AppLayout` — il apparaît dans le flux normal de la barre de titre de
  chaque vue, jamais en `position: fixed`.
- GH38 : le bouton "Publier" s'active dès qu'**un** repo du workspace a des modifications en
  attente (`useModificationMode.pendingRepos`, statut de chaque repo interrogé toutes les 3 s), et
  le popup de titre liste les repos qui seront publiés (cf. `SPEC-FORKS-BRANCHES-BASELINES.md`
  §2.1, « Publication multi-repo »). Visibilité et message « branche bloquée » restent pilotés par
  le repo concerné.
- `ModificationControl` : conteneur racine `relative flex items-center gap-2 shrink-0`. Ses
  popups (saisie du titre de publication, erreur/conflit) sont des popovers ancrés sous le bouton
  (`absolute right-0 top-full mt-2 z-50`, largeur fixe `w-96` — **ne pas** utiliser `w-full` sur un
  élément `absolute` dont l'ancêtre positionné n'est pas plein écran, sinon le popup se réduit à la
  largeur du bouton), avec une couche de capture de clic invisible (`fixed inset-0 z-40`, sans
  assombrissement) reprenant le pattern déjà utilisé par `FieldConfigModal` — plus l'ancien
  `Overlay` plein écran centré.
- Vues volontairement hors de cette convention : `login.tsx` (écran pré-authentification) et
  `version-diff.tsx` (layout à deux colonnes sans titre de vue "premier niveau" — son panneau
  `w-64` "Comparer" suit déjà la convention panneau latéral ci-dessous).
- **Export (T43)** : `components/export/ExportButton.tsx` est l'usage standard du slot `actions`
  pour toute vue proposant un export de son contenu — bouton "Exporter" + popover de formats
  (xlsx/docx/pdf selon la vue, cf. `specs/T43.md` §2 pour le mapping), branché dans `SystemView.tsx`
  (cahier d'exigences/tests), `campaign.$campaignId.tsx` (cahier/rapport de campagne, deux boutons),
  `query.tsx`, `impact-analysis.tsx` et `dashboard.tsx`. Ce composant a remplacé l'ancien bouton
  d'export inline de `query.tsx` (mutation dédiée + canal IPC `queries:export-excel` ad hoc,
  retirés) — tout nouvel export de vue doit passer par ce mécanisme partagé (canal IPC générique
  `export:save`, `ExportService` côté main process), pas par un bouton/canal spécifique à la vue.
  Pour les kinds/formats acceptant un gabarit client (GH34, `renderer/lib/exportTemplates.ts`), le
  popover affiche au-dessus des formats une liste « Gabarit Word » — cf. §19.15a.

#### 19.15a Export à partir d'un gabarit client (GH34)

Le client fournit ses gabarits Word (page de garde, logo, en-têtes/pieds, cartouche, styles) avec des
balises `{{…}}`, et Excel (cartouche, mise en forme, formules, graphiques) avec des balises `${…}` ;
Polenta les remplit. Le rendu « Standard » (générateurs T43) reste disponible et
inchangé. Spec/design : `specs/GH34.md`, `specs/GH34-design.md` ; référence utilisateur des balises :
`apps/desktop/resources/export-templates/Référence des balises.html`.

- **Bibliothèque** : préférence application `exportTemplatesDir` (`app-settings.json`, réglée dans le
  panneau Compte › Préférences, avec « Installer les exemples »). Dossier lu tel quel (local, réseau,
  repo cloné), jamais écrit hors installation des exemples ; `.docx`/`.xlsx` listés récursivement
  (5 niveaux, `~$*` et fichiers cachés exclus), identifiés par **chemin relatif** `/`
  (`ExportTemplateLibrary`, IPC `export-templates:list`). Résolution refusant toute sortie du dossier.
- **Défaut par projet** : `schema.yaml` › `preferences.exportTemplates` (`<kind>:<format>` → chemin
  relatif), page Préférences du projet ; partagé par l'équipe, valable quel que soit l'emplacement de
  la bibliothèque sur chaque poste.
- **Popover Exporter** : « Standard » + gabarits du format, défaut du projet présélectionné ; défaut
  introuvable → affiché « ⚠ … (introuvable) » désactivé, Standard présélectionné, message ; bouton de
  format désactivé tant que la liste n'est pas chargée. Le gabarit choisi est passé à `export:save`
  (`templateRelPath`) ; le renderer joint alors à son payload l'arbre complet (`outline` : dossiers,
  niveau, étapes détaillées, `statusLabel`, cf. `buildExportOutline`). Kinds pris en charge — docx :
  `requirements`, `tests`, `campaign-plan`, `campaign-report`, `dashboard` ; xlsx : `requirements`,
  `tests`, `campaign-plan`, `query-result`, `impact-analysis` (`renderer/lib/exportTemplates.ts`,
  miroir de `DATA_BUILDERS` côté main). Une liste par format accepté (« Gabarit Word », « Gabarit Excel »).
- **Moteur** (`main/services/export/template/`) : `TemplateExportService` construit les données
  (communes `project`/`export`/`git` + par kind : `template-data.ts`, `template-data-campaign.ts` —
  le rapport de campagne lit les résultats par étape de l'exécution `runId` via `TestsService`),
  `docx-template.ts` remplit le gabarit (docxtemplater, délimiteurs `{{ }}`, `paragraphLoop`,
  donnée absente → vide, erreurs traduites avec gabarit + balise, aucun fichier écrit en cas d'erreur).
- **Contenu riche** (`{{@rich.<champ>}}`, aussi sur `columns` et `steps`) : `markdown-to-ooxml.ts`
  convertit le Markdown aux styles du gabarit retrouvés **par nom** (`heading N`, `List Paragraph`,
  `Table Grid`, `Quote`, `HTML Code` — l'ID dépend de la langue de Word) ; listes numérotées
  ré-allouées à chaque insertion (`RichFragment`, chaque liste repart à 1), cases à cocher, tableaux,
  images (taille/rognage de l'éditeur, en fractions), ramenées à la largeur utile. `docx-package.ts`
  complète le paquet (médias, relations, content types, `numbering.xml` dans l'ordre du schéma,
  cellules terminées par un paragraphe, IDs de dessins renumérotés). Gabarit sans `{{@…}}` : aucune
  conversion. Dashboard : `{{@table}}` par widget (tableau construit par Polenta, docxtemplater n'ayant
  pas de boucle de colonnes).
- **Diagrammes draw.io** : rendus en PNG (×2) en une passe avant conversion, par une fenêtre cachée
  offscreen sur la route `/print/drawio-snapshot` (même viewer, même page/ancre/taille/rognage que la
  Vue Word via `renderStaticDrawio(…, onDone)`) et `capturePage` (`drawio-snapshot.ts`, IPC scoped
  `export:drawio-snapshot-ready`). Échec (fichier absent, XML invalide, délai) → `[Diagramme : …]`,
  captures déjà faites conservées.
- **Table des matières** : un gabarit contenant un champ `TOC` reçoit `w:updateFields` (ordre du
  schéma de `settings.xml` respecté) — Word la recalcule à l'ouverture. Avant le rendu, un
  caractère de champ partageant un paragraphe avec une balise de section (`{{#…}}`/`{{/…}}`), que
  `paragraphLoop` supprimerait avec le paragraphe, est isolé dans son propre paragraphe
  (`isolateFieldChars`, cas typique : fin du champ TOC collée au paragraphe suivant). Gabarits
  d'exemple Word : page « Sommaire » (`TOC \o "1-4" \u`, titres d'éléments au niveau hiérarchique 4 —
  pas `\t "Style,4"`, dont le séparateur dépend des paramètres régionaux).
- **Excel** (`xlsx-render.ts`, `template-data-xlsx.ts`) : xlsx-template (MIT, travaille sur le XML du
  classeur : logo, graphiques, autres feuilles, mise en page conservés) ; balises `${a.b}`, ligne
  modèle `${table:<liste>.<champ>}` (balise seule dans sa cellule) répétée avec sa mise en forme,
  `${columnNames}` / `${table:rows.cells}` pour des colonnes inconnues (résultat de requête). Données en
  texte simple, champs `number` du schéma en nombres ; une ligne par élément (dossiers en
  `folder`/`folderPath`), procédure en `stepsText`. **Réécriture des références** (`xlsx-refs.ts`,
  coordonnées du gabarit → classeur produit) que xlsx-template laisse sur la ligne modèle : plages
  couvrant une ligne modèle étendues (formules de toutes les feuilles, `sqref` de mise en forme
  conditionnelle — y compris `x14` — et de validation, filtre automatique, séries de graphiques, noms
  définis/zone d'impression), références situées dessous décalées ; dans une ligne générée,
  sémantique de recopie d'Excel (composantes de ligne relatives décalées du rang : `=D6*2` → `=D7*2`,
  cumul `SOMME(D$6:D6)`), `fullCalcOnLoad`. Valeurs commençant par `=` préfixées d'un U+200B (jamais
  écrites comme formules). Liste vide : ligne modèle conservée vidée. Combinaison produisant deux
  cellules à la même adresse (bug xlsx-template avec liste de cellules + recopie de ligne, option
  désactivée dans ce cas) → erreur explicite plutôt qu'un classeur illisible.
- **Vérification** : `apps/desktop/scripts/check-gh34.ts` (contrôles automatiques, `--keep` pour
  ouvrir les documents ; gabarit client Excel de référence `scripts/fixtures/gh34-client.xlsx`, fait
  par Excel via `make-gh34-client-xlsx.ps1`) ; `scripts/e2e-gh34-drawio.mjs` (export Word avec capture
  draw.io + export Excel, app buildée ou packagée via `E2E_EXE`).

Les panneaux latéraux (sidebar) suivent une convention distincte, désormais généralisée à tous :
un conteneur `px-4 py-3 border-b border-edge` contenant `<p className="section-label">` (classe
existante, `index.css` : `text-xs font-semibold text-ink-3 uppercase tracking-wider`) avec le nom
du panneau tel qu'affiché dans `ActivityBar` (Projet, Version, Système, Suivi, Exigences, Tests,
Compte, Recherche). Seul ce bandeau de titre est concerné — les combobox/filtres/listes sous le
header gardent leur propre padding.

### 19.16 Système de classes de boutons (`index.css`, T115)

Tous les boutons du renderer utilisent l'une des classes suivantes (`@layer components`,
`apps/desktop/src/renderer/index.css`) — jamais une redéfinition Tailwind inline dupliquant l'une
d'elles :

- **3 couleurs sémantiques** : `.btn-primary` (action principale, fond `--prim`),
  `.btn-secondary` (action secondaire, bordure `edge`), `.btn-danger` (action destructive/risque
  de perte de données — **plein rouge** `bg-red-600`, volontairement pas de style outline : la
  couleur seule doit rester reconnaissable quel que soit le contexte ou la taille).
- **2 tailles par couleur** : suffixe `-sm` pour la variante compacte (`px-3 py-1.5 text-xs`,
  ex. `.btn-primary-sm`) vs. la taille standard (`px-4 py-2 text-sm`, ex. `.btn-primary`). Choix
  standard/compact dicté par le contexte, pas par préférence : compact dans le slot `actions` de
  `ViewHeader` (§19.15), dans un popover ancré (largeur type `w-96`), ou en ligne dans une
  liste/tableau dense ; standard en pied de modale pleine largeur ou sur une page de formulaire
  dédiée. Le bouton "Publier" (`ModificationControl.tsx`) est le seul site à ajouter `shadow` en
  plus de `.btn-primary-sm` — emphase réservée au CTA le plus important du header, pas une
  propriété générale du profil compact.
- **`.btn-icon`** : bouton icône seule (undo/redo, ajouter une ligne, toggle…), sans couleur de
  texte par défaut — l'appelant ajoute `text-ink-3 hover:text-ink` (neutre) ou `text-prim`
  (accent, ex. actions "ajouter").
- **`.btn-close`** : bouton "×" de fermeture d'en-tête de modale.
- **`.btn-sm`** : classe neutre préexistante (`px-2 py-1 text-xs`), plus compacte encore que les
  variantes `-sm` ci-dessus — conservée telle quelle pour ses usages existants
  (`SearchPanel.tsx`, `VersionRepoFolder.tsx`) ; les nouveaux boutons secondaires compacts doivent
  utiliser `.btn-secondary-sm`, pas `.btn-sm`.

Hors de ce système (volontairement, cf. `specs/T115.md` Hors scope) : badges de statut non
cliquables (`rounded-full` coloré), éléments de menu déroulant/contextuel à action discrète et
lignes de sélection de combobox/liste (ex. `AccountMenu.tsx`, `GitRefCombobox.tsx`,
`ExcelView.tsx` menu de tri) — ces derniers restent en Tailwind inline, non harmonisés par T115.

### 19.17 Vue Recherche (`/search`, activité « Recherche ») — T107, T167

**Panneau latéral** (`SearchPanel.tsx`) : champ de recherche + options (respecter la
casse `Aa`, mot entier `ab|`, regex `.*`), remplacement (`Remplacer` / `Tout
remplacer`, option « Conserver la casse » `AB`), filtres de type (Exig. / Tests /
Camp.), et liste hiérarchique des résultats (élément → occurrences avec extrait
surligné). Le remplacement ne s'applique qu'aux exigences et tests (pas d'endpoint
`update` générique pour les campagnes).

**Zone principale** (`routes/search.tsx`) : depuis T167, n'est plus une page vide.

- Recherche vide / regex invalide → état vide (icône + message d'invitation).
- Recherche valide sans résultat → message « aucun résultat ».
- Recherche avec résultats → **`SearchResultsDoc`** : une carte **lecture seule**
  par élément (présentation d'une carte de la Vue Word — en-tête badge
  catégorie / id / titre / statut / version, puis tous les champs du type rendus
  en lecture, `richtext` via `StaticRichTextViewer`, étapes de test en liste).
  Types hétérogènes → **pas de vue Tableau**, pas de dossiers / sections. Les
  occurrences du terme recherché sont **surlignées** (`<mark>`) dans l'id, le
  titre, les champs texte et — best effort — les champs `richtext`
  (`StaticRichTextViewer` prop `highlightRegex`, `TreeWalker`, ignore
  `pre`/`code`/`.static-drawio`).

**Clic simple** sur un résultat (panneau **ou** carte) → « goto » : la zone
principale défile jusqu'à la carte (`useScrollToNode`, `data-node-id` = id de
l'élément) + contour bleu persistant, exactement comme le clic simple dans l'arbre
des vues Exigences / Tests (cf. `SPEC-SYSTEM-VIEW` §goto, T164). Le clic simple ne
navigue plus vers la page détail.

**Double-clic** sur un résultat :
- exigence / test → **édition inline** dans la zone principale
  (`SearchEditPane` → composant `EditView`, le même que le double-clic en Vue
  Système : autosave par champ, section Liens, table Étapes, badge couverture,
  `Ctrl/Cmd+Entrée` = valider, `Échap` / bouton « Retour aux résultats » =
  retour). **Aucune navigation routeur** — `/search` est conservé. `SearchEditPane`
  est une version allégée de la machinerie `SystemView` (pas d'arbre : le champ
  « Nom » édite directement le `title` ; pas d'undo/redo, pas de DnD, pas de
  création, pas de retour arrière multi-niveaux). La navigation vers un objet lié
  depuis la section Liens ouvre un **nouvel onglet**.
- campagne → navigation vers `/campaign/$campaignId` (pas d'édition générique).

**Partage d'état** : `SearchProvider` (`contexts/SearchContext.tsx`) monté dans
`AppLayout` (branche `currentProjectId`, `key={currentProjectId}`). Porte la
requête, les options, les filtres de type, les résultats calculés, la cible goto
et la cible d'édition — consommé par `SearchPanel` (sidebar) et la route `/search`
(`<Outlet/>`), sous-arbres React distincts. Les requêtes de liste
(`['requirements'|'tests'|'campaigns', repoPath]`) restent `enabled: !!regex` :
aucun fetch tant qu'aucune recherche n'est saisie. La recherche survit désormais à
la navigation hors Recherche puis au retour (provider monté tant qu'un projet est
ouvert) ; remise à zéro au changement de projet. `routes/search.tsx` utilise
`useOptionalSearch()` (repli page d'invite) pour le cas où `/search` est atteint
sans projet ouvert.

---

## 20. Schéma de projet (`.polenta/schema.yaml`)

**T130 : cette section (20.1-20.7, écrite le 2026-06-12) décrivait un modèle de données
entièrement remplacé depuis** — `requirementTypes`/`testTypes` plats, `ComponentDefinition` avec
`url`/`branch`/`readonly` généraient un `.gitmodules` (aucune occurrence de `.gitmodules` dans le
code actuel — `grep -r gitmodules` → 0 résultat). Le modèle réel est celui documenté à jour dans
[SPEC-TEMPLATES.md](SPEC-TEMPLATES.md) §2-4 : `SystemNode` (imbrication `children` à profondeur
illimitée, `roles`/`implements` portés par le nœud), `ObjectTypeDefinition` (`category: requirement
| test | campaign`), `LinkTypeDefinition` (`sourceRefs`/`targetRefs`), `ProjectPreferences`. Les
composants en repo séparé sont découverts via `polenta-repo.yaml` dans un workspace plat (T69, voir
§22), pas via des submodules Git déclarés dans le schéma.

Le schéma définit les types d'items, leurs champs personnalisés et les liens possibles entre eux. Il est **versionné dans le repo** à `.polenta/schema.yaml` — chaque branche peut avoir son propre schéma.

### 20.1 Format du fichier

Voir [SPEC-TEMPLATES.md](SPEC-TEMPLATES.md) §2-4 pour la référence à jour et détaillée (format
complet, imbrication de composants locaux, interfaces `roles`/`implements`, sens obligatoire d'un
linkType de couverture). Extrait minimal :

```yaml
version: 1
preferences:
  autoPropagatePin: false
nodes:
  - name: root
    label: Produit
    readonly: false
    objectTypes:
      - name: exigence-systeme
        label: Exigence Système
        prefix: SYS
        category: requirement   # requirement | test | campaign
        fields:
          - { name: statement, label: Énoncé, type: richtext, required: true, validator: EARS }
          - { name: priority, label: Priorité, type: enum, values: [high, medium, low], required: true }
        statuses:
          - { name: draft, label: Brouillon }
          - { name: approved, label: Approuvé, isApproval: true }
    children: []               # composants locaux imbriqués (T123), profondeur illimitée
linkTypes:
  - name: verified-by
    labelSourceToTarget: "vérifie"
    labelTargetToSource: "est vérifiée par"
    sourceRefs: [test]
    targetRefs: [requirement]
```

Il n'y a **pas** de `requirementTypes`/`testTypes`/`components`/`levels` au niveau racine, et
**aucun `.gitmodules` généré** — confirmé par lecture de code (`grep -r gitmodules` sur tout le
repo → 0 résultat). Les composants en repo séparé sont déclarés dans `polenta-repo.yaml`, pas dans
`schema.yaml` (voir §22).

### 20.2 Types TypeScript (`packages/types/src/schema.ts`)

```typescript
export type SchemaFieldType =
  | 'text' | 'textarea' | 'number' | 'enum' | 'multi_enum' | 'boolean'
  | 'date' | 'datetime' | 'richtext' | 'user' | 'drawio'

export interface SchemaField {
  name: string
  label?: string
  type: SchemaFieldType
  values?: string[]          // enum / multi_enum uniquement
  required?: boolean
  default?: unknown
  placeholder?: string
  validator?: string         // "EARS" | "regex:<pattern>"
}

export interface SchemaStatus {
  name: string
  label?: string
  color?: string
  isApproval?: boolean
  isTerminal?: boolean       // masque l'objet des listes par défaut (ex: obsolete)
}

export type ObjectCategory = 'requirement' | 'test' | 'campaign'

export interface ObjectTypeDefinition {
  name: string
  label?: string
  color?: string
  prefix?: string            // unique sur l'ensemble du projet, tous nœuds confondus
  category: ObjectCategory
  fields: SchemaField[]
  statuses?: SchemaStatus[]
}

// Composant du système : local (vit dans le schema.yaml courant) ou avec repo séparé
// (déclaré dans polenta-repo.yaml, voir §22) — mêmes capacités dans les deux cas.
export interface SystemNode {
  name: string
  label: string
  description?: string
  readonly: boolean
  objectTypes?: ObjectTypeDefinition[]
  children?: SystemNode[]         // composants locaux imbriqués, profondeur illimitée (T123)
  roles?: RoleDefinition[]        // ce composant expose une interface (T123)
  implements?: ImplementsDeclaration[]  // interfaces implémentées par ce composant (T123)
}

export interface RoleDefinition { name: string; label?: string }
export interface ImplementsDeclaration { interface: string; roles: string[] }

export interface LinkTypeDefinition {
  name: string
  labelSourceToTarget: string
  labelTargetToSource: string
  sourceRefs?: string[]      // catégorie ("requirement"|"test"|"campaign") ou "nœud::type"
  targetRefs?: string[]
}

export interface ProjectPreferences {
  autoPropagatePin?: boolean  // propagation auto du pin sous-repo → parent au commit
}

export interface ProjectSchema {
  version: number
  nodes: SystemNode[]
  linkTypes: LinkTypeDefinition[]
  roles?: RoleDefinition[]              // @deprecated T123 — miroir de nodes[root].roles
  implements?: ImplementsDeclaration[]  // @deprecated T123 — miroir de nodes[root].implements
  preferences?: ProjectPreferences
}
```

Il n'existe **pas** de `RequirementTypeDefinition`/`TestTypeDefinition`/`ComponentDefinition`/
`LevelDefinition` — remplacés par `ObjectTypeDefinition`/`SystemNode` ci-dessus.

**`packages/types/src/config.ts` n'est pas une cible future.** Son propre en-tête dit :
`// SUPERSEDED — remplacé par ProjectSchema dans schema.ts. À supprimer lors de l'implémentation
une fois les consommateurs migrés.` — c'est du code mort en attente de suppression, pas un modèle
vers lequel `schema.ts` migrerait. Aucun code ne consomme `ProjectConfig`/`FieldDefinition`/
`TransitionDefinition` aujourd'hui.

Les types de campagne (`TestCampaign`, `CampaignTestRun`, `CampaignStatus`, `TestRunStatus`) vivent
dans `packages/types/src/campaign.ts`, pas dans `schema.ts` — voir `SPEC-TESTS.md` §4 pour leur
format à jour (différent de l'exemple `CAMP-0001`/`testCaseIds` ci-avant : voir les écarts déjà
listés dans `SPEC-AUDIT.md`).

### 20.3 SchemaService (`apps/desktop/src/main/services/schema.service.ts`)

- Lit/écrit `.polenta/schema.yaml` via `fs`/`fs/promises` (working tree direct, pas git), parse
  avec `js-yaml`.
- Schéma par défaut si fichier absent/invalide : `{ version: 1, nodes: [{ name: 'root', label:
  'Produit', readonly: false, objectTypes: [] }], linkTypes: [] }` — un seul nœud vide, pas de
  types hardcodés `functional`/`safety`/`performance`/`interface`/`constraint`.
- Résultat mis en cache par `repoPath` ; `save()` met à jour le cache directement (pas de relecture
  disque).
- **Pas de génération de `.gitmodules`** — `save()` se contente d'écrire le YAML et de maintenir un
  miroir `roles`/`implements` niveau racine ↔ `nodes[root]` (compat T123, voir code).
- Mutations ciblées avec validation avant écriture (`SchemaValidationError`, jamais d'écriture si un
  invariant est violé) : `addNode` (avec `parentName` pour imbriquer, T123), `addObjectType`,
  `moveObjectType` (T135, drag & drop cross-nœud), `addField`, `addStatus`, `addLinkType`. Une file
  de promesses par `repoPath` sérialise les mutations concurrentes (agent MCP qui enchaîne
  plusieurs `add_*` sans attendre chaque réponse).
- `resolveComponentRepoPath(repoPath, objectTypeRef, workspaceDir?)` résout le repo réel d'un
  composant en repo séparé via le cache `WorkspaceTreeService` (T69) — `null` si `objectTypeRef` ne
  référence pas de composant externe (mono-repo ou nœud `root`).

### 20.4 IPC channels

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `schema:get` | `repoPath: string` | `ProjectSchema` |
| `schema:save` | `repoPath: string, schema: ProjectSchema` | `void` |
| `schema:move-element` | déplacement d'un `ObjectTypeDefinition` entre nœuds (T135) | `ProjectSchema` |

`schema:save` ne régénère **aucun** fichier dérivé de type `.gitmodules` — c'est le seul écart avec
la version précédente de cette section, à ne pas réintroduire dans une future correction.

`ApiClient.schema` : `get(repoPath)` + `save(repoPath, schema)` + `moveElement(...)`.

### 20.5 Formulaires dynamiques (renderer)

**Hook `useProjectSchema(repoPath)`** : appelle `api.schema.get(repoPath)`, mis en cache par TanStack Query.

**Composant `DynamicField`** : render un contrôle selon `SchemaField.type` (T130 : `SchemaFieldType`
réel a 11 valeurs, pas 7) :
- `richtext` → `<RichTextField>` (TipTap — voir §21)
- `text` → `<input type="text">`
- `textarea` → `<textarea>`
- `enum` → `<select>` avec `<option>` pour chaque valeur
- `multi_enum` → cases à cocher (`MultiEnumCheckboxes`), source ses options depuis le catalogue de
  rôles du composant si le champ s'appelle `roles` et que ce catalogue est non vide (T110/T126)
- `number` → `<input type="number">`
- `boolean` → `<input type="checkbox">`
- `date` → `<input type="date">`
- `datetime` → équivalent avec heure
- `user` → sélecteur d'utilisateur
- `drawio` → intégration diagramme (voir §21.7)

```tsx
<DynamicField
  field={fieldDef}
  value={fields[fieldDef.name] as string ?? ''}
  onChange={(val) => setFields(prev => ({ ...prev, [fieldDef.name]: val }))}
/>
```

**Routes req.new / req.$reqId / test.new / test.$testId** : chargent le schéma puis rendent dynamiquement les champs selon l'`objectTypeRef` sélectionné.

**T130 — retiré** : la section précédente affirmait un schéma par défaut avec des types
`functional`/`performance`/`safety`/`interface`/`constraint` pré-remplis. Le schéma par défaut réel
(`DEFAULT_SCHEMA` dans `schema.service.ts`) est `{ nodes: [{ name: 'root', objectTypes: [] }] }` —
un seul nœud vide, aucun type pré-configuré (voir §20.3).

### 20.6 Éditeur de modèle — Route `/schema`

**T130 : 2 onglets réels**, pas 3 (« Exigences »/« Tests »/« Liens ») :

- **Onglet Structure** (`StructureTab.tsx`) — arbre des nœuds (`root` + composants locaux/en repo
  séparé), chacun avec ses `objectTypes` (création/édition/suppression de type, champs, statuts),
  imbrication de composants locaux à profondeur illimitée (T123), rôles/interfaces exposés
  (`roles`/`implements`, T123), collapse/expand (T131). Voir `SPEC-TEMPLATES.md` §3-3b pour le détail
  fonctionnel complet.
- **Onglet Liens** (`LiensTab.tsx`) — gestion des `linkTypes` du projet.

[Enregistrer] → `api.schema.save(repoPath, …)` → invalide le cache TanStack Query `['schema',
repoPath]`.

### 20.7 Liens (UI) — implémentée, pas "sprint suivant"

**T130 :** contrairement à la note précédente ("sprint ultérieur"), l'onglet **Liens** ci-dessus
existe et permet d'ajouter/modifier/supprimer un `linkTypeDefinition` du projet.

---

## 21. Éditeur de texte enrichi (`RichTextField`)

### 21.1 Principe

Les champs de type `richtext` dans un schéma sont rendus par le composant `RichTextField` (TipTap v2 + `tiptap-markdown`). Le contenu est **stocké en Markdown** dans la valeur du champ YAML — git-diffable, lisible hors app.

### 21.2 Packages

```json
"@tiptap/react": "^2.4.0",
"@tiptap/starter-kit": "^2.4.0",
"@tiptap/extension-image": "^2.4.0",
"@tiptap/extension-link": "^2.4.0",
"@tiptap/extension-placeholder": "^2.4.0",
"tiptap-markdown": "^0.8.x"
```

### 21.3 Interface du composant

```tsx
interface Props {
  value: string        // Markdown string (lu depuis fields[name])
  onChange: (value: string) => void  // Markdown sérialisé
  disabled?: boolean
  placeholder?: string
}
```

### 21.4 Fonctionnalités

**Toolbar** (boutons `onMouseDown` + `e.preventDefault()` pour conserver le focus) :

| Bouton | Action |
|--------|--------|
| **B** | `toggleBold` |
| *I* | `toggleItalic` |
| ~~S~~ | `toggleStrike` |
| `` `…` `` | `toggleCode` (inline) |
| H2 / H3 | `toggleHeading` |
| • — | `toggleBulletList` |
| 1. | `toggleOrderedList` |
| ❝ | `toggleBlockquote` |
| `{ }` | `toggleCodeBlock` |
| 🖼 | Insérer image (fichier, voir §21.5) |

**Image par collage (paste)** *(T76)* : intercepté dans `editorProps.handlePaste` — lit le blob via `FileReader.readAsDataURL`, envoie le contenu par IPC (`api.image.writePaste`) qui l'écrit dans `images/` du repo courant, puis insère un nœud `image` avec `src` = chemin relatif du fichier créé. Sans `repoPath` (contexte repo indisponible), le collage est absorbé sans effet.

**Image par fichier** *(T76)* : bouton 🖼 (`ImageInsertButton`) → `api.image.pickFile(repoPath)` → copie le fichier choisi dans `images/` s'il est hors du repo (référence directe sinon) → insère `src` = chemin relatif.

Les images insérées via ces deux flux sont donc désormais **référencées par chemin de fichier**, jamais stockées inline — même principe que les diagrammes draw.io (§21.7, T47). Le contenu déjà stocké en base64 avant T76 continue de s'afficher tel quel (aucune migration), et une image référencée par URL externe (`![alt](https://...)`) reste rendue directement sans passage par le repo.

`api.dialog.pickImageFile()` (IPC `dialog:pick-image-file`) reste déclaré dans le contrat mais n'a plus aucun appelant richtext depuis T76 (conservé tel quel, hors périmètre de nettoyage de ce ticket).

### 21.5 IPC `image:*` (T76)

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `image:pick-file` | `repoPath` | `{ status: 'ok'; path; copied } \| { status: 'canceled' } \| { status: 'error'; message }` |
| `image:read` | `repoPath`, `relativePath` | `{ mimeType: string; base64: string } \| null` |
| `image:write-paste` | `repoPath`, `mimeType`, `base64` | `{ status: 'ok'; path } \| { status: 'error'; message }` |

Mirroir exact des channels `dialog:pick-drawio-file`/`drawio:read` (§21.7) : `image:pick-file` copie le fichier choisi dans `images/` du repo si besoin (nom dédupliqué en cas de collision) ; `image:read` sert uniquement à construire un aperçu en mémoire (jamais stocké) ; `image:write-paste` écrit une image collée depuis le presse-papiers sous un nom généré.

### 21.6 Sérialisation Markdown

`tiptap-markdown` gère la conversion :
- **Chargement** : `editor.commands.setContent(markdownString)` → TipTap parse le Markdown
- **Sauvegarde** : `(editor.storage.markdown as MarkdownStorage).getMarkdown()` → Markdown string

Sync externe (ex: changement de type d'exigence réinitialise les champs) : `useEffect` sur `value` → `editor.commands.setContent(value, false)` (le `false` évite de déclencher `onUpdate`).

### 21.7 DrawIO

Les exports SVG de DrawIO sont insérés comme images standards via le bouton 🖼. Aucune intégration DrawIO spécifique n'est requise — un `.svg` est une image.

## 22. Architecture multi-composants

**T130 : cette section (écrite le 2026-06-12) décrivait un mécanisme de submodules Git piloté par
`schema.yaml` qui n'existe pas dans le code actuel** — aucune occurrence de `.gitmodules` ni de
`git.submodule.*` (isomorphic-git) dans tout le repo. Le mécanisme réel, en place depuis T69
(workspace plat) et étendu par T123/T131/T135 (imbrication de composants locaux), est décrit
en détail et à jour dans [SPEC-TEMPLATES.md](SPEC-TEMPLATES.md) §3-3b — cette section n'en donne
qu'un résumé technique côté implémentation.

### 22.1 Principe

Un produit peut avoir deux formes de composant, avec **les mêmes capacités** (`objectTypes`,
imbrication, interfaces `roles`/`implements`) :
- **Composant local** — un `SystemNode` supplémentaire dans le `schema.yaml` du repo courant,
  versionné avec `root` (même historique, même commits). Peut être imbriqué dans un autre
  composant local via `children[]`, **profondeur illimitée** (T123) — pas de limite à un niveau.
- **Composant en repo séparé** — déclaré dans `polenta-repo.yaml` à la racine du repo qui en
  dépend, résolu dans un **workspace plat** (T69) : un dossier sur disque contenant le repo racine
  et chaque dépendance clonée à côté, décrit par `<workspace>/.polenta/workspace.yaml`
  (`PolentaWorkspaceConfig`) et mis en cache dans `<workspace>/.polenta/tree.cache.yaml`
  (`WorkspaceTree`).

```typescript
// packages/types/src/polenta-repo.ts — polenta-repo.yaml (seuls les repos AVEC dépendances l'ont)
export interface PolentaRepoDependency {
  name: string          // nom de montage = nom de dossier dans le workspace
  url: string           // URL du remote git
  pin: string           // SHA ou tag épinglé, géré par le repo parent
  localParent?: string  // imbrique ce montage sous un composant local du repo déclarant (T123)
}
export interface PolentaRepoManifest {
  dependencies?: PolentaRepoDependency[]
}
```

Aucune limite de nombre de composants n'est imposée par le code (l'ancienne limite indicative
"~10" n'a pas d'équivalent).

### 22.2 Fichiers maintenus par l'application — ne jamais éditer manuellement

| Fichier | Maintenu par | Déclencheur |
|---|---|---|
| `.polenta/trees/<nœud>/<type>.yaml` | `TreeService` | Actions dans l'UI (création/déplacement/suppression d'élément) — un fichier par (nœud, type d'objet), **pas** un `tree.yaml` unique |
| `<workspace>/.polenta/tree.cache.yaml` | `WorkspaceTreeService` | Ouverture du workspace / `workspace:rebuild-tree` |
| `<workspace>/.polenta/workspace.yaml` | `WorkspaceService.initWorkspace()` | Création du workspace |

Il n'y a **pas** de `.gitmodules`, pas de `tree.yaml` unique à la racine, pas de script Python, pas
de hook `pre-commit` — voir CLAUDE.md règle 9.

> **`tree.cache.yaml` ne doit jamais être versionné (T156) :** contient des chemins absolus
> locaux à la machine et un `generatedAt` recalculé à chaque écriture (`nodes`/`logicalTree`
> aussi, à chaque `rebuildTree()` — ajout/suppression/renommage de dépendance) — un repo qui le
> suit apparaît "modifié" en permanence, bloquant la garde "aucune modification en attente"
> utilisée par le bouton Rafraîchir (T153) et l'auto-pull (T155). `WorkspaceTreeService.writeCache()`
> (choke point unique — cf. tableau ci-dessus) garantit maintenant qu'un `.gitignore` excluant
> `.polenta/tree.cache.yaml` existe dans `workspaceDir` avant chaque écriture — un `.gitignore`
> placé directement à côté du dossier `.polenta/` qu'il exclut est honoré par git quel que soit
> l'ancêtre qui s'avère être la racine du repo (ou un no-op si `workspaceDir` n'est pas du tout
> sous git, cas courant pour un dossier conteneur fraîchement choisi). Corrige aussi le cas
> "adoption d'un repo existant" (`WorkspaceService.openProject`), qui n'écrivait auparavant aucun
> `.gitignore` du tout.

### 22.3 Références cross-composant

Un objet référence un composant par son nom de montage via `objectTypeRef: <nœud>::<type>` (ex.
`motor-control::exigence-fw`), et les liens entre objets (y compris cross-composant) passent par
`ObjectLink` dans `links/links.yaml` — pas par un champ `children:`/`parents:` dans le fichier de
l'objet (voir `SPEC-REQ-requirements.md` §5, déjà à jour).

### 22.4 Arbre de traçabilité — pas de vue matérialisée globale unique

Il n'existe pas de fichier unique équivalent à l'ancien `tree.yaml` agrégeant tout l'arbre produit +
composants. Chaque (nœud, type d'objet) a son propre fichier d'ordre d'affichage
`.polenta/trees/<nœud>/<type>.yaml` (`TypeTree`/`TypeTreeNode`, `packages/types/src/schema.ts`),
maintenu par l'app à chaque action UI — jamais par un script de régénération, jamais commité comme
un artefact "généré à la volée" à committer manuellement.

### 22.5 Résolution des composants en repo séparé

`WorkspaceTreeService` construit et met en cache le `WorkspaceTree` (nœuds aplatis + arbre logique)
depuis `polenta-repo.yaml` de chaque repo du workspace, en résolvant les conflits en diamant (même
URL, pins différents) via `DiamondConflict`/`MountOverride` (renommage explicite d'un montage,
plutôt qu'un champ `version` déclaré). `SchemaService.resolveComponentRepoPath()` s'appuie sur ce
cache pour retrouver le repo réel derrière un `objectTypeRef` cross-composant.

`PolentaRepoService` lit/écrit `polenta-repo.yaml` ; `WorkspaceService` orchestre l'ouverture du
workspace (clone des dépendances manquantes, détection de conflit en diamant, reconstruction de
l'arbre) — pas d'initialisation de submodule Git (`git.submodule.init/update` n'existe nulle part
dans le code).

### 22.6 Impact sur `GitService`

`listFiles()` opère uniquement sur le repo passé en `repoPath` — un composant en repo séparé est un
repo distinct sur disque (pas un submodule Git imbriqué dans le working tree du repo parent), donc
pas de traversée `components/<nom>/` particulière à gérer ici. Un composant en repo séparé
`readonly: true` refuse l'écriture au niveau de `SchemaService`/`RequirementsService`/`TestsService`
(voir `SchemaValidationError('NODE_READONLY', …)`), pas au niveau `GitService`.

### 22.7 Channels IPC réels

Pas de `submodules:*`. Les channels pertinents sont `workspace:get-tree`, `workspace:rebuild-tree`,
`workspace:set-mount-override`, `workspace:remove-repo-dir`, `workspace:rename-repo-dir`,
`polenta-repo:get`, `polenta-repo:save`, plus `interface:compliance-matrix` / `interface:coverage`
(matrice de conformité par rôle, T123 — voir `InterfaceComplianceService`).
`interface:needs-revalidation` a été supprimé par T172 (jamais appelé ; le flag est désormais
porté par les éléments, SPEC-REQ §5.3).

---

## 23. Ordre d'implémentation recommandé (historique)

> Plan de sprints du build initial (2026-06-12) — conservé pour l'historique, ne décrit plus l'état
> courant du code (cf. corrections T130 dans les sections précédentes). Numéroté §23 (et non plus
> §18) pour lever le conflit avec l'ancien §21 "Design system", renuméroté §18 à T130.

```
Sprint 1 — Infrastructure
  ① apps/desktop — setup electron-vite + BrowserWindow
  ② GitService (working tree) + tests unitaires
  ③ SyncService (commit/push/pull via isomorphic-git)
  ④ AuthService (keytar + resolveIdentity)
  ⑤ WorkspaceService (clone + listProjects)
  ⑥ Preload + container.ts

Sprint 2 — Services métier portés
  ⑦ RequirementsIndexService (adapté working tree)
  ⑧ TestsIndexService (adapté working tree)
  ⑨ RequirementsService (suppression NestJS, nouvelle signature)
  ⑩ TestsService (idem)
  ⑪ TraceabilityService (idem)

Sprint 3 — IPC + Renderer
  ⑫ Tous les handlers IPC (requirements, tests, traceability, sync, auth, workspace)
  ⑬ Package @polenta/api-client (interface + ipc-client)
  ⑭ Adaptation du renderer React (remplacer fetch par ApiClient IPC)

Sprint 4 — Workflow Action
  ⑮ ActionService (create, getCurrent, trackAffectedItem, merge, abandon)
  ⑯ RepoWatcherService
  ⑰ IPC actions handlers
  ⑱ UI : dialogue "Nouvelle Action" (titre + description + Jira optionnel)
  ⑲ UI : bouton Committer, panneau Sync, badge "Action courante" dans la barre de titre

Sprint 5 — Écran de démarrage
  ⑳ auth:has-any-account + auth:setup IPC
  ㉑ workspace:get-last-opened + workspace:mark-last-opened IPC
  ㉒ Route /login avec formulaire remote + PAT
  ㉓ Logique de redirection automatique au démarrage
  ㉔ Mise à jour WorkspacePage (bouton "Ouvrir dossier existant")

Sprint 6 — Gestion de projet / menu File + UI compte  [LIVRÉ]  (voir SPEC-PROJECT-MANAGEMENT.md)
  ㉕ Extraire createAppWindow() dans src/main/index.ts
  ㉖ Créer src/main/menu.ts → buildMenu(win)
  ㉗ Appeler buildMenu(win) à chaque création de fenêtre
  ㉘ Ajouter handler IPC dialog:pick-folder (dialog.showOpenDialog)
  ㉙ Ajouter namespace dialog dans ApiClient + ipc-client (pickFolder)
  ㉚ Créer src/renderer/hooks/useMenuEvents.ts
  ㉛ Monter useMenuEvents() dans le layout racine du router
  ㉜ Header workspace : titre "Ouvrir un projet" à gauche, [user▾] à droite
  ㉝ Créer composant AccountMenu (nom, email, remote, Changer de compte, Se déconnecter)
  ㉞ Ajouter boutons Browse [📁] dans les formulaires Charger et Ouvrir (WorkspacePage)
  ㉟ Ajouter bouton "Fermer le projet" dans project.$id.tsx

Sprint 7 — Wording + layout workspace + création de projet  [LIVRÉ]  (voir SPEC-PROJECT-MANAGEMENT.md §9-10)
  ㊱ Renommer "Cloner un repo" → "Charger un projet" dans WorkspacePage
  ㊲ Renommer "Ouvrir un repo existant" → "Ouvrir un projet local"
  ㊳ Remplacer tout "repo" par "projet" dans l'interface utilisateur
  ㊴ Ajouter panneau "Créer un projet" (nom, dossier [📁], visibilité Privé/Public)
  ㊵ Implémenter WorkspaceService.createProject() (API remote + clone)
  ㊶ Ajouter handler IPC workspace:create
  ㊷ Ajouter workspace.create() dans ApiClient + ipc-client
  ㊸ Réorganiser layout : 2 colonnes, Récents à gauche, 3 panneaux empilés à droite

Sprint 9 — Design system homogène + Dark mode  [LIVRÉ]
  ① Système de tokens CSS (variables `--canvas`, `--surface`, `--hover`, `--edge`, `--ink` x3, `--prim`)
  ② Tailwind `darkMode: 'class'` + extension couleurs sémantiques
  ③ Classes utilitaires `input-field`, `btn-primary`, `btn-secondary`, `btn-danger`, `btn-sm`, `section-label`
  ④ ThemeContext (React) : persistance localStorage + détection système `prefers-color-scheme`
  ⑤ Toggle Thème (Soleil/Lune) dans AccountPanel → section Préférences
  ⑥ ActivityBar : toujours `slate-900` (invariant — comme VS Code), icônes Lucide React
  ⑦ Contrastes WCAG AA vérifiés : texte primaire 17:1, texte secondaire 9.7:1, texte muted 5.5:1
  ⑧ Application du système à tous les composants, panels, routes

Sprint 12 — Commentaires sur reviews + migration vers ProjectConfig (voir §20.2 config.ts)
  ① Implémenter `reviews:add-comment` (ReviewsService + IPC + ApiClient)
  ② Implémenter `reviews:resolve-comment` (idem)
  ③ Implémenter `reviews:add-reviewer` (idem)
  ④ UI reviews : section commentaires + bouton "Ajouter un commentaire"
  ⑤ Migration progressive ProjectSchema → ProjectConfig (config.ts) :
     - StatusDefinition avec isApproved/isArchived/isInitial
     - TransitionDefinition (from/to/requiredRoles/requiresComment/requiresReview)
     - FieldDefinition avec validator EARS, triggerVersionComment, options ENUM

Sprint 11 — Panels Produit & Composants + Campagnes (voir §19.9-19.10 + §20.2)
  ① Ajouter `levels` + `TestCampaign` + `CampaignTestRun` dans `packages/types`
  ② `CampaignsService` (create, list, updateRun, close) + stockage YAML dans `campaigns/`
  ③ Handlers IPC campaigns:list/get/create/update-run/close
  ④ Remplacer icônes Exigences + Tests par Produit (📋) + Composants (🧩) dans ActivityBar
  ⑤ Créer `ProductPanel` (sidebar) — tabs Exigences/Tests/Campagnes, contenu piloté par schema
  ⑥ Créer `ComponentsPanel` (sidebar) — sélecteurs [composant▾][niveau▾] sur une ligne + mêmes tabs
  ⑦ Routes `/product`, `/components` (panels par défaut)
  ⑧ Routes `/campaign/new`, `/campaign/$id` (création + suivi)
  ⑨ Passer `component?` + `level?` en search params sur `/req/*`, `/test/*`, `/campaign/*`
  ⑩ Mise à jour déduction `activePanel` dans `AppLayout` (voir §19.13)
  ⑪ Onglet Schéma : ajouter section "Niveaux" dans l'éditeur `/schema`

Sprint 10 — Architecture multi-composants (voir §22)
  ① SubmoduleService (init, update, list) via isomorphic-git
  ② WorkspaceService.cloneAndAdd() : init submodules après clone
  ③ WorkspaceService.addLocalProject() : update submodules si .gitmodules présent
  ④ ComponentRef dans WorkspaceProject (liste des composants)
  ⑤ Channels IPC submodules:list, submodules:status, submodules:update
  ⑥ Script scripts/update-tree.py (génération tree.yaml)
  ⑦ Hook pre-commit dans le repo produit (régénère tree.yaml)
  ⑧ UI : afficher les composants dans le panneau Projet (liste + SHA épinglé)
  ⑨ UI : bouton "Mettre à jour les composants" (submodules:update)

Sprint 8 — Refonte layout global VS Code  (voir §19)
  ① Supprimer le header horizontal dans __root.tsx
  ② Créer src/renderer/components/layout/ActivityBar.tsx (icônes + état actif)
  ③ Créer src/renderer/components/layout/Sidebar.tsx (dispatcher des panneaux)
  ④ Créer src/renderer/components/layout/AppLayout.tsx (activity bar + sidebar + main outlet)
  ⑤ Intégrer AppLayout dans __root.tsx (sauf route /login)
  ⑥ Créer src/renderer/components/sidebar/AccountPanel.tsx (§19.6)
  ⑦ Créer src/renderer/components/sidebar/ProjectPanel.tsx (§19.7 + §19.8)
       — Sans projet : liste Récents + boutons Créer/Charger/Ouvrir
       — Avec projet : branche, modifications, historique, bouton Nouvelle Action
  ⑧ Créer src/renderer/components/sidebar/RequirementsPanel.tsx (§19.9)
       — Arborescence groupée par domaine, dot de statut, filtre texte
  ⑨ Créer src/renderer/components/sidebar/TestsPanel.tsx (§19.10)
       — Arborescence groupée par domaine, icône dernier résultat, filtre texte
  ⑩ Ajouter IPC handler sync:log (isomorphic-git log)
  ⑪ Ajouter sync.log() dans ApiClient + ipc-client
  ⑫ Ajouter IPC handler app:set-title (BrowserWindow.setTitle)
  ⑬ Appeler app:set-title au chargement/fermeture d'un projet
  ⑭ Griser les icônes Exigences/Tests/etc. si aucun projet chargé
```
