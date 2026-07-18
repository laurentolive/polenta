# SPEC-ELECTRON-DESKTOP — Architecture Client Lourd Electron

> Dernière révision : 2026-06-12  
> Remplace la couche NestJS HTTP pour la distribution desktop.  
> La spec fonctionnelle des modules (Requirements, Tests, Traceability, Reviews…) reste inchangée.

---

## 1. Philosophie & principes

```
Remote git (GitHub / Gitea / self-hosted)
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
  desktop/      ← NOUVEAU — application Electron
    package.json
    tsconfig.json
    electron.vite.config.ts
    electron-builder.yml
    src/
      main/                        ← Node.js process (main)
        index.ts                   ← BrowserWindow, app lifecycle
        ipc/                       ← handlers IPC (remplacent les controllers)
          requirements.ipc.ts
          tests.ipc.ts
          traceability.ipc.ts
          sync.ipc.ts
          auth.ipc.ts
          workspace.ipc.ts
          actions.ipc.ts
        services/                  ← classes métier (sans NestJS)
          git/
            git.service.ts         ← working tree reads/writes
            sync.service.ts        ← commit / push / pull / status
            merge.service.ts       ← merge YAML 3-way (V2)
          index/
            requirements-index.service.ts
            tests-index.service.ts
          requirements/
            requirements.service.ts
          tests/
            tests.service.ts
          traceability/
            traceability.service.ts
          branches/
            branch.service.ts      ← création, checkout, merge, affected items
          auth/
            auth.service.ts
          workspace/
            workspace.service.ts
          watcher/
            repo-watcher.service.ts
        container.ts               ← DI manuel (instanciation des services)
      preload/
        index.ts                   ← contextBridge → expose window.polenta
      renderer/
        index.html
        src/
          api/
            ipc-client.ts          ← implémente ApiClient via ipcRenderer
          ... (composants React réutilisés depuis apps/web)
packages/
  types/        ← inchangé
  zod-schemas/  ← inchangé
  api-client/   ← NOUVEAU — interface ApiClient partagée web + desktop
    src/
      index.ts  ← interface ApiClient + types de retour
      http-client.ts   ← implémentation HTTP (pour apps/web)
      ipc-client.ts    ← implémentation IPC (pour apps/desktop)
```

---

## 3. Dépendances `apps/desktop`

```json
{
  "dependencies": {
    "isomorphic-git": "^1.25.0",
    "keytar": "^7.9.0",
    "chokidar": "^3.6.0",
    "js-yaml": "^4.1.0",
    "zod": "^3.23.0",
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

  /** Liste tous les fichiers du working tree, filtrés par préfixe optionnel */
  async listFiles(repoPath: string, prefix?: string): Promise<string[]>

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

  /** Checkout une branche existante */
  async checkout(repoPath: string, branch: string): Promise<void>

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

// listFiles — fs.readdir récursif
async listFiles(repoPath: string, prefix?: string): Promise<string[]> {
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
  return prefix ? files.filter(f => f.startsWith(prefix)) : files
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

export interface GitStatus {
  modified: string[]    // fichiers modifiés non commités
  untracked: string[]   // nouveaux fichiers
  ahead: number         // commits locaux non poussés
  behind: number        // commits distants non tirés
  branch: string
  remoteUrl: string | null
}

export interface CommitResult {
  sha: string
  message: string
  timestamp: string
}

export class SyncService {
  constructor(private readonly authService: AuthService) {}

  /** État du working tree */
  async status(repoPath: string): Promise<GitStatus>

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

export type MergeResult =
  | { success: true; sha: string }
  | { success: false; conflicts: YamlConflict[] }

export interface YamlConflict {
  filePath: string
  base: Record<string, unknown>    // ancêtre commun
  ours: Record<string, unknown>    // branche cible (integration)
  theirs: Record<string, unknown>  // branche feature
  conflictingFields: string[]      // champs en conflit
}
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
| `BranchesService` | `BranchService` | Allégé — pas de YAML métadonnées, items affectés calculés depuis le diff |
| `ProjectsRegistryService` | `WorkspaceService` | Réécriture — persistance locale |
| `RequirementsIndexService` | `RequirementsIndexService` | Adapter `build()` pour working tree |
| `TestsIndexService` | `TestsIndexService` | Idem |

---

## 7. `AuthService`

```typescript
// apps/desktop/src/main/services/auth/auth.service.ts

export interface UserIdentity {
  name: string
  email: string
  login: string          // username du remote (GitHub, Gitea…)
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
   * Pour Gitea  : GET <host>/api/v1/user avec le token.
   * Pour autres : lit user.name + user.email depuis git config local.
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

## 8. `BranchService` — gestion des branches de travail

Une **branche git** est l'unité de travail dans Polenta. Elle représente une intention de modification (correction, ajout, refonte…). Il n'y a pas de fichier YAML de métadonnées — la branche git est l'unique source de vérité.

**Convention de nommage (recommandée, non contrainte) :**
```
feat/<description-courte>
fix/<description-courte>
jira/<PROJ-123>-<description>
```

Les items affectés sont **calculés dynamiquement** depuis le diff git, jamais stockés.

### Interface

```typescript
// apps/desktop/src/main/services/branches/branch.service.ts

export class BranchService {
  constructor(private readonly git: GitService) {}

  /** Branche courante */
  async current(repoPath: string): Promise<string>

  /** Liste toutes les branches locales */
  async list(repoPath: string): Promise<string[]>

  /**
   * Crée et checkout une nouvelle branche depuis integrationBranch.
   * Refuse si le working tree n'est pas clean.
   */
  async create(repoPath: string, name: string): Promise<void>

  /** Checkout une branche existante */
  async checkout(repoPath: string, name: string): Promise<void>

  /** Supprime une branche locale */
  async delete(repoPath: string, name: string, force?: boolean): Promise<void>

  /**
   * Merge une branche dans integrationBranch.
   * 1. Checkout integrationBranch
   * 2. git merge <fromBranch>
   * 3. Si clean → retourne { success: true, sha }
   * 4. Si conflit → retourne les YamlConflict[] pour résolution UI
   */
  async merge(repoPath: string, fromBranch: string): Promise<MergeResult>

  /**
   * Applique la résolution d'un conflit YAML champ par champ.
   * Écrit le fichier résolu sur le working tree (sans committer).
   */
  async applyConflictResolution(
    repoPath: string,
    filePath: string,
    resolved: Record<string, unknown>,
  ): Promise<void>

  /**
   * Calcule les items (exigences et tests) affectés par la branche courante.
   * Compare HEAD avec integrationBranch via git diff et parse les IDs
   * depuis les chemins des fichiers modifiés dans requirements/ et tests/.
   * Retourne un tableau vide si on est déjà sur integrationBranch.
   */
  async affectedItems(repoPath: string): Promise<string[]>
}
```

---

## 9. `WorkspaceService`

Remplace `ProjectsRegistryService`. Gère la liste des repos locaux de l'utilisateur.

```typescript
// apps/desktop/src/main/services/workspace/workspace.service.ts

export interface WorkspaceProject {
  id: string           // uuid généré à l'ajout
  name: string         // lu depuis config/project.yaml du repo
  localPath: string    // chemin absolu sur le disque
  remoteUrl: string    // URL du remote git
  integrationBranch: string  // "main" ou "integration" (lu depuis config)
  schemaVersion: number
  lastOpenedAt: string
}

export class WorkspaceService {
  // Persistance : app.getPath('userData')/workspace.json
  // Hors git — propre à la machine de l'utilisateur

  /** Liste tous les projets de la workspace */
  async listProjects(): Promise<WorkspaceProject[]>

  /**
   * Ajoute un projet existant (repo déjà cloné localement).
   * Lit config/project.yaml pour extraire name, schemaVersion, integrationBranch.
   */
  async addLocalProject(localPath: string): Promise<WorkspaceProject>

  /**
   * Clone un repo distant et l'ajoute à la workspace.
   * onProgress: callback pour la barre de progression UI.
   */
  async cloneAndAdd(
    remoteUrl: string,
    localPath: string,
    onProgress?: (phase: string, loaded: number, total: number) => void,
  ): Promise<WorkspaceProject>

  /** Supprime un projet de la workspace (ne supprime pas le repo local) */
  async removeProject(id: string): Promise<void>

  /** Vérifie la compatibilité schemaVersion — lève une erreur si incompatible */
  async checkSchemaCompatibility(project: WorkspaceProject): Promise<void>

  /** Retourne un projet par id */
  async getProject(id: string): Promise<WorkspaceProject>
}
```

**Compatibilité schéma :**
```typescript
const MIN_SUPPORTED_SCHEMA = 1
const MAX_SUPPORTED_SCHEMA = 1   // à incrémenter lors de breaking changes

// Dans checkSchemaCompatibility :
if (schema > MAX_SUPPORTED_SCHEMA) {
  throw new Error(`Ce repo requiert Polenta v${schema}+. Mettez à jour l'application.`)
}
if (schema < MIN_SUPPORTED_SCHEMA) {
  // Proposer migration dans l'UI
  throw new SchemaOutdatedError(schema, MAX_SUPPORTED_SCHEMA)
}
```

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
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `workspace:list` | — | `WorkspaceProject[]` |
| `workspace:add-local` | `{ localPath }` | `WorkspaceProject` |
| `workspace:clone` | `{ remoteUrl, localPath }` | `WorkspaceProject` |
| `workspace:create` | `{ name, localPath, private?: boolean }` | `WorkspaceProject` |
| `workspace:remove` | `{ id }` | `void` |
| `workspace:get` | `{ id }` | `WorkspaceProject` |
| `workspace:get-last-opened` | — | `WorkspaceProject \| null` |
| `workspace:mark-last-opened` | `id: string \| null` | `void` |

#### Auth
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `auth:save-token` | `{ remoteUrl, username, token }` | `void` |
| `auth:get-token` | `{ remoteUrl }` | `string \| null` |
| `auth:delete-token` | `{ remoteUrl }` | `void` |
| `auth:resolve-identity` | `{ remoteUrl }` | `UserIdentity` |
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

#### Branches
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `branches:list` | `{ repoPath }` | `string[]` |
| `branches:current` | `{ repoPath }` | `string` |
| `branches:create` | `{ repoPath, name }` | `void` |
| `branches:checkout` | `{ repoPath, name }` | `void` |
| `branches:delete` | `{ repoPath, name, force? }` | `void` |
| `branches:merge` | `{ repoPath, fromBranch }` | `MergeResult` |
| `branches:resolve-conflict` | `{ repoPath, filePath, resolved }` | `void` |
| `branches:affected-items` | `{ repoPath }` | `string[]` |

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

#### Baselines
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `baselines:list` | `{ repoPath }` | `Baseline[]` |
| `baselines:get` | `{ repoPath, name }` | `Baseline` |
| `baselines:create` | `{ repoPath, dto }` | `Baseline` |
| `baselines:diff` | `{ repoPath, fromName, toName }` | `BaselineDiff` |

#### Templates
| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `templates:list-available` | — | `TemplateRef[]` |
| `templates:apply` | `{ repoPath, templateSlug }` | `void` |
| `templates:export` | `{ repoPath }` | `string` (YAML sérialisé) |

#### Menu (événements push main → renderer)

Ces channels sont émis par le menu natif via `win.webContents.send`. Le renderer s'abonne via `window.polenta.on` dans le hook `useMenuEvents` (voir [SPEC-PROJECT-MANAGEMENT.md §3](SPEC-PROJECT-MANAGEMENT.md)).

| Channel | Émis par | Comportement renderer |
|---------|----------|----------------------|
| `menu:open-workspace` | Menu "Ouvrir un projet…" | `workspace:mark-last-opened(null)` + navigate(`/`) |
| `menu:close-project` | Menu "Fermer le projet" | `workspace:mark-last-opened(null)` + navigate(`/`) |

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

```typescript
// apps/desktop/src/main/ipc/requirements.ipc.ts

import { ipcMain } from 'electron'
import type { RequirementsService } from '../services/requirements/requirements.service'

export function registerRequirementsHandlers(service: RequirementsService): void {
  ipcMain.handle('requirements:list', async (_event, { repoPath, filters }) => {
    return service.findAll(repoPath, filters ?? {})
  })

  ipcMain.handle('requirements:get', async (_event, { repoPath, id }) => {
    return service.findOne(repoPath, id)
  })

  ipcMain.handle('requirements:create', async (_event, { repoPath, dto }) => {
    return service.create(repoPath, dto)
  })

  // ... etc.
}
```

### 11.4 Container (`apps/desktop/src/main/container.ts`)

DI manuel — instancie les services et les injecte dans les handlers.

```typescript
// apps/desktop/src/main/container.ts

export function createContainer() {
  const gitService = new GitService()
  const authService = new AuthService()
  const syncService = new SyncService(authService)

  const reqIndex = new RequirementsIndexService(gitService)
  const testsIndex = new TestsIndexService(gitService)
  const watcher = new RepoWatcherService(reqIndex, testsIndex)

  const requirementsService = new RequirementsService(gitService, reqIndex)
  const testsService = new TestsService(gitService, testsIndex)
  const traceabilityService = new TraceabilityService(reqIndex, testsIndex, gitService)
  const branchService = new BranchService(gitService)
  const workspaceService = new WorkspaceService(syncService)

  return {
    gitService,
    authService,
    syncService,
    reqIndex,
    testsIndex,
    watcher,
    requirementsService,
    testsService,
    traceabilityService,
    branchService,
    workspaceService,
  }
}
```

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
  branches: {
    list(repoPath: string): Promise<string[]>
    current(repoPath: string): Promise<string>
    create(repoPath: string, name: string): Promise<void>
    checkout(repoPath: string, name: string): Promise<void>
    delete(repoPath: string, name: string, force?: boolean): Promise<void>
    merge(repoPath: string, fromBranch: string): Promise<MergeResult>
    resolveConflict(repoPath: string, filePath: string, resolved: Record<string, unknown>): Promise<void>
    affectedItems(repoPath: string): Promise<string[]>
  }
  sync: {
    status(repoPath: string): Promise<GitStatus>
    commit(repoPath: string, message: string): Promise<CommitResult>
    push(repoPath: string): Promise<void>
    pull(repoPath: string): Promise<void>
  }
  workspace: {
    list(): Promise<WorkspaceProject[]>
    addLocal(localPath: string): Promise<WorkspaceProject>
    clone(remoteUrl: string, localPath: string): Promise<WorkspaceProject>
    remove(id: string): Promise<void>
  }
  auth: {
    saveToken(remoteUrl: string, username: string, token: string): Promise<void>
    resolveIdentity(remoteUrl: string, token: string): Promise<UserIdentity>
    getCurrentUser(repoPath: string): Promise<UserIdentity>
    testConnection(remoteUrl: string, token: string): Promise<{ ok: boolean; error?: string }>
  }
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

```typescript
import { app, BrowserWindow } from 'electron'
import { createContainer } from './container'
import { registerRequirementsHandlers } from './ipc/requirements.ipc'
import { registerTestsHandlers } from './ipc/tests.ipc'
import { registerTraceabilityHandlers } from './ipc/traceability.ipc'
import { registerSyncHandlers } from './ipc/sync.ipc'
import { registerAuthHandlers } from './ipc/auth.ipc'
import { registerWorkspaceHandlers } from './ipc/workspace.ipc'
import { registerBranchesHandlers } from './ipc/branches.ipc'
import * as path from 'path'

app.whenReady().then(() => {
  const container = createContainer()

  // Enregistrer tous les handlers IPC
  registerRequirementsHandlers(container.requirementsService)
  registerTestsHandlers(container.testsService)
  registerTraceabilityHandlers(container.traceabilityService)
  registerSyncHandlers(container.syncService)
  registerAuthHandlers(container.authService)
  registerWorkspaceHandlers(container.workspaceService, container.watcher)
  registerBranchesHandlers(container.branchService)

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
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

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
  },
})
```

---

## 15. Contraintes & règles pour les sous-agents

### Ce qu'il FAUT faire
- Toujours lire depuis le working tree (`fs.readFile`), jamais via `git show` sauf pour `readYamlRef` (lecture historique)
- Toujours créer/changer de branche via `BranchService`, jamais directement depuis un service métier
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
- ❌ Éditer `.gitmodules` manuellement — il est généré par `SchemaService.save()` depuis `schema.components`
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
       │           ├─ Succès → workspace:mark-last-opened(null) → /
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
| `workspace:get-last-opened` | — | `WorkspaceProject \| null` | Dernier projet ouvert (depuis `workspace.json`) |
| `workspace:mark-last-opened` | `id: string \| null` | `void` | Met à jour `lastOpenedId` dans `workspace.json` |

### 16.3 Routes renderer

| Route | Condition d'accès | Comportement |
|-------|------------------|--------------|
| `/login` | Aucun compte configuré | Formulaire remote + PAT ; redirige vers `/` après succès |
| `/` | Compte configuré | Liste des projets + [Cloner] + [Ouvrir] si aucun `lastOpenedId` ; sinon redirige vers `/dashboard?projectId=…` (T102) |
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

> **T108** : la section "Récents" a été retirée de cette page (elle faisait doublon avec la
> liste "Récents" déjà affichée en permanence dans la sidebar, panneau Projet sans projet
> ouvert — cf. §19.5/19.6). La page `/` n'affiche plus désormais que les panneaux
> d'ouverture/création, toujours en colonne unique centrée, qu'il existe ou non des projets
> récents. Le mockup ci-dessous et le glossaire de wording ci-après restent par ailleurs
> antérieurs à l'implémentation actuelle (wording des boutons notamment — cf. `index.tsx`) et
> n'ont pas été mis à jour dans le cadre de T108, qui ne portait que sur la suppression du
> doublon "Récents".

```
┌───────────────────────────────────────────────────────────────────────┐
│  Ouvrir un projet                                           [user▾]   │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│                     ┌─ Créer un projet ───────────────┐              │
│                     │ Nom   [ mon-projet             ] │              │
│                     │ Dossier [ C:\projets\…  ] [📁] │              │
│                     │ Visibilité  ● Privé  ○ Public  │              │
│                     │              [ Créer ]          │              │
│                     └─────────────────────────────────┘              │
│                     ┌─ Charger un projet ─────────────────┐          │
│                     │ URL  [ https://github.com/…      ] │          │
│                     │ Dossier [ C:\projets\…   ] [📁]  │          │
│                     │                   [ Charger ]     │          │
│                     └─────────────────────────────────────┘          │
│                     ┌─ Ouvrir un projet local ────────────┐          │
│                     │ Dossier [ C:\projets\…   ] [📁]  │          │
│                     │                   [ Ouvrir ]      │          │
│                     └─────────────────────────────────────┘          │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

**Structure :**
- **Header** : titre "Ouvrir un projet" à gauche, `[user▾]` à droite.
- **Contenu** : une colonne unique centrée, trois panneaux empilés — "Créer un projet", "Charger un projet", "Ouvrir un projet local".
- La liste des projets récents n'apparaît que dans la sidebar (panneau Projet), pas sur cette page (T108).

**Glossaire / wording :**

| Ancien | Nouveau | Sens |
|--------|---------|------|
| "Cloner un repo" | "Charger un projet" | Télécharger un projet distant existant |
| "Ouvrir un repo existant" | "Ouvrir un projet local" | Pointer vers un dossier déjà cloné |
| "repo" | "projet" | Dans toute l'interface utilisateur |

**Panneau "Créer un projet" :**
- Champ **Nom** : nom du projet (sera le nom du repo créé sur le remote).
- Champ **Dossier** : chemin local où cloner après création, avec bouton Browse `[📁]`.
- Sélecteur **Visibilité** : Privé (défaut) / Public.
- Bouton **Créer** : appelle `workspace:create` (voir §11.2).

**Comportement de création :**
1. Appel à l'API du remote (GitHub : `POST /user/repos`) pour créer le repo avec le nom donné.
2. Clone du repo fraîchement créé dans le dossier local.
3. Redirection vers `/project/$id`.

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

Le bouton `[📁]` (Browse) ouvre le sélecteur de dossier natif de l'OS via `dialog:pick-folder`. Le chemin sélectionné remplace le contenu du champ texte adjacent.

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
- **Fichier → Fermer le projet** appelle `workspace:mark-last-opened(null)` + navigue vers `/`.
- **Fichier → Ouvrir un projet…** fait de même (retour à l'écran Workspace).
- Le menu natif envoie des événements push (`menu:open-workspace`, `menu:close-project`) au renderer via `win.webContents.send`. Le renderer s'abonne via le hook `useMenuEvents`.

---

## 21. Design system — tokens et dark mode

### 21.1 Tokens CSS

Définis dans `src/renderer/index.css` via CSS custom properties. Tailwind étend sa config pour exposer ces tokens comme classes utilitaires.

| Token CSS         | Tailwind class   | Light (`#`)  | Dark (`#`)   | Usage                        |
|-------------------|-----------------|--------------|--------------|------------------------------|
| `--canvas`        | `bg-canvas`     | `f8fafc`     | `0f172a`     | Arrière-plan page principale |
| `--surface`       | `bg-surface`    | `ffffff`     | `1e293b`     | Sidebar, cartes, modales     |
| `--surface-hover` | `hover:bg-hover`| `f1f5f9`     | `293548`     | État survol d'items          |
| `--edge`          | `border-edge`   | `e2e8f0`     | `334155`     | Bordures principales         |
| `--edge-subtle`   | `border-edge-subtle` | `f1f5f9` | `1e293b`   | Séparateurs discrets         |
| `--ink`           | `text-ink`      | `0f172a`     | `f1f5f9`     | Texte principal              |
| `--ink-2`         | `text-ink-2`    | `475569`     | `cbd5e1`     | Texte secondaire             |
| `--ink-3`         | `text-ink-3`    | `94a3b8`     | `94a3b8`     | Texte muted, placeholders    |
| `--prim`          | `bg-prim`       | `0f172a`     | `e2e8f0`     | Bouton action principale     |
| `--prim-fg`       | `text-prim-fg`  | `f8fafc`     | `0f172a`     | Texte sur bouton principal   |

**Activity bar** : toujours sombre (`slate-900`/`slate-800`/`slate-700`) — invariant, identique à VS Code.

### 21.2 Classes utilitaires globales

Définies dans `@layer components` :

| Classe         | Usage                                          |
|----------------|------------------------------------------------|
| `input-field`  | Champs texte, select, textarea — applique border-edge, bg-surface, focus ring |
| `btn-primary`  | Bouton action principale (`bg-prim text-prim-fg`) |
| `btn-secondary`| Bouton secondaire ou annuler (`border-edge hover:bg-hover`) |
| `btn-danger`   | Bouton destructif avec surcharge dark          |
| `btn-sm`       | Variante petite taille (xs)                    |
| `section-label`| En-tête de section dans la sidebar (uppercase, tracking-wider) |

### 21.3 Dark mode

- Contrôle via classe `dark` sur `<html>` (Tailwind `darkMode: 'class'`).
- `ThemeContext` (`src/renderer/contexts/ThemeContext.tsx`) : 
  - Initialisation depuis `localStorage('polenta:theme')`, fallback `prefers-color-scheme`.
  - Expose `theme`, `toggle()`, `setTheme()`.
- Toggle Soleil/Lune dans **AccountPanel** → section Préférences.

**Ratios de contraste WCAG vérifiés :**

| Paire light                     | Ratio  | Norme    |
|---------------------------------|--------|----------|
| `ink` (#0f172a) sur `surface`   | ~21:1  | AAA ✓    |
| `ink-2` (#475569) sur `surface` | ~6.1:1 | AA ✓     |
| `ink-3` (#94a3b8) sur `surface` | ~3.4:1 | AA (large text) |

| Paire dark                      | Ratio  | Norme    |
|---------------------------------|--------|----------|
| `ink` (#f1f5f9) sur `canvas`    | ~17:1  | AAA ✓    |
| `ink-2` (#cbd5e1) sur `surface` | ~9.7:1 | AAA ✓    |
| `ink-3` (#94a3b8) sur `surface` | ~5.5:1 | AA ✓     |

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
| `/req/new?projectId&component?&level?` | Formulaire nouvelle exigence | Produit ou Composants |
| `/req/$reqId?projectId&component?&level?` | Détail / édition d'une exigence | Produit ou Composants |
| `/test/new?projectId&component?&level?` | Formulaire nouveau cas de test | Produit ou Composants |
| `/test/$testId?projectId&component?&level?` | Détail / édition d'un cas de test | Produit ou Composants |
| `/campaign/new?projectId&component?&level?` | Formulaire nouvelle campagne | Produit ou Composants |
| `/campaign/$campaignId?projectId&component?&level?` | Détail / suivi d'une campagne | Produit ou Composants |
| `/components?projectId&component&level&tab` | **Panel Composants** — liste selon sélecteurs + tab | Composants |

> `component?` et `level?` sont optionnels : absents = contexte produit, présents = contexte composant. Le panel actif est déduit de leur présence.

### 19.4 Synchronisation sélecteurs sidebar ↔ main frame

L'état des sélecteurs (tab, component, level) est porté par l'URL.  
La sidebar lit les params URL courants (`useRouterState`) et navigue avec `replace: true` à chaque modification — pas de state local dupliqué.

### 19.3 Titre de fenêtre OS

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

### 19.4 Panneau — Compte

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

### 19.5 Panneau — Projet (sans projet chargé)

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

### 19.6 Panneau — Projet (projet chargé) — hub de configuration

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

### 19.6b Panneau — Version

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

### 19.7 Panneau — Produit

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

### 19.7.1 Route `/req/new` — Création d'exigence

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

### 19.7.2 Route `/req/$reqId` — Détail/édition d'une exigence

Search params : `{ repoPath, projectId, component?, level? }`

Champs pré-remplis et éditables inline. Boutons :
- **Sauvegarder** : `api.requirements.update(repoPath, reqId, { title, fields, modificationComment })`
- **Transitions** : `draft` → review → approved → obsolete via `api.requirements.transition()`
- Si `component` présent dans les search params → champ en lecture seule si `readonly: true` dans `schema.components`

### 19.8 Panneau — Composants

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

### 19.8.1 Route `/test/new` — Création de cas de test

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

### 19.8.2 Route `/test/$testId` — Détail/édition d'un cas de test

Search params : `{ repoPath, projectId, component?, level? }`

Champs pré-remplis et éditables. Bouton **Sauvegarder** : `api.tests.update(...)`. Section **Historique des runs** sous le formulaire.

### 19.8.3 Route `/campaign/new` — Création d'une campagne

Search params : `{ repoPath, projectId, component?, level? }`

| Champ | Contrôle | DTO cible |
|-------|----------|-----------|
| Titre * | `input[text]` | `title` |
| Description | `textarea` | `description` |
| Baseline | `input[text]` — tag git ou SHA | `baselineRef` |
| Cas de test | liste multi-sélection depuis les tests du contexte | `testCaseIds` |

Appel : `api.campaigns.create(repoPath, { title, description, baselineRef, testCaseIds, level, component })`

### 19.8.4 Route `/campaign/$campaignId` — Suivi d'une campagne

Affiche les cas de test avec leur statut courant dans la campagne (pending / passed / failed / blocked / skipped). Permet d'exécuter chaque test directement depuis la campagne.

### 19.9 Page "Nouvelle branche" (`/branch/new`)

Route déclenchée par le bouton `+ Nouvelle branche…` dans le panneau Version.

**Search params attendus :** `repoPath` + `projectId`.

**Champ :**
- `name` : nom de la branche (validé : pas d'espaces, pas de `..`, caractères git autorisés)
- Suggestion de format affichée : `feat/…`, `fix/…`, `jira/PROJ-123-…`

**Comportement :**
- `api.branches.create(repoPath, name)` → crée et checkout la branche
- Après succès : `navigate({ to: '/project/$id', params: { id: projectId } })` — NE PAS naviguer vers `/`
- **Ne pas utiliser `window.confirm()`** — tout état de confirmation se gère via un `useState` React inline

**Bouton "Merger" dans le panneau Version :**
- Premier clic : confirmation inline — **pas de `window.confirm()`**
- Oui → `api.branches.merge(repoPath, currentBranch)` → invalide les queries → navigue vers `/project/$id`

### 19.10 Zone principale

Affiche le détail de l'élément sélectionné dans la sidebar. Par défaut (rien de sélectionné) : vide ou message d'accueil.

| Sélection sidebar | Zone principale |
|------------------|----------------|
| Aucune | Vide |
| Exigence | Détail de l'exigence (lecture/édition) |
| Test | Détail du test + historique des runs |
| Commit (historique) | Diff du commit |

### 19.11 Routing avec le nouveau layout

Le layout racine (`__root.tsx`) adopte la structure sidebar + main. La route `/login` reste plein écran (sans sidebar).

```
/ (root layout)
├── /login              → plein écran (pas de sidebar)
└── (avec sidebar)
    ├── /               → panneau Projet actif par défaut
    ├── /project/$id    → panneau Projet actif, currentProjectId lu depuis params
    ├── /branch/new     → panneau Version actif, projectId depuis search param
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

### 19.12 Nouveaux channels IPC nécessaires

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `sync:log` | `repoPath: string, limit?: number` | `CommitEntry[]` |
| `sync:checkout-commit` | `repoPath: string, sha: string` | `void` |
| `app:set-title` | `title: string` | `void` (one-way) |
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
| `campaigns:create` | `repoPath: string, dto: CreateCampaignDto` | `TestCampaign` |
| `campaigns:update-run` | `repoPath: string, campaignId: string, testCaseId: string, status: TestRunStatus` | `TestCampaign` |
| `campaigns:close` | `repoPath: string, id: string, status: 'completed' \| 'abandoned'` | `TestCampaign` |

### 19.13 Barre de titre des vues (`ViewHeader`) et en-tête des panneaux latéraux (T92)

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

Les panneaux latéraux (sidebar) suivent une convention distincte, désormais généralisée à tous :
un conteneur `px-4 py-3 border-b border-edge` contenant `<p className="section-label">` (classe
existante, `index.css` : `text-xs font-semibold text-ink-3 uppercase tracking-wider`) avec le nom
du panneau tel qu'affiché dans `ActivityBar` (Projet, Version, Système, Suivi, Exigences, Tests,
Compte, Recherche). Seul ce bandeau de titre est concerné — les combobox/filtres/listes sous le
header gardent leur propre padding.

---

## 20. Schéma de projet (`.polenta/schema.yaml`)

Le schéma définit les types d'items, leurs champs personnalisés et les liens possibles entre eux. Il est **versionné dans le repo** à `.polenta/schema.yaml` — chaque branche peut avoir son propre schéma.

### 20.1 Format du fichier

```yaml
version: 1

requirementTypes:
  - name: functional           # valeur stockée dans Requirement.type
    label: "Fonctionnel"       # affiché dans l'UI
    prefix: FR                 # préfixe des IDs (ex: FR-0001)
    fields:
      - name: domain
        label: Domaine
        type: enum
        values: [SYS, SW, HW, MECA, BAT, PROD]
        required: true
      - name: priority
        label: Priorité
        type: enum
        values: [high, medium, low]
        default: medium
      - name: statement
        label: Énoncé
        type: textarea
        placeholder: "WHEN ... THE system SHALL ..."
      - name: justification
        label: Justification
        type: textarea
      - name: acceptance_criteria
        label: "Critères d'acceptance"
        type: textarea
      - name: notes
        label: Notes
        type: textarea
    statuses:
      - { name: draft,    label: Brouillon }
      - { name: review,   label: En review }
      - { name: approved, label: Approuvé,  isApproval: true }
      - { name: obsolete, label: Obsolète }

  - name: safety
    label: "Sécurité"
    prefix: SR
    fields:
      - { name: domain,    label: Domaine,   type: enum, values: [SYS, SW, HW, MECA, BAT, PROD], required: true }
      - { name: hazard,    label: Hazard,    type: text, required: true }
      - { name: asil,      label: ASIL,      type: enum, values: [QM, A, B, C, D], required: true }
      - { name: statement, label: Énoncé,    type: textarea }
    statuses:
      - { name: draft,    label: Brouillon }
      - { name: review,   label: En review }
      - { name: approved, label: Approuvé,  isApproval: true }
      - { name: obsolete, label: Obsolète }

testTypes:
  - name: manual
    label: "Manuel"
    prefix: TEST
    fields:
      - { name: domain, label: Domaine, type: enum, values: [SYS, SW, HW, MECA, BAT, PROD] }

  - name: automated
    label: "Automatisé"
    prefix: TEST
    fields:
      - { name: domain,       label: Domaine,          type: enum, values: [SYS, SW, HW, MECA, BAT, PROD] }
      - { name: script_path,  label: "Chemin script",  type: text }

linkTypes:
  - name: implements
    label: implémente
    sourceTypes: [functional, safety]
    targetTypes: [functional, safety]
  - name: verifies
    label: vérifie
    sourceCategory: test        # tous les types de tests
    targetCategory: requirement # toutes les exigences
  - name: derives_from
    label: dérive de
    sourceTypes: [functional, safety]
    targetTypes: [functional, safety]

# Niveaux — organisent les exigences et tests en couches d'abstraction
# Pilotent le sélecteur [niveau▾] dans le panel Composants
levels:
  - name: functional
    label: "Fonctionnel"
    requirementTypes: [functional, safety]   # noms de requirementTypes ci-dessus
    testTypes: [manual, automated]
  - name: hw
    label: "HW"
    requirementTypes: [hw_requirement]
    testTypes: [hw_test]
  - name: sw
    label: "SW"
    requirementTypes: [sw_requirement]
    testTypes: [sw_test]

# Composants réutilisables — source de vérité pour la génération de .gitmodules
components:
  - name: motor-control             # = nom du dossier dans components/ ET préfixe children::
    label: "Motorisation"
    description: "Driver moteur brushless + commande vitesse"
    domain: HW
    url: https://github.com/acme/comp-motor-control
    branch: main
    readonly: true                  # non modifiable depuis ce repo produit

  - name: bms
    label: "BMS"
    description: "Battery Management System"
    domain: BAT
    url: https://github.com/acme/comp-bms
    branch: main
    readonly: true
```

**`.gitmodules` est un fichier généré** depuis la section `components` — il ne doit pas être édité manuellement :

```ini
# .gitmodules — GÉNÉRÉ par Polenta (schema:save), ne pas éditer manuellement
[submodule "components/motor-control"]
	path   = components/motor-control
	url    = https://github.com/acme/comp-motor-control
	branch = main

[submodule "components/bms"]
	path   = components/bms
	url    = https://github.com/acme/comp-bms
	branch = main
```

### 20.2 Types TypeScript

#### `packages/types/src/schema.ts` — Schéma simplifié (desktop)

Utilisé par `SchemaService` et l'éditeur de schéma. Stocké dans `.polenta/schema.yaml`.

```typescript
export type SchemaFieldType = 'text' | 'textarea' | 'richtext' | 'number' | 'enum' | 'boolean' | 'date'

export interface SchemaField {
  name: string
  label?: string
  type: SchemaFieldType
  values?: string[]        // enum uniquement
  required?: boolean
  default?: unknown
  placeholder?: string
}

export interface SchemaStatus {
  name: string
  label?: string
  isApproval?: boolean     // true = incrémenter currentVersion
}

export interface RequirementTypeDefinition {
  name: string             // valeur stockée dans Requirement.type
  label?: string
  prefix?: string          // préfixe ID (ex: "FR")
  fields: SchemaField[]
  statuses?: SchemaStatus[]
}

export interface TestTypeDefinition {
  name: string
  label?: string
  prefix?: string
  fields: SchemaField[]
}

export interface LinkTypeDefinition {
  name: string
  label?: string
  sourceTypes?: string[]
  targetTypes?: string[]
  sourceCategory?: 'requirement' | 'test'
  targetCategory?: 'requirement' | 'test'
}

export interface LevelDefinition {
  name: string                  // ex: "functional", "hw", "sw"
  label: string
  requirementTypes: string[]    // noms de RequirementTypeDefinition filtrés pour ce niveau
  testTypes: string[]
}
```

#### `packages/types/src/config.ts` — Modèle avancé (cible future)

Modèle plus riche avec transitions, rôles, validateurs — base pour les sprints suivants.
**Non utilisé par le desktop actuellement** mais posé comme cible d'évolution.

```typescript
export type FieldType =
  | 'TEXT' | 'RICHTEXT' | 'ENUM' | 'MULTI_ENUM' | 'DRAWIO'
  | 'NUMBER' | 'DATE' | 'DATETIME' | 'BOOLEAN' | 'USER'

export interface FieldDefinition {
  id: string
  label: string
  type: FieldType
  required: boolean
  readOnly: boolean
  order: number
  triggerVersionComment: boolean
  validator?: string           // "EARS" | "regex:<pattern>"
  options?: EnumOption[]       // ENUM / MULTI_ENUM
  visibleInList: boolean
  visibleInDetail: boolean
  // + params type-spécifiques : maxLength, min, max, unit, decimals…
}

export interface StatusDefinition {
  id: string; label: string; color: string
  isApproved: boolean; isArchived: boolean; isInitial: boolean
}

export interface TransitionDefinition {
  from: string | '*'; to: string; label: string
  requiredRoles: string[]
  requiresComment: boolean
  requiresReview: boolean
}

export interface RequirementTypeConfig {
  id: string; name: string; prefix: string; color: string
  level: number              // profondeur hiérarchique
  parentTypes: string[]
  fields: FieldDefinition[]
  statuses: StatusDefinition[]
  transitions: TransitionDefinition[]
}

export interface ProjectConfig {
  requirementTypes: RequirementTypeConfig[]
}
```

> **Migration prévue :** à terme, `ProjectSchema` (schema.ts) migrera vers `ProjectConfig` (config.ts) pour bénéficier des transitions, des rôles et des validateurs. Les deux coexistent pendant la transition.

#### `packages/types/src/schema.ts` — suite

```typescript
export interface ComponentDefinition {
  name: string          // = nom du dossier dans components/ ET préfixe children::
  label: string
  description?: string
  domain: string        // domaine principal (HW, SW, BAT…)
  url: string           // URL du repo git du composant
  branch?: string       // branche par défaut (défaut: "main")
  readonly: boolean     // true = pas d'écriture depuis ce repo produit
}

export interface ProjectSchema {
  version: number
  requirementTypes: RequirementTypeDefinition[]
  testTypes: TestTypeDefinition[]
  linkTypes: LinkTypeDefinition[]
  levels: LevelDefinition[]          // vide pour un schema produit sans niveaux
  components: ComponentDefinition[]  // vide si projet sans composants réutilisables
}

// ── Campagnes de test ─────────────────────────────────────────────────────────

export type CampaignStatus = 'planned' | 'in-progress' | 'completed' | 'abandoned'
export type TestRunStatus = 'pending' | 'passed' | 'failed' | 'blocked' | 'skipped'

export interface TestCampaign {
  id: string                    // CAMP-0001
  title: string
  description?: string
  level?: string                // nom du niveau (functional | hw | sw) — absent = produit
  component?: string            // nom du composant — absent = campagne produit
  baselineRef?: string          // tag git ou SHA épinglé
  status: CampaignStatus
  testCaseIds: string[]         // cas de test inclus dans la campagne
  runs: CampaignTestRun[]
  createdAt: string
  completedAt?: string | null
}

export interface CampaignTestRun {
  testCaseId: string
  status: TestRunStatus
  runId?: string                // référence vers le TestRun si exécuté
  executedAt?: string
  executedBy?: string
}
```

### 20.3 SchemaService (`apps/desktop/src/main/services/schema.service.ts`)

- Lit `.polenta/schema.yaml` via `fs.readFile` (working tree direct, pas git)
- Parse avec `js-yaml` (`yaml.load`)
- Si fichier absent ou invalide → retourne le **schéma par défaut** (hard-codé en TypeScript, reproduit le comportement actuel avec types `functional`, `performance`, `safety`, `interface`, `constraint` / `manual`, `automated`, `semi-automated`)
- Résultat mis en cache par `repoPath` (invalidé si le fichier change — via RepoWatcher optionnellement)

```typescript
export class SchemaService {
  private cache = new Map<string, ProjectSchema>()

  async get(repoPath: string): Promise<ProjectSchema> {
    if (this.cache.has(repoPath)) return this.cache.get(repoPath)!
    const schema = await this.readFromDisk(repoPath)
    this.cache.set(repoPath, schema)
    return schema
  }

  async save(repoPath: string, schema: ProjectSchema): Promise<void> {
    const dir = path.join(repoPath, '.polenta')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'schema.yaml'), yaml.dump(schema, { lineWidth: 120 }), 'utf-8')
    this.cache.set(repoPath, schema)

    // Régénère .gitmodules depuis schema.components
    await this.generateGitmodules(repoPath, schema.components ?? [])
  }

  invalidate(repoPath: string) { this.cache.delete(repoPath) }

  private async readFromDisk(repoPath: string): Promise<ProjectSchema> {
    try {
      const raw = await fs.readFile(path.join(repoPath, '.polenta', 'schema.yaml'), 'utf-8')
      return yaml.load(raw) as ProjectSchema
    } catch {
      return DEFAULT_SCHEMA
    }
  }

  /**
   * Génère .gitmodules depuis schema.components.
   * .gitmodules est un artefact dérivé — ne jamais l'éditer manuellement.
   */
  private async generateGitmodules(repoPath: string, components: ComponentDefinition[]): Promise<void> {
    if (components.length === 0) return

    const lines = [
      '# GÉNÉRÉ par Polenta (schema:save) — ne pas éditer manuellement',
      ...components.flatMap(c => [
        `[submodule "components/${c.name}"]`,
        `\tpath   = components/${c.name}`,
        `\turl    = ${c.url}`,
        `\tbranch = ${c.branch ?? 'main'}`,
        '',
      ]),
    ]
    await fs.writeFile(path.join(repoPath, '.gitmodules'), lines.join('\n'), 'utf-8')
  }
}
```

**Schéma par défaut** : reproduit exactement les types actuels hardcodés (`functional`, `safety`, `performance`, `interface`, `constraint`, `manual`, `automated`, `semi-automated`) avec les champs `domain`, `priority`, `statement`, `justification`, `acceptance_criteria`, `notes`. `components: []` par défaut.

### 20.4 IPC channels

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `schema:get` | `repoPath: string` | `ProjectSchema` |
| `schema:save` | `repoPath: string, schema: ProjectSchema` | `void` |

`schema:save` crée `.polenta/` si absent, écrit le YAML, met à jour le cache, **et régénère `.gitmodules`** depuis `schema.components`. C'est le seul endroit où `.gitmodules` est écrit.

`ApiClient.schema` : `get(repoPath): Promise<ProjectSchema>` + `save(repoPath, schema): Promise<void>`

### 20.5 Formulaires dynamiques (renderer)

**Hook `useProjectSchema(repoPath)`** : appelle `api.schema.get(repoPath)`, mis en cache par TanStack Query (staleTime: `Infinity` — le schéma ne change pas pendant une session).

**Composant `DynamicField`** : render un contrôle selon `FieldDefinition.type` :
- `richtext` → `<RichTextField>` (TipTap — voir §21)
- `text` → `<input type="text">`
- `textarea` → `<textarea>`
- `enum` → `<select>` avec `<option>` pour chaque valeur
- `number` → `<input type="number">`
- `boolean` → `<input type="checkbox">`
- `date` → `<input type="date">`

```tsx
<DynamicField
  field={fieldDef}
  value={fields[fieldDef.name] as string ?? ''}
  onChange={(val) => setFields(prev => ({ ...prev, [fieldDef.name]: val }))}
/>
```

**Routes req.new / req.$reqId / test.new / test.$testId** : chargent le schéma puis rendent dynamiquement les champs selon le type d'item sélectionné.

**Sélection du type sur "+"** : dans `RequirementsPanel` et `TestsPanel`, le bouton `[+]` ouvre un petit dropdown listant les types disponibles depuis le schéma → navigue vers `/req/new?type=functional&...` avec le type pré-sélectionné.

**Schéma par défaut — champs `richtext`** : dans les types `functional` et `performance`, les champs `statement`, `justification`, `acceptance_criteria`, `notes` sont de type `richtext`. Les types `safety`, `interface`, `constraint` gardent `textarea` (énoncés plus courts, syntaxe contrainte).

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

### 20.6 Éditeur de modèle — Route `/schema`

Accessible via le lien **"⚙ Modèle de données"** dans le panneau Projet (bas du panneau, avant Historique).

Search params : `{ repoPath, projectId }`

**Layout :** header (← Projet | titre | [Enregistrer]) + trois onglets.

**Onglet Exigences :**
- Liste de cartes repliables, une par type (`requirementTypes`)
- Chaque carte : champs Nom (identifiant, `font-mono`), Label, Préfixe
- Table **Champs** : colonnes Nom, Label, Type (`select` parmi `text|textarea|number|enum|boolean|date`), Valeurs enum (comma-separated, disabled si type ≠ enum), Requis (checkbox), Défaut, boutons ↑ ↓ ×
- Table **Statuts** : colonnes Nom, Label, Approbation (checkbox `isApproval`), boutons ↑ ↓ ×
- Bouton `× Supprimer ce type` (header carte)
- Bouton `+ Ajouter un type d'exigence` (bas de liste)

**Onglet Tests :** idem sans table Statuts

**Onglet Liens :** table simple (Nom, Label, Source `select requirement|test|—`, Cible `select`, ×) + `+ Ajouter un lien`

**Comportement :**
- Modifications locales uniquement (pas d'auto-save)
- [Enregistrer] → `api.schema.save(repoPath, editableToSchema(state))` → invalide `['schema', repoPath]` → affiche `✓ Enregistré` (2 s)
- Les valeurs enum sont éditées comme chaîne séparée par virgules, converties en tableau à la sauvegarde
- Nouveau type d'exigence créé avec statuts par défaut (draft, review, approved, obsolete) pré-remplis

### 20.7 Liens (UI — sprint suivant)

Les `linkTypes` sont définis dans le schéma dès maintenant mais l'interface de gestion des liens (ajouter/supprimer un lien entre deux items) est implémentée dans un sprint ultérieur.

---

## 22. Architecture multi-composants — Submodules Git

### 22.1 Principe

Un produit est composé de composants réutilisables (ex : `motor-control`, `bms`, `filtration`). Chaque composant vit dans son propre repo Git, référencé comme submodule dans le repo produit.

**Règles structurelles :**
- **Un seul niveau de submodule** — pas de submodule dans un submodule
- **Max ~10 composants par produit** — ordre de grandeur du nombre de cartes électroniques
- **Les composants sont des bibliothèques** — pas de référence remontante vers le repo produit dans leurs frontmatters
- **L'arbre de traçabilité complet vit dans le repo produit** — source de vérité unique

**Fichiers générés — ne jamais éditer manuellement :**

| Fichier | Généré par | Déclencheur |
|---|---|---|
| `.gitmodules` | `SchemaService.save()` | Modification de `schema.components` |
| `tree.yaml` | `scripts/update-tree.py` | Hook pre-commit |

### 22.2 Structure d'un repo produit

```
product-aspirateur-v1/        ← repo produit (repo Git principal)
├── .gitmodules               ← GÉNÉRÉ depuis schema.components — ne pas éditer
├── components/
│   ├── motor-control/        ← submodule initialisé par Polenta
│   ├── bms/
│   └── filtration/
├── requirements/
│   └── SYS/                  ← exigences système propres au produit
├── tests/
│   └── SYS/
├── tree.yaml                 ← GÉNÉRÉ par update-tree.py — ne pas éditer
├── .polenta/
│   └── schema.yaml           ← source de vérité (types + composants)
└── .git/hooks/
    └── pre-commit            ← régénère tree.yaml avant chaque commit
```

### 22.3 Structure d'un repo composant

```
comp-motor-control/           ← repo composant autonome
├── requirements/
│   ├── functional/           ← REQ-MC-001, REQ-MC-002…
│   ├── hw/                   ← REQ-MC-HW-001…
│   └── sw/                   ← REQ-MC-SW-001…
└── tests/
    └── TEST-MC-001.md
```

Un composant **ne contient pas** de champ `parents:` pointant vers des exigences produit — il est autonome.

### 22.4 Références cross-composant dans `children:`

Quand une exigence produit (SYS) pointe vers une exigence d'un composant, elle utilise le préfixe `composant::` :

```yaml
# requirements/SYS/SYS-001.md (dans le repo produit)
---
id: SYS-001
children:
  - motor-control::REQ-MC-007   # ← préfixe = nom du dossier submodule
  - bms::REQ-BMS-012
---
```

Les exigences internes à un composant utilisent des références simples (sans préfixe) pour leurs propres liens `children:`.

### 22.5 `tree.yaml` — arbre de traçabilité généré

`tree.yaml` est une **vue matérialisée** de l'arbre complet, générée automatiquement depuis les champs `children:` de tous les frontmatters (repo produit + tous les submodules). Il est commité dans le repo produit mais jamais édité à la main.

```yaml
# tree.yaml — exemple
- id: SYS-001
  title: "Autonomie minimale"
  repo: product
  children:
    - id: motor-control::REQ-MC-007
      title: "Consommation turbo"
      repo: motor-control
      children: []
    - id: bms::REQ-BMS-012
      title: "Décharge profonde interdite"
      repo: bms
      children:
        - id: bms::REQ-BMS-SW-004
          title: "Cutoff tension < 2.8V"
          repo: bms
          children: []
```

**Ce que `tree.yaml` apporte :**
- Navigation rapide sans parser tous les `.md` à la volée
- Détection de cycles ou d'orphelins à la génération
- Diff Git lisible sur l'évolution de l'arbre entre deux versions
- Support de la matrice de traçabilité sans traversée multi-repo en temps réel

### 22.6 Hook pre-commit — régénération automatique

Un hook `pre-commit` dans le repo produit régénère `tree.yaml` avant chaque commit et l'inclut dans le commit :

```bash
#!/bin/bash
# .git/hooks/pre-commit
python scripts/update-tree.py   # parse tous les .md du repo + submodules
git add tree.yaml               # inclure dans le commit courant
```

Le script `scripts/update-tree.py` :
1. Parcourt tous les fichiers `.md` du repo produit
2. Parcourt tous les fichiers `.md` de chaque submodule (via `components/*/`)
3. Construit l'arbre depuis les champs `children:` des frontmatters
4. Détecte les cycles et les références orphelines (avertissements)
5. Écrit `tree.yaml`

### 22.7 Impact sur `WorkspaceService`

Lors d'un clone ou de l'ouverture d'un projet, `WorkspaceService` initialise les submodules déclarés dans `.gitmodules` (généré depuis `schema.components`) :

```typescript
// Dans WorkspaceService.cloneAndAdd() — après le clone principal :
await git.submodule.init({ fs, dir: localPath })
await git.submodule.update({ fs, dir: localPath })

// Dans WorkspaceService.addLocalProject() — si .gitmodules existe :
await git.submodule.update({ fs, dir: localPath })
```

`WorkspaceProject` expose les composants résolus (métadonnées schema + SHA Git courant) :

```typescript
export interface WorkspaceProject {
  // … champs existants …
  components: ResolvedComponent[]
}

export interface ResolvedComponent {
  definition: ComponentDefinition  // depuis schema.components
  localPath: string                // chemin absolu dans le working tree
  sha: string                      // SHA épinglé dans le repo produit
  isInitialized: boolean           // false si submodule pas encore initialisé
}
```

### 22.8 Impact sur `GitService`

`listFiles()` prend en compte les submodules : les chemins `components/<nom>/` sont traversés normalement (ils font partie du working tree une fois initialisés).

`writeYaml()` ne peut écrire que dans le repo produit — les composants ne sont pas éditables directement depuis l'app (lecture seule). Toute modification d'un composant passe par le repo composant.

### 22.9 Nouveaux channels IPC

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `submodules:list` | `repoPath: string` | `ResolvedComponent[]` |
| `submodules:status` | `repoPath: string` | `{ name: string; sha: string; isDirty: boolean }[]` |
| `submodules:update` | `repoPath: string, name?: string` | `void` (init + update du submodule donné, ou tous) |

> **Note :** l'ajout ou la suppression d'un composant passe par `schema:save` (qui régénère `.gitmodules`), suivi de `submodules:update` pour initialiser le nouveau submodule. Il n'y a pas de channel `submodules:add` séparé.

---

## 18. Ordre d'implémentation recommandé

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

Sprint 11 — Panels Produit & Composants + Campagnes (voir §19.7-19.8 + §20.2)
  ① Ajouter `levels` + `TestCampaign` + `CampaignTestRun` dans `packages/types`
  ② `CampaignsService` (create, list, updateRun, close) + stockage YAML dans `campaigns/`
  ③ Handlers IPC campaigns:list/get/create/update-run/close
  ④ Remplacer icônes Exigences + Tests par Produit (📋) + Composants (🧩) dans ActivityBar
  ⑤ Créer `ProductPanel` (sidebar) — tabs Exigences/Tests/Campagnes, contenu piloté par schema
  ⑥ Créer `ComponentsPanel` (sidebar) — sélecteurs [composant▾][niveau▾] sur une ligne + mêmes tabs
  ⑦ Routes `/product`, `/components` (panels par défaut)
  ⑧ Routes `/campaign/new`, `/campaign/$id` (création + suivi)
  ⑨ Passer `component?` + `level?` en search params sur `/req/*`, `/test/*`, `/campaign/*`
  ⑩ Mise à jour déduction `activePanel` dans `AppLayout` (voir §19.11)
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
  ⑥ Créer src/renderer/components/sidebar/AccountPanel.tsx (§19.4)
  ⑦ Créer src/renderer/components/sidebar/ProjectPanel.tsx (§19.5 + §19.6)
       — Sans projet : liste Récents + boutons Créer/Charger/Ouvrir
       — Avec projet : branche, modifications, historique, bouton Nouvelle Action
  ⑧ Créer src/renderer/components/sidebar/RequirementsPanel.tsx (§19.7)
       — Arborescence groupée par domaine, dot de statut, filtre texte
  ⑨ Créer src/renderer/components/sidebar/TestsPanel.tsx (§19.8)
       — Arborescence groupée par domaine, icône dernier résultat, filtre texte
  ⑩ Ajouter IPC handler sync:log (isomorphic-git log)
  ⑪ Ajouter sync.log() dans ApiClient + ipc-client
  ⑫ Ajouter IPC handler app:set-title (BrowserWindow.setTitle)
  ⑬ Appeler app:set-title au chargement/fermeture d'un projet
  ⑭ Griser les icônes Exigences/Tests/etc. si aucun projet chargé
```
