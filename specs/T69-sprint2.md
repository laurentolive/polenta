# T69-sprint2 — Parsing récursif et gestion diamond

## Fichiers modifiés / créés

| Fichier | Nature | Raison |
|---|---|---|
| `apps/desktop/src/main/services/workspace-tree.service.ts` | NOUVEAU | `WorkspaceTreeService` : DFS, détection cycle, détection diamond, cache, clonage |
| `apps/desktop/src/main/services/workspace.service.ts` | modifié | `openWorkspace()` délègue à `WorkspaceTreeService` ; ajout `getCacheTree()`, `rebuildTree()`, `setMountOverride()` |
| `apps/desktop/src/main/container.ts` | modifié | Instanciation `WorkspaceTreeService`, injection dans `WorkspaceService` et `registerIpcHandlers` |
| `apps/desktop/src/main/ipc/index.ts` | modifié | `WorkspaceTreeService` dans `Container` ; canaux `workspace:get-tree`, `workspace:rebuild-tree`, `workspace:set-mount-override` |
| `packages/api-client/src/types.ts` | modifié | Import `WorkspaceTree`, `MountOverride` ; méthodes `getTree`, `rebuildTree`, `setMountOverride` dans `ApiClient.workspace` |
| `packages/api-client/src/ipc-client.ts` | modifié | Câblage des 3 nouveaux canaux IPC |
| `apps/desktop/src/renderer/components/DiamondConflictModal.tsx` | NOUVEAU | Modal bloquant pour résolution diamond (formulaire de nommage) |
| `apps/desktop/src/renderer/routes/workspace.tsx` | NOUVEAU | Vue workspace : arbre logique + liste plate, rebuild, gestion diamond |
| `apps/desktop/src/renderer/routeTree.gen.ts` | modifié | Enregistrement de la route `/workspace` |
| `apps/desktop/src/renderer/routes/index.tsx` | modifié | Navigation vers `/workspace?dir=…` après create/open (remplace les `alert()`) |

---

## Comportement implémenté

### CA-2 — Parsing récursif et cache

- `WorkspaceTreeService.buildTree()` effectue un DFS complet depuis le repo root.
- Pour chaque dépendance déclarée dans `polenta-repo.yaml` :
  - Si même URL, même pin, déjà cloné au bon commit → skip (instance partagée).
  - Si absent → clone via `SyncService.clone()` + checkout du pin si c'est un SHA.
  - Si même URL, pin différent → conflit diamond (détecté en passe 2).
- `isCacheValid()` compare le HEAD SHA du repo root avec `rootRepoHeadSha` dans le cache.
- Si le cache est invalide ou absent, `buildTree()` est appelé et le nouveau cache est écrit.
- `WorkspaceOpenResult` supporte maintenant tous les états : `ok`, `not-a-workspace`, `diamond-conflict`, `parse-error`.

### CA-3 — Détection diamond avant tout clone

- L'algorithme est en deux passes :
  - **Passe 1** : collecte récursive des dépendances sans cloner (DFS). Les repos déjà présents sur disque sont parcourus récursivement ; les absents sont ajoutés au graphe sans clone.
  - **Passe 2** : groupement des nœuds du graphe par URL. Si une URL apparaît avec deux pins différents → `DiamondConflict` retourné avant tout clone.
- Le clonage ne démarre qu'après validation de l'absence de conflit.

### CA-4 — Coexistence (Option B)

- `WorkspaceService.setMountOverride(workspaceDir, override)` écrit dans `.polenta/workspace.yaml` la section `mountOverrides`.
- IPC `workspace:set-mount-override` expose cette méthode au renderer.
- `DiamondConflictModal` affiche les conflits, collecte les noms de montage, appelle `setMountOverride` pour chaque override puis relance `openWorkspace`.
- Lors du prochain `buildTree`, les overrides sont lus depuis `workspace.yaml` et appliqués aux noms de montage.

### Détection de cycles

- `dfsCollect` maintient un `Set<string>` des URLs en cours de visite (stack DFS).
- Si une URL déjà dans le set est rencontrée → `{ status: 'cycle', cycle: string[] }` retourné.
- Converti en `parse-error` avec message explicite `"Cycle détecté : A → B → A"` dans `openWorkspace`.

### Nouveaux IPC channels

| Canal | Implémentation |
|---|---|
| `workspace:get-tree` | `WorkspaceService.getCacheTree()` — retourne le cache sans rebuild |
| `workspace:rebuild-tree` | `WorkspaceService.rebuildTree()` — supprime le cache et relance `openWorkspace` |
| `workspace:set-mount-override` | `WorkspaceService.setMountOverride()` — écrit un override dans `workspace.yaml` |

### Route `/workspace`

- Accès par `navigate({ to: '/workspace', search: { dir: '<chemin>' } })`.
- Affiche l'arbre logique (vue "Arbre") et la liste plate des repos (vue "Liste").
- Bouton "Reconstruire" → `workspace:rebuild-tree`.
- Si `diamond-conflict` → `DiamondConflictModal` s'affiche ; après résolution, le parsing est relancé.
- Affiche cache info (date, SHA root, nombre de repos).

---

## Divergences par rapport au design

1. **`WorkspaceTreeService` injecté optionnellement dans `WorkspaceService`** : pour préserver la compatibilité avec les tests unitaires existants, `workspaceTreeService` est un paramètre optionnel. En production (via `container.ts`), il est toujours injecté.

2. **Clonage en passe 2 uniquement si pas de conflit** : conforme au design §4.5. Si un clone échoue (réseau, pin introuvable), une `parse-error` est retournée non-bloquante — le workspace partiel reste utilisable.

3. **`isInterface` non peuplé en Sprint 2** : `WorkspaceTreeNode.isInterface` est toujours `false` en Sprint 2. Il sera peuplé en Sprint 4 lors de l'implémentation des interfaces versionnées (lecture du champ `roles` dans `schema.yaml`).

4. **Recursion sur repos absents du disque non effectuée** : si une dépendance n'est pas encore clonée, la récursion dans son `polenta-repo.yaml` est sautée en passe 1 (impossible de lire le fichier). Elle sera effectuée lors du prochain appel après clonage. Ce comportement est cohérent avec les UCs — le clonage se fait en fin de passe 2, la passe 1 suivante (sur rebuild) sera complète.

---

## Comment tester manuellement

### Test CA-2 — Workspace simple (repo root sans dépendances)

1. Créer un répertoire `~/dev/workspace1/`.
2. Avoir un repo git dans `~/dev/workspace1/product-root/` (sans `polenta-repo.yaml`).
3. Créer un workspace (`Créer un workspace` dans la page d'accueil) en pointant sur ce répertoire.
4. Vérifier : navigation vers `/workspace?dir=...`, affiche 1 repo dans la liste plate.
5. Vérifier : `~/dev/workspace1/.polenta/tree.cache.yaml` créé sur disque.
6. Rouvrir le workspace (`Ouvrir un workspace`) → cache lu directement (< 500 ms, aucun réseau).

### Test CA-2 — Cache invalidation

1. Faire un nouveau commit dans `product-root/`.
2. Ouvrir le workspace → parsing récursif relancé (HEAD SHA différent du cache).

### Test CA-3 — Détection diamond

1. Créer deux repos `comp-a/` et `comp-b/` dans le workspace.
2. `product-root/polenta-repo.yaml` déclare comp-a et comp-b.
3. `comp-a/polenta-repo.yaml` déclare `iface-can @ pin-v1`.
4. `comp-b/polenta-repo.yaml` déclare `iface-can @ pin-v2` (pin différent).
5. Ouvrir le workspace : `DiamondConflictModal` s'affiche listant le conflit.
6. Vérifier : `iface-can` n'est pas encore cloné.

### Test CA-4 — Résolution diamond (Option B)

1. Suite du test CA-3 : saisir `can-bus-v1` pour pin-v1 et `can-bus-v2` pour pin-v2.
2. Confirmer → `workspace.yaml` mis à jour, parsing relancé.
3. Vérifier : deux répertoires `can-bus-v1/` et `can-bus-v2/` créés dans le workspace.
4. `tree.cache.yaml` contient deux nœuds distincts avec les noms configurés.

### Test via DevTools (nouveaux canaux IPC)

```js
// Lire le cache courant
await window.polenta.invoke('workspace:get-tree', '/chemin/vers/workspace')
// → WorkspaceTree | null

// Forcer un rebuild
await window.polenta.invoke('workspace:rebuild-tree', '/chemin/vers/workspace')
// → WorkspaceOpenResult

// Définir un mount-override
await window.polenta.invoke('workspace:set-mount-override', '/chemin/vers/workspace', {
  url: 'git@github.com:org/iface-can.git',
  pin: 'abc123',
  mountAs: 'can-bus-next'
})
```

### Test CA-6 — Aucune régression mono-repo

1. Ouvrir un projet mono-repo existant depuis la liste "Récents".
2. Naviguer dans les exigences, tests, campagnes.
3. Vérifier : aucun message d'erreur, comportement identique à avant.
