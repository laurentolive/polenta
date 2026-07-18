# T69-design — Refonte architecture workspace & composants interface

## 1. Vue d'ensemble

T69 introduit un modèle de workspace fondamentalement différent de l'existant :

| Avant (submodules git) | Après (workspace plat Polenta) |
|---|---|
| `schema.nodes[].url` déclare les composants | `polenta-repo.yaml` à la racine de chaque repo |
| `components/<name>/` géré par git submodule | Répertoires frères dans un workspace plat |
| Limit de ~10 submodules | Illimité |
| `tree.yaml` versionné dans le repo | `.polenta/tree.cache.yaml` hors repo (local) |
| Clone déclenché par `schema:save` (SchemaService) | Clone déclenché à l'ouverture du workspace |

La refonte touche quatre couches : types, services main, IPC handlers, UI renderer. Le volume est trop grand pour un seul sprint — voir §9 (découpage sprints).

---

## 2. Fichiers à modifier

### 2.1 Types (`packages/types/src/`)

#### `schema.ts`
- **Supprimer** `url?: string` et `branch?: string` de `SystemNode`.
- **Ajouter** type `ImplementsDeclaration` (champ optionnel sur `SystemNode` ou niveau `ProjectSchema`) — voir §3.
- **Ajouter** champ `roles?: RoleDefinition[]` au niveau `ProjectSchema` (pour les repos interface).

#### `workspace.ts`
- **Remplacer** `WorkspaceProject` (actuellement un enregistrement dans `workspace.json` userData) par deux types distincts :
  - `PolentaWorkspace` — description du workspace plat (chemin racine, projet root, mount-overrides)
  - `WorkspaceProject` conservé pour la liste des projets récents (compatibilité), mais avec une ref optionnelle vers le workspace racine.

#### Nouveaux fichiers de types :
- `packages/types/src/polenta-repo.ts` — `PolentaRepoDependency`, `PolentaRepoManifest`
- `packages/types/src/polenta-workspace.ts` — `PolentaWorkspaceConfig`, `MountOverride`, `WorkspaceTree`, `WorkspaceTreeNode`

### 2.2 Services main (`apps/desktop/src/main/services/`)

#### `schema.service.ts`
- **Supprimer** : `syncSubmodules()`, `buildGitmodules()`, `cloneSubmodule()`, `removeSubmodule()`, `writeGitmodules()`.
- **Modifier** `resolveComponentRepoPath()` : ne plus se baser sur `node.url`; à la place, chercher le répertoire frère dans le workspace (si `workspaceRootPath` est connu) ou retourner `null`.
- **Modifier** `save()` : supprimer l'appel fire-and-forget à `syncSubmodules()`.

#### `workspace.service.ts`
- **Conserver** tel quel pour la liste des projets récents (`workspace.json` dans userData) — compatibilité CA-6.
- **Ajouter** méthodes liées au workspace plat :
  - `detectWorkspace(dir: string): Promise<'workspace' | 'repo' | 'unknown'>`
  - `initWorkspace(dir: string, rootRepoUrl: string): Promise<void>`
  - `openWorkspace(dir: string): Promise<WorkspaceOpenResult>` — lit `workspace.yaml`, lance le parsing récursif si cache périmé.

#### Nouveau service : `polenta-repo.service.ts`
- `readManifest(repoPath: string): Promise<PolentaRepoManifest | null>`
- `writeManifest(repoPath: string, manifest: PolentaRepoManifest): Promise<void>`

#### Nouveau service : `workspace-tree.service.ts`
Responsable du parsing récursif et du cache. Méthodes :
- `buildTree(workspaceDir: string, rootRepoPath: string, mountOverrides: MountOverride[]): Promise<WorkspaceTreeResult>`
- `readCache(workspaceDir: string): Promise<WorkspaceTree | null>`
- `writeCache(workspaceDir: string, tree: WorkspaceTree): Promise<void>`
- `isCacheValid(workspaceDir: string, rootRepoPath: string): Promise<boolean>` — compare HEAD SHA.
- Algorithme DFS avec détection de cycle (Set d'URLs visitées).
- Détection diamond : si même URL avec pins différents → retourne `{ conflicts: DiamondConflict[] }`.

#### Nouveau service : `interface-compliance.service.ts` (Sprint 4)
- `getComplianceMatrix(workspaceDir: string): Promise<ComplianceMatrix>`
- `checkComponentCoverage(componentRepoPath: string, interfaceRepoPath: string, declaredRoles: string[]): Promise<CoverageResult>`
- `computeNeedsRevalidation(interfaceReqId: string, roles: string[], workspaceDir: string): Promise<string[]>` — retourne les IDs de liens à marquer.

### 2.3 IPC handlers (`apps/desktop/src/main/ipc/index.ts`)

Nouveaux canaux à ajouter :

```
workspace:detect              (dir: string) → 'workspace' | 'repo' | 'unknown'
workspace:init                (dir: string, rootRepoUrl: string) → void
workspace:open                (dir: string) → WorkspaceOpenResult
workspace:set-mount-override  (workspaceDir: string, override: MountOverride) → void
workspace:get-tree            (workspaceDir: string) → WorkspaceTree
workspace:rebuild-tree        (workspaceDir: string) → WorkspaceTree
workspace:update-pin          (workspaceDir: string, repoUrl: string, newPin: string) → void

polenta-repo:get              (repoPath: string) → PolentaRepoManifest | null
polenta-repo:save             (repoPath: string, manifest: PolentaRepoManifest) → void

interface:compliance-matrix   (workspaceDir: string) → ComplianceMatrix
interface:coverage            (componentPath: string, interfacePath: string, roles: string[]) → CoverageResult
```

Canaux à **supprimer** :
- `sync:submodule-tags` (plus de submodules)

Canaux à **modifier** :
- `baseline:create` : supprimer la boucle sur les composants submodule pour la création de tags.
- `schema:save` : ne plus déclencher `syncSubmodules`.

### 2.4 Renderer (`apps/desktop/src/renderer/`)

#### `routes/index.tsx` (WorkspacePage)
La page d'accueil actuelle gère "Créer un projet" / "Cloner" / "Ouvrir local". Elle doit être étendue :
- **Nouveau formulaire** "Créer un workspace" : sélection de répertoire + URL repo root (ou chemin local).
- **Nouveau formulaire** "Ouvrir un workspace" : sélection de répertoire → détection du marqueur `.polenta/workspace.yaml`.
- Les formulaires existants (créer/cloner/ouvrir un projet simple) sont conservés pour compatibilité CA-6.

#### `routes/schema.tsx` (SchemaEditorPage)
- **Supprimer** les champs URL et branche de `EditableNode` et `ComposantRow`.
- **Supprimer** `BranchInput`, la logique de fetch GitHub branches, `parseGithubRepo`.
- `emptyNode()` : supprimer `url: ''` et `branch: ''`.
- `nodeToEditable()` / `editableToNode()` : supprimer la gestion de `url`/`branch`.
- Dans `ElementsTab` : supprimer le badge `⎇ submodule`.

#### Nouvelle route : `routes/workspace.tsx`
Vue dédiée au workspace plat :
- Arbre des repos (workspace tree) — chaque nœud est un repo cloné.
- Badge visuel distinct pour les repos interface (`implements` déclaré).
- Indicateur de conflits diamond.
- Action "Mettre à jour le pin" par dépendance.

#### Nouveau composant : `components/DiamondConflictModal.tsx`
Modal bloquant affiché lors d'un conflit de pins pendant le parsing. Formulaire de nommage des deux montages.

#### Nouveau composant : `components/ComplianceMatrix.tsx` (Sprint 4)
Tableau colonnes = composants implémenteurs, lignes = exigences interface groupées par rôle. Cellules `covered` / `missing` / `validated` / grisées.

#### `routes/components.tsx`
Doit être mis à jour pour lire les composants depuis le workspace tree (`.polenta/tree.cache.yaml`) plutôt que depuis `schema.nodes[].url`.

### 2.5 `packages/api-client/src/ipc-client.ts`
Ajouter les méthodes correspondant aux nouveaux canaux IPC (workspace:detect, workspace:open, polenta-repo:get, etc.).

### 2.6 `packages/api-client/src/types.ts`
Ajouter les types de retour pour les nouvelles méthodes dans `ApiClient`.

---

## 3. Nouvelles interfaces / types

### `PolentaRepoDependency`
```typescript
interface PolentaRepoDependency {
  name: string      // nom de montage (dossier dans le workspace)
  url: string       // URL git
  pin: string       // commit SHA ou tag
}
```

### `PolentaRepoManifest`
```typescript
interface PolentaRepoManifest {
  dependencies?: PolentaRepoDependency[]
}
```

### `MountOverride`
```typescript
interface MountOverride {
  url: string
  pin: string
  mountAs: string   // nom de montage choisi par l'utilisateur
}
```

### `PolentaWorkspaceConfig`
```typescript
interface PolentaWorkspaceConfig {
  rootRepo?: string         // nom du repo root (dossier dans le workspace)
  mountOverrides?: MountOverride[]
}
```

### `WorkspaceTreeNode`
```typescript
interface WorkspaceTreeNode {
  name: string              // nom de montage
  repoPath: string          // chemin absolu dans le workspace
  url: string
  pin: string
  isInterface: boolean      // true si le repo déclare `roles` dans son schema.yaml
  implements?: { interface: string; version: string; roles: string[] }[]
  children: WorkspaceTreeNode[]   // dépendances directes (arbre logique, pas filesystem)
}
```

### `WorkspaceTree`
```typescript
interface WorkspaceTree {
  rootRepoHeadSha: string    // pour invalider le cache
  generatedAt: string        // ISO date
  nodes: WorkspaceTreeNode[] // liste plate de tous les repos (pas l'arbre)
  logicalTree: WorkspaceTreeNode  // arbre logique avec children
}
```

### `DiamondConflict`
```typescript
interface DiamondConflict {
  url: string
  pins: { pin: string; requiredBy: string[] }[]
}
```

### `WorkspaceOpenResult`
```typescript
type WorkspaceOpenResult =
  | { status: 'ok'; tree: WorkspaceTree }
  | { status: 'diamond-conflict'; conflicts: DiamondConflict[] }
  | { status: 'not-a-workspace' }
  | { status: 'parse-error'; repoName: string; error: string }
```

### Types pour les interfaces (Sprint 4)

Ajout dans `ProjectSchema` :
```typescript
interface RoleDefinition {
  name: string
  label?: string
}

// Dans ProjectSchema :
roles?: RoleDefinition[]   // pour les repos interface

// Dans SystemNode (remplace url/branch) :
// (rien — les composants sont découverts via workspace tree)

// Dans schema.yaml d'un composant implémenteur :
implements?: ImplementsDeclaration[]
```

```typescript
interface ImplementsDeclaration {
  interface: string    // nom de montage dans le workspace
  version: string
  roles: string[]
}
```

### Types `ComplianceMatrix` (Sprint 4)
```typescript
type CellStatus = 'covered' | 'missing' | 'validated' | 'na'

interface ComplianceCell {
  requirementId: string
  componentName: string
  status: CellStatus
  linkId?: string
}

interface ComplianceMatrix {
  interfaceName: string
  requirements: { id: string; title: string; roles: string[]; status: string }[]
  components: { name: string; roles: string[]; repoPath: string }[]
  cells: ComplianceCell[]
}
```

---

## 4. Décisions techniques et alternatives rejetées

### 4.1 Cache dans `.polenta/tree.cache.yaml` (hors repo git)
**Décision** : Le cache est écrit dans `<workspace>/.polenta/tree.cache.yaml`, hors de tout repo git.

**Alternative rejetée** : Stocker le cache dans le repo root (comme l'ancien `tree.yaml`). Rejeté car le cache est local à la machine (chemins absolus) et ne doit pas être versionné.

**Alternative rejetée** : Stocker dans `app.getPath('userData')`. Rejeté car lie le cache à l'utilisateur OS plutôt qu'au répertoire workspace — deux utilisateurs sur la même machine auraient des caches incohérents.

### 4.2 `polenta-repo.yaml` à la racine du repo (pas dans `.polenta/`)
**Décision** : `polenta-repo.yaml` est à la racine du repo, pas dans `.polenta/`.

**Rationale** : Un repo composant sans aucune dépendance n'a pas de `polenta-repo.yaml` du tout. Si on le mettait dans `.polenta/`, il faudrait toujours créer le dossier `.polenta/`. La racine est plus visible et cohérente avec `package.json`, `Cargo.toml`, etc.

### 4.3 Pas de `WorkspaceService` complet remplacé — coexistence pendant la transition
**Décision** : Le `WorkspaceService` existant (`workspace.json` dans userData) est conservé intact pour la liste des projets récents. Les nouvelles fonctionnalités workspace plat sont dans `workspace-tree.service.ts` et `workspace.service.ts` (nouvelles méthodes).

**Rationale** : Évite une migration forcée des utilisateurs existants (CA-6). Un projet mono-repo sans `polenta-repo.yaml` continue de fonctionner exactement comme avant.

### 4.4 DFS avec Set d'URLs pour la détection de cycles
**Décision** : Algorithme DFS standard avec un `Set<string>` d'URLs en cours de visite. Si une URL est rencontrée alors qu'elle est déjà dans le Set → cycle détecté, erreur explicite.

**Alternative rejetée** : Détection par profondeur max. Rejeté car arbitraire et ne couvre pas les cycles longs.

### 4.5 Détection diamond avant tout clone
**Décision** : Le parsing est en deux passes. Passe 1 : collecte récursive de toutes les dépendances (sans cloner). Passe 2 : détection des conflits puis clonage. Si un conflit est détecté, le parsing s'arrête et notifie l'utilisateur avant de cloner quoi que ce soit pour la version en conflit (CA-3).

**Alternative rejetée** : Clone au fur et à mesure et gestion du conflit à la volée. Rejeté car peut laisser le workspace dans un état partiel incohérent.

### 4.6 `resolveComponentRepoPath()` basé sur le workspace, pas le schema
**Décision** : `SchemaService.resolveComponentRepoPath()` doit à terme être remplacé par une lookup dans le workspace tree. Pour la transition, si aucun workspace n'est actif, il retourne `null` (comportement actuel pour les nœuds sans `url`).

**Impact** : Les services qui dépendent de `resolveComponentRepoPath` (`RequirementsService`, `TestsService`) continueront de fonctionner en mode mono-repo. Pour le mode workspace multi-repo, ils devront recevoir le `workspaceDir` et utiliser le tree cache.

### 4.7 Suppression complète de `url`/`branch` dans `SystemNode` — Phase 5
**Décision** : La suppression des champs `url`/`branch` de `SystemNode` (CA-5) est reportée à la Phase 5 (migration). Les Sprints 1–4 conservent ces champs en lecture mais arrêtent de les écrire et de les utiliser pour le clonage. Cela permet une migration douce sans casser les projets existants dès le sprint 1.

**Raison** : `resolveComponentRepoPath()` est utilisé dans plusieurs services. Supprimer `url` avant d'avoir le workspace tree opérationnel crée une régression immédiate.

---

## 5. Points ouverts (UI-1, UI-2 de la spec)

### UI-1 — Wizard création de workspace
**Décision retenue** : Extension de la page d'accueil existante (`routes/index.tsx`) avec un troisième formulaire "Créer un workspace". Pas de modal séparé pour le sprint 1 — le formulaire inline est suffisant pour valider le flow.

La progression du clonage est affichée inline via un state `progress: { phase: string; percent: number } | null`. Les erreurs réseau sont affichées sous le bouton submit.

### UI-2 — Prompt nommage lors d'un conflit de pins
**Décision retenue** : Modal bloquant (`DiamondConflictModal`) qui s'affiche quand `workspace:open` retourne `status: 'diamond-conflict'`. Il présente chaque conflit avec les deux chemins et les deux pins, et demande un nom de montage pour chaque version. Le parsing est relancé après confirmation.

---

## 6. Migration depuis l'ancien modèle (Phase 5)

Un outil CLI `scripts/migrate-workspace.ts` sera fourni :
1. Lit `schema.yaml` du repo root.
2. Pour chaque `node` avec `url` : génère une entrée dans `polenta-repo.yaml`.
3. Supprime `url` et `branch` des nœuds dans `schema.yaml`.
4. Écrit `polenta-repo.yaml` à la racine du repo.
5. Supprime `.gitmodules`.

Aucune donnée de traçabilité n'est perdue : les `objectTypeRef` cross-composant continuent de fonctionner car les noms de nœuds sont préservés.

---

## 7. Impact sur les services existants

| Service | Impact |
|---|---|
| `SchemaService` | Suppression méthodes submodule, `save()` simplifié |
| `WorkspaceService` | Nouvelles méthodes addées, existant conservé |
| `RequirementsService` | Doit recevoir `workspaceDir` optionnel pour cross-repo (Sprint 3) |
| `TestsService` | Idem |
| `TraceabilityService` | Doit traverser plusieurs repos workspace (Sprint 3) |
| `BaselineService` | Adapté pour créer des tags multi-repo via workspace tree |
| `SyncService` | Aucun impact |

---

## 8. Arbre de fichiers créés / modifiés

```
packages/types/src/
  schema.ts                     modifié  (SystemNode sans url/branch ; RoleDefinition ; ImplementsDeclaration)
  workspace.ts                  modifié  (WorkspaceProject conservé, ajout PolentaWorkspaceConfig)
  polenta-repo.ts               NOUVEAU
  polenta-workspace.ts          NOUVEAU

apps/desktop/src/main/services/
  schema.service.ts             modifié  (suppression méthodes submodule)
  workspace.service.ts          modifié  (nouvelles méthodes detect/init/open)
  polenta-repo.service.ts       NOUVEAU
  workspace-tree.service.ts     NOUVEAU
  interface-compliance.service.ts  NOUVEAU (Sprint 4)

apps/desktop/src/main/ipc/
  index.ts                      modifié  (nouveaux canaux workspace/polenta-repo/interface)

apps/desktop/src/renderer/
  routes/index.tsx              modifié  (formulaire workspace)
  routes/schema.tsx             modifié  (suppression URL/branche)
  routes/workspace.tsx          NOUVEAU
  components/DiamondConflictModal.tsx  NOUVEAU
  components/ComplianceMatrix.tsx      NOUVEAU (Sprint 4)

packages/api-client/src/
  ipc-client.ts                 modifié  (nouveaux canaux)
  types.ts                      modifié  (nouveaux types ApiClient)

scripts/
  migrate-workspace.ts          NOUVEAU (Phase 5)
```

---

## 9. Découpage en sprints

La feature est trop grande pour un seul sprint. Découpage en 4 sprints :

### Sprint 1 — Workspace plat : marqueur, détection, UI de base (UC-1, UC-2, CA-1, CA-6)

**Périmètre** :
- Nouveaux types : `PolentaRepoDependency`, `PolentaRepoManifest`, `MountOverride`, `PolentaWorkspaceConfig`, `WorkspaceOpenResult` (état partiel : pas de `diamond-conflict` encore).
- `PolentaRepoService` : lecture/écriture de `polenta-repo.yaml`.
- `WorkspaceService` : méthodes `detectWorkspace()`, `initWorkspace()`.
- `workspace.service.ts` : nouvelle méthode `openWorkspace()` — lecture du `workspace.yaml`, pas encore de parsing récursif complet (juste retourne les repos présents sur disque).
- IPC : `workspace:detect`, `workspace:init`, `workspace:open` (version simple).
- UI `routes/index.tsx` : formulaire "Créer un workspace" et "Ouvrir un workspace".
- `routes/schema.tsx` : suppression des champs URL/branche (CA-5 partiel — champs UI supprimés, types conservés pour compatibilité).
- Zéro régression sur les projets mono-repo existants.

**Critères de validation Sprint 1** : CA-1 (marqueur), CA-6 (mono-repo inchangé), CA-5 partiel (UI).

### Sprint 2 — Parsing récursif et clonage automatique (UC-3, UC-4, CA-2, CA-3, CA-4)

**Périmètre** :
- `WorkspaceTreeService` : algorithme DFS complet, détection de cycle, détection diamond, écriture cache.
- `WorkspaceOpenResult` : états `diamond-conflict` et `parse-error`.
- Clonage automatique des dépendances manquantes (via `SyncService.clone()`).
- Cache invalidation sur HEAD change.
- IPC : `workspace:get-tree`, `workspace:rebuild-tree`, `workspace:set-mount-override`.
- UI : `DiamondConflictModal`, vue workspace tree (`routes/workspace.tsx` basique — liste des repos).
- `WorkspaceService.updatePin()` : met à jour `polenta-repo.yaml` et régénère le cache.

**Critères de validation Sprint 2** : CA-2, CA-3, CA-4.

### Sprint 3 — Migration des services core (CA-5 complet, CA-6 complet)

**Périmètre** :
- Suppression complète de `url`/`branch` dans `SystemNode` (côté types et schema service).
- `SchemaService` : suppression de `syncSubmodules`, `buildGitmodules`, `cloneSubmodule`, `removeSubmodule`, `writeGitmodules`.
- `SchemaService.resolveComponentRepoPath()` : basé sur workspace tree.
- `RequirementsService`, `TestsService` : acceptent `workspaceDir` optionnel pour la résolution cross-repo.
- `TraceabilityService` : traversée multi-repos via workspace tree.
- `BaselineService` : tags multi-repos via workspace tree (remplace la boucle submodule dans `baseline:create`).
- Suppression IPC `sync:submodule-tags`.
- Outil de migration `scripts/migrate-workspace.ts`.

**Critères de validation Sprint 3** : CA-5 complet, CA-6 complet.

### Sprint 4 — Interfaces versionnées et matrice de conformité (UC-6, CA-7, CA-8, CA-9, CA-10)

**Périmètre** :
- Types `RoleDefinition`, `ImplementsDeclaration` dans `schema.ts`.
- `InterfaceComplianceService` : couverture par rôle, matrice, `needsRevalidation`.
- IPC : `interface:compliance-matrix`, `interface:coverage`.
- UI : `ComplianceMatrix` composant, lien depuis workspace view.
- `routes/schema.tsx` : UI pour éditer `roles` (sur un repo interface) et `implements` (sur un repo composant).
- Badge visuel repo interface dans workspace tree.
- Notification `needsRevalidation` sur modification d'exigence interface.

**Critères de validation Sprint 4** : CA-7, CA-8, CA-9, CA-10.
