# T69-sprint1 — Workspace plat : marqueur, détection, UI de base

## Fichiers modifiés

| Fichier | Nature | Raison |
|---|---|---|
| `TICKETS.md` | modifié | T69 passé en "coding sprint 1" |
| `packages/types/src/polenta-repo.ts` | NOUVEAU | Types `PolentaRepoDependency`, `PolentaRepoManifest` |
| `packages/types/src/polenta-workspace.ts` | NOUVEAU | Types `MountOverride`, `PolentaWorkspaceConfig`, `WorkspaceTreeNode`, `WorkspaceTree`, `DiamondConflict`, `WorkspaceOpenResult` |
| `packages/types/src/index.ts` | modifié | Export des deux nouveaux fichiers de types |
| `apps/desktop/src/main/services/polenta-repo.service.ts` | NOUVEAU | `PolentaRepoService` : `readManifest()`, `writeManifest()` |
| `apps/desktop/src/main/services/workspace.service.ts` | modifié | Ajout `detectWorkspace()`, `initWorkspace()`, `openWorkspace()`, `readCacheTree()`, `writeCacheTree()` |
| `apps/desktop/src/main/ipc/index.ts` | modifié | Ajout `PolentaRepoService` dans `Container`, nouveaux canaux `workspace:detect`, `workspace:init`, `workspace:open`, `polenta-repo:get`, `polenta-repo:save` |
| `apps/desktop/src/main/container.ts` | modifié | Instanciation de `PolentaRepoService`, injection dans `registerIpcHandlers` |
| `packages/api-client/src/types.ts` | modifié | Import `PolentaRepoManifest`, `WorkspaceOpenResult` ; ajout `workspace.detect/init/open` et `polentaRepo.get/save` dans `ApiClient` |
| `packages/api-client/src/ipc-client.ts` | modifié | Câblage des 5 nouveaux canaux IPC |
| `apps/desktop/src/renderer/routes/index.tsx` | modifié | Formulaires "Créer un workspace" et "Ouvrir un workspace" |
| `apps/desktop/src/renderer/routes/schema.tsx` | modifié | Suppression URL/branche de `EditableNode`, `emptyNode()`, `nodeToEditable()`, `editableToNode()`, `ComposantRow`, en-têtes tableau ; suppression `BranchInput`, `parseGithubRepo` ; suppression badge "⎇ submodule" |

---

## Comportement implémenté

### CA-1 — Marqueur workspace

- `WorkspaceService.detectWorkspace(dir)` retourne `'workspace'` si `<dir>/.polenta/workspace.yaml` existe, `'repo'` si c'est un dépôt git, `'unknown'` sinon.
- `WorkspaceService.initWorkspace(workspaceDir, rootRepoPath)` crée `<workspaceDir>/.polenta/workspace.yaml` avec `rootRepo: <basename(rootRepoPath)>`. Ne modifie aucun dépôt git.
- `WorkspaceService.openWorkspace(workspaceDir)` retourne `{ status: 'not-a-workspace' }` si le marqueur est absent, ou `{ status: 'ok', tree: WorkspaceTree }` sinon.

### Cache workspace (CA-2 partiel — Sprint 1)

- À l'ouverture, le cache `.polenta/tree.cache.yaml` est lu. Si le SHA HEAD du repo root correspond au cache existant, le cache est retourné directement.
- Si le cache est absent ou périmé (SHA HEAD différent), un nouvel arbre minimal est construit (uniquement le repo root, sans parsing récursif — Sprint 2) et écrit dans le cache.

### CA-5 partiel — Suppression URL/branche dans l'UI

- L'interface `EditableNode` ne contient plus `url` ni `branch`.
- La fonction `editableToNode()` ne génère plus `url`/`branch` dans le `SystemNode` serialisé.
- La sauvegarde du schéma ne déclenche plus `syncSubmodules()` via ce chemin (les champs url ne sont plus écrits depuis l'UI). Nota : `syncSubmodules()` reste dans le code pour la compatibilité des projets existants qui auraient encore des `nodes[].url` en base ; il sera supprimé en Sprint 3 (CA-5 complet).
- Les colonnes "URL dépôt" et "Branche d'intégration" ont disparu du tableau Composants.
- Le badge "⎇ submodule" a disparu de la vue Éléments.
- Le composant `BranchInput` et la fonction `parseGithubRepo` ont été supprimés.

### IPC nouveaux canaux

- `workspace:detect` → `WorkspaceService.detectWorkspace()`
- `workspace:init` → `WorkspaceService.initWorkspace()`
- `workspace:open` → `WorkspaceService.openWorkspace()`
- `polenta-repo:get` → `PolentaRepoService.readManifest()`
- `polenta-repo:save` → `PolentaRepoService.writeManifest()`

### PolentaRepoService

- `readManifest(repoPath)` : retourne `null` si `polenta-repo.yaml` est absent (repo feuille), throws si YAML invalide.
- `writeManifest(repoPath, manifest)` : écrit `polenta-repo.yaml` à la racine du repo.

---

## Divergences par rapport au design

1. **`openWorkspace()` ne fait pas de parsing récursif** : selon le design, `openWorkspace()` devrait lancer `WorkspaceTreeService.buildTree()`. Ce service est défini dans le périmètre Sprint 2. Sprint 1 retourne un arbre minimal (root seulement). Comportement conforme au périmètre Sprint 1 tel que décrit dans `T69-design.md §9`.

2. **Navigation workspace Sprint 1** : la route `routes/workspace.tsx` n'existe pas encore (Sprint 2). Les handlers `handleCreateWorkspace` et `handleOpenWorkspace` affichent un `alert()` de confirmation plutôt que de naviguer. Ce comportement sera remplacé en Sprint 2 par une navigation vers la vue workspace dédiée.

3. **Suppression `syncSubmodules` reportée** : `SchemaService.syncSubmodules()` et les méthodes associées (`buildGitmodules`, `cloneSubmodule`, etc.) sont conservées jusqu'au Sprint 3 (CA-5 complet, migration). Décision alignée avec le design §4.7 : "La suppression des champs `url`/`branch` de `SystemNode` (CA-5) est reportée à la Phase 5".

---

## Comment tester manuellement

### Test CA-1 — Créer un workspace

1. Lancer Polenta.
2. Sur la WorkspacePage, faire défiler jusqu'à la section "Workspace multi-repos".
3. Dans "Créer un workspace" :
   - Sélectionner un répertoire vide comme workspace (ex: `~/dev/`)
   - Sélectionner un dépôt git existant comme repo root (ex: `~/dev/product-v1/`)
   - Cliquer "Créer le workspace"
4. Vérifier : un `alert` confirme la création, et `<workspace>/.polenta/workspace.yaml` est créé sur disque.

### Test CA-1 — Ouvrir un workspace non valide

1. Dans "Ouvrir un workspace", sélectionner un répertoire ordinaire (sans `.polenta/workspace.yaml`).
2. Vérifier : le message d'erreur "Ce répertoire n'est pas un workspace Polenta. Créez-en un nouveau." s'affiche.

### Test CA-1 — Ouvrir un workspace existant

1. Après création (test précédent), dans "Ouvrir un workspace", sélectionner le même répertoire.
2. Vérifier : un `alert` affiche le nombre de repos trouvés (1 — le root seulement en Sprint 1).

### Test CA-5 partiel — UI Schéma sans URL/branche

1. Ouvrir un projet existant → Modèle de données → onglet "Composants".
2. Vérifier : le tableau n'a que 3 colonnes (Nom, Label, Description + actions) — plus de "URL dépôt" ni "Branche d'intégration".
3. Onglet "Éléments" : vérifier l'absence du badge "⎇ submodule" sur les nœuds.
4. Modifier un composant et sauvegarder : vérifier que le `schema.yaml` résultant ne contient pas de champs `url`/`branch` pour les nœuds créés ou modifiés depuis l'UI.

### Test CA-6 — Aucune régression mono-repo

1. Ouvrir un projet mono-repo existant depuis la liste "Récents".
2. Naviguer dans les exigences, tests, campagnes, baselines.
3. Vérifier : aucun message d'erreur, comportement identique à avant le sprint.

### Test polenta-repo:get (via DevTools)

Dans la console DevTools de Polenta :
```js
await window.polenta.invoke('polenta-repo:get', '/chemin/vers/un/repo/sans/manifest')
// → null

// Créer un polenta-repo.yaml minimal, puis :
await window.polenta.invoke('polenta-repo:get', '/chemin/vers/un/repo/avec/manifest')
// → { dependencies: [...] }
```
