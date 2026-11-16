# GH361 — Design : dossiers des exigences, tests et issues via le serveur MCP

Spec : `specs/GH361.md`. Deux sprints.

## 1. Vue d'ensemble

```
MCP (process séparé)                         Application (main + renderer, ou serveur web)
────────────────────                         ──────────────────────────────────────────────
tools/tree.tools.ts                          renderer : useTreeEditLock(repo, nœud, type)
  │  résout la cible (repo, nœud, type)        │  acquire → renew toutes les 10 s → release
  │  withTreeWrite(...)  ── verrou court ──┐   ▼
  │     tree-ops.util (pur)               │  IPC tree:lock / tree:lock-renew / tree:unlock
  │     TreeService.readLayout / save     │   ▼
  ▼                                       │  TreeEditLocks (main) : baux en mémoire,
main/services/tree-lock.util.ts  ◄────────┴── un fichier par (process, arbre) dans le dossier git
```

Un seul module de verrou (`tree-lock.util.ts`) est utilisé par les deux processus : le serveur
MCP pour le verrou court d'écriture, l'application pour le verrou long.

## 2. Verrou (`main/services/tree-lock.util.ts`, nouveau)

### 2.1 Emplacement

`<gitdir>/polenta/locks/` : `<gitdir>` = `<repo>/.git` (dossier) ou la cible de `gitdir:` (fichier
`.git` d'un worktree). Jamais versionné, jamais dans `git status`, propre au clone. Repo sans `.git`
(tests unitaires, dossier non initialisé) : `os.tmpdir()/polenta-locks/<sha1 du chemin absolu
normalisé>` — repli seulement, aucun repo Polenta réel n'est dans ce cas.

Clé d'arbre : `tree.<enc(nœud)>.<enc(type)>` (`encodeURIComponent`, puis `_` → `__` et `%` → `_`
pour rester un nom de fichier valide sous Windows ; injectif, `__` et `_XX` ne se confondent pas).

### 2.2 Fichiers

- **Verrou long (application)** : `<clé>.app-<pid>.json`
  `{ pid, since: ISO, expiresAt: ISO }` — un fichier par processus applicatif (deux instances de
  l'app ou app + serveur web sur le même clone ne s'écrasent pas).
- **Verrou court (écriture MCP)** : `<clé>.write` créé avec `flag: 'wx'` (création exclusive,
  atomique) `{ pid, since: ISO }`.

### 2.3 Péremption

- Verrou long actif ⇔ `expiresAt > maintenant` **et** processus `pid` vivant
  (`process.kill(pid, 0)` : `ESRCH` = mort, `EPERM` = vivant). App tuée → ignoré immédiatement ;
  renderer ou navigateur disparu (serveur web vivant) → ignoré après expiration du bail (30 s).
- Verrou court périmé ⇔ processus mort, ou `since` plus vieux que 30 s. Un verrou court périmé est
  supprimé par celui qui le rencontre.

### 2.4 API

```ts
export const TREE_LOCK_TTL_MS = 30_000
export const TREE_WRITE_WAIT_MS = 5_000

export interface TreeLockInfo { by: 'app'; since: string }
export class TreeLockedError extends Error { readonly code = 'TREE_LOCKED'; info?: TreeLockInfo }

/** Verrou long actif le plus ancien de cet arbre, ou null. */
export function readAppLock(repoPath, nodeId, typeId): Promise<TreeLockInfo | null>
/** Écrit / prolonge / retire le fichier de verrou long de CE processus. */
export function writeAppLock(repoPath, nodeId, typeId, since: string, expiresAt: string): Promise<void>
export function removeAppLock(repoPath, nodeId, typeId): Promise<void>
/** Attend qu'aucun verrou court actif ne tienne l'arbre (poll 25 ms, max TREE_WRITE_WAIT_MS ; au-delà : rend la main quand même). */
export function waitForWriteLock(repoPath, nodeId, typeId): Promise<void>
/**
 * Verrou court : prend `<clé>.write` (attente max TREE_WRITE_WAIT_MS, sinon TreeLockedError),
 * PUIS vérifie le verrou long (actif → libère et lève TreeLockedError avec info), exécute `fn`,
 * libère toujours.
 */
export function withTreeWriteLock<T>(repoPath, nodeId, typeId, fn: () => Promise<T>): Promise<T>
```

### 2.5 Absence de course

- MCP : *prend le verrou court, puis* lit le verrou long.
- App : *écrit le verrou long, puis* attend la fin d'un verrou court, *puis* charge l'arbre.

Si le MCP a pris le verrou court avant que l'app n'écrive son verrou long, il ne voit pas l'app et
écrit ; l'app attend la libération puis relit l'arbre → l'écriture du MCP est affichée, pas
écrasée. Si l'app a écrit d'abord, le MCP la voit et refuse. Aucun entrelacement ne perd
d'écriture.

## 3. Côté application (sprint 2)

### 3.1 `TreeEditLocks` (`main/services/tree-edit-locks.service.ts`, nouveau)

Baux en mémoire : `Map<leaseId, { repoPath, nodeId, typeId, expiresAt }>`.

- `acquire(repoPath, nodeId, typeId) → leaseId` : enregistre le bail, (ré)écrit le fichier de
  l'arbre avec `expiresAt` = max des baux de cet arbre, puis `waitForWriteLock`.
- `renew(leaseId)` : prolonge le bail (+30 s) et réécrit le fichier. Bail inconnu (purgé) → `false`,
  le renderer refait un `acquire`.
- `release(leaseId)` : retire le bail ; plus aucun bail sur l'arbre → `removeAppLock`.
- Purge toutes les 10 s des baux expirés (renderer planté, onglet du navigateur fermé).
- `releaseAll()` à l'arrêt : `before-quit` (Electron), arrêt du serveur web.

Construit dans `main/container.ts` (partagé par l'hôte Electron et le serveur web).

### 3.2 IPC

`tree:lock (repoPath, nodeId, typeId) → leaseId`, `tree:lock-renew (leaseId) → boolean`,
`tree:unlock (leaseId)`. Ajoutés à `packages/api-client` (`types.ts`, `ipc-client.ts`) et à
`web-server/channel-policy.ts` (`tree:lock` : repo en argument 0 ; les deux autres ne portent pas
de chemin de repo — même traitement que `tree:generate-id`).

### 3.3 Renderer : `useTreeEditLock` (`renderer/hooks/useTreeEditLock.ts`, nouveau)

```ts
useTreeEditLock({ repoPath, nodeId, typeId, enabled, onAcquired })
```

- `enabled` vrai → `api.tree.lock`, puis `onAcquired()` (invalide la requête `['tree', …]` : l'arbre
  est relu après la fin d'une éventuelle écriture MCP), puis `renew` toutes les 10 s (`false` →
  nouvel `acquire`). Changement de clé ou `enabled` faux ou démontage → `unlock`.
- Appelé dans `SystemPanel` (barre latérale) — c'est lui qui affiche l'arbre éditable — avec
  `enabled = !readOnly && catégorie ∈ {requirement, test, issue}` et la cible effective du
  `SystemViewContext`. Le panneau n'est monté que quand la barre latérale montre Exigences /
  Tests / Issues : le changement d'onglet ou de type libère le verrou. Les vues principales
  (`SystemView`, Word / Excel) écrivent l'arbre par le même contexte et ne s'affichent qu'avec ce
  panneau ; elles n'ont pas besoin de leur propre bail. Le sélecteur de tests des campagnes et les
  pages d'impression ne verrouillent pas.

## 4. Côté MCP (sprint 1)

### 4.1 Container

`createMcpContainer` reconstruit un `TreeService` (lister `indexObjectLister(reqIndex, testsIndex,
p => issues.findAll(p))`, adopteur `serviceTitleAdopter(requirements, tests, issues)`, comme
`main/container.ts`) et l'expose (`tree`). Commentaire GH180 du container et SPEC-MCP-SERVER §3
mis à jour.

### 4.2 `TreeService.readLayout` (ajout)

```ts
async readLayout(repoPath, nodeId, typeId): Promise<{
  placed: TypeTreeNode[]                     // rangement stocké, noms hydratés (titres)
  unclassified: Array<{ id: string; title: string }>   // queue non classée, triée par ID
  objects: Array<{ id: string; title: string }>        // tous les objets du type
}>
```

Les outils travaillent sur le **rangement** (`placed`, partie stockée de l'arbre hydraté) et
l'enregistrent avec `save`, qui applique les règles GH180 (pas de `name` sur les éléments, queue
triée retirée). Ranger un objet non classé = créer son élément ; le remettre en non classé =
retirer son élément. Travailler sur l'arbre hydraté complet a été écarté : un dossier ajouté « à la
fin de la racine » se placerait après la queue non classée, qui ne serait alors plus coupée par
`stripTree` et serait écrite en entier dans le fichier.

### 4.3 Opérations pures (`main/services/tree-ops.util.ts`, nouveau)

Sur `TypeTreeNode[]`, sans E/S, chacune renvoie le nouvel arbre ou une erreur codée
(`TreeOpError { code, message }`) :

| Fonction | Rôle |
|---|---|
| `parseFolderPath(path)` | segments nettoyés ou `FOLDER_PATH_INVALID` |
| `findFolder(root, segments)` | dossier, `FOLDER_NOT_FOUND` ou `FOLDER_AMBIGUOUS` (dossiers seulement, à travers les dossiers) |
| `ensureFolder(root, segments, genId)` | crée les manquants à la fin de leur parent ; renvoie chemins créés |
| `renameFolder(root, path, name)` | `FOLDER_EXISTS`, `FOLDER_PATH_INVALID` (nom avec `/`) |
| `moveFolder(root, path, parent)` | `FOLDER_CYCLE`, `FOLDER_EXISTS` ; fin du parent |
| `deleteFolder(root, path, recursive)` | `FOLDER_NOT_EMPTY` ; renvoie les objets qui n'ont plus aucun élément |
| `moveObject(root, objectId, target)` | `OBJECT_AMBIGUOUS` ; `target` null → retrait (§4.5) |
| `reorderChildren(root, folder, order)` | `NOT_A_CHILD`, `DUPLICATE_ENTRY` |
| `toEntries(root, placedCount)` | `TreeEntry[]` (chemins calculés, `path: null` si un ancêtre contient `/`) |

Les dossiers sont trouvés par nom **parmi les enfants dossiers** d'un nœud ; un dossier imbriqué
sous un élément (possible dans l'app) n'est pas atteignable par chemin, comme un nom avec `/`.

### 4.4 Outils (`mcp-server/tools/tree.tools.ts`, nouveau)

Enregistrés dans `mcp-server/index.ts` : `get_tree`, `create_folders`, `rename_folder`,
`move_folder`, `delete_folders`, `move_to_folder`, `reorder_tree`.

Résolution commune `resolveTreeTarget(container, objectTypeRef)` :
1. type : `readOwnedTypeDef` (repo ouvert, sinon repo du composant) → `TYPE_NOT_FOUND` ; catégorie
   hors requirement/test/issue → `TYPE_NOT_SUPPORTED` ;
2. repo : `schema.resolveComponentRepoPath(...) ?? repoPath` ;
3. nœud : préfixe de la ref si repo = repo ouvert ; sinon le nœud du schéma du composant qui
   porte le type (`flattenSystemNodes`), à défaut `root` — c'est l'arbre que l'application ouvre
   pour ce repo (§ `SystemViewContext`, `componentOptions`) ;
4. écriture : `assertWritableBranch`, nœud `readonly` du schéma ouvert, `versions.isReadonly(repo)`
   → `READONLY_BRANCH` / `READONLY_REPO`.

Écriture commune `mutateTree(target, dryRun, apply)` :
- `freshenIndexes` (pas de watcher dans ce process) ;
- `dryRun` : `readLayout`, `apply` en mémoire, sortie + `locked: readAppLock(...)` ;
- sinon `withTreeWriteLock(... readLayout → apply → save si l'arbre a changé)` ;
  `TreeLockedError` → `errorToolResult('[TREE_LOCKED] …')` avec le message de la spec.

Erreurs par entrée : `{ index, …, reason: '[CODE] message' }` (convention des autres outils).

### 4.5 Détails tranchés ici

- **`move_to_folder` avec `folder: null`** : l'élément est retiré ; ses enfants (sous-éléments ou
  dossiers rangés sous lui) prennent sa place, dans l'ordre — rien d'autre ne sort du rangement.
- **Déplacement « déjà en place »** : objet dont l'unique élément a pour parent le dossier cible →
  `unchanged`, l'ordre n'est pas modifié.
- **`reorder_tree` à la racine** : citer un objet non classé crée son élément à la position
  demandée (il devient rangé à la racine).
- **Rien n'a changé** (tout `unchanged` / `existing`) : pas d'écriture.

### 4.6 `bulk_import_requirements` / `bulk_import_tests`

- Entrée : `CreateRequirementSchema.extend({ folder: z.string().optional() })` (idem tests). Le
  champ est retiré du DTO avant `validateBulkEntries` et `create`.
- `dryRun` : `parseFolderPath` + `findFolder` sur l'arbre hydraté du type (un `FOLDER_NOT_FOUND`
  n'est pas une erreur : le dossier sera créé) → erreur d'entrée sinon ; sortie enrichie de
  `foldersToCreate` et `locked` (par type).
- Écriture : après la boucle de création, regroupement des entrées créées avec `folder` par
  `objectTypeRef`, puis une `mutateTree` par type (`ensureFolder` + `moveObject` en série). Échec →
  chaque entrée concernée reçoit `FOLDER_PLACEMENT_FAILED: <cause>` dans `errors`, l'objet reste
  créé (et compté dans `created`).

### 4.7 AGENTS.md

`agents-md.template.ts` : paragraphe « Rangement en dossiers » — outils, chemin `A/B`, `dryRun`,
`folder` de `bulk_import_*`, `TREE_LOCKED` = demander à l'utilisateur de quitter ce type dans
l'application, ne jamais éditer `.polenta/trees/` à la main.

## 5. Fichiers

| Fichier | Sprint | Changement |
|---|---|---|
| `main/services/tree-lock.util.ts` | 1 | nouveau — §2 |
| `main/services/tree-ops.util.ts` | 1 | nouveau — §4.3 |
| `main/services/tree.service.ts` | 1 | `readLayout` |
| `mcp-server/container.ts` | 1 | `tree: TreeService` |
| `mcp-server/tools/tree.tools.ts` | 1 | nouveau — §4.4 |
| `mcp-server/tools/bulk-import.tools.ts` | 1 | champ `folder` — §4.6 |
| `mcp-server/index.ts` | 1 | enregistrement |
| `main/services/agents-md.template.ts` | 1 | §4.7 |
| `main/services/tree-edit-locks.service.ts` | 2 | nouveau — §3.1 |
| `main/container.ts`, `main/ipc/index.ts`, hôte Electron / serveur web | 2 | IPC, `releaseAll` à l'arrêt |
| `packages/api-client/src/{types,ipc-client}.ts`, `web-server/channel-policy.ts` | 2 | canaux |
| `renderer/hooks/useTreeEditLock.ts`, `renderer/components/sidebar/SystemPanel.tsx` | 2 | §3.3 |
| `specs/SPEC-MCP-SERVER.md`, `specs/SPEC-INDEX.md` (+ section arbre GH180) | 2 | mises à jour SPEC |

## 6. Alternatives rejetées

- **Verrou dans `.polenta/`** : versionné → bruit dans `git status`, risque de commit.
- **Verrou dans `os.tmpdir()` seul** : le serveur MCP est lancé par un agent qui peut avoir son
  propre `TMP` (bac à sable) → les deux processus ne verraient pas le même dossier.
- **Révision optimiste (comparaison de contenu à l'enregistrement)** : choix de l'humain = verrou
  exclusif long.
- **Opérer sur le fichier stocké plutôt que sur l'arbre hydraté** : obligerait à dupliquer les
  règles GH180 (queue non classée, `name` des éléments).
- **Hook de verrou dans `SystemViewContext`** : le provider est monté sur toutes les pages ; le
  verrou resterait pris sur Suivi ou Paramètres.

## 7. Sprints

- **Sprint 1 — MCP** : §2 (module de verrou complet, testé seul), §4 (outils, bulk import,
  AGENTS.md). Livrable autonome : sans le sprint 2 l'application ne pose simplement pas de verrou.
- **Sprint 2 — Application** : §3 (baux, IPC, web, hook), e2e, mises à jour SPEC.
