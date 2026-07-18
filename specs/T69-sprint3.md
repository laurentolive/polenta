# T69-sprint3 — Migration des services core (CA-5 complet, CA-6 complet)

## Fichiers modifiés / créés

| Fichier | Nature | Raison |
|---|---|---|
| `apps/desktop/src/main/services/requirements.service.ts` | modifié | `create()`, `update()`, `openDraft()`, `transition()` acceptent `workspaceDir?: string` ; transmis à `resolveComponentRepoPath()` |
| `apps/desktop/src/main/services/tests.service.ts` | modifié | `create()`, `update()`, `execute()` acceptent `workspaceDir?: string` ; transmis à `resolveComponentRepoPath()` |
| `apps/desktop/src/main/services/traceability.service.ts` | modifié | Injection de `WorkspaceTreeService` ; ajout `resolveRepoPaths()` et `findRequirementById()` ; `getMatrix()`, `getMissingLinks()`, `getImpactReport()`, `generateTestPlan()`, `exportCsv()` agrègent requirements/tests/liens depuis tous les repos du workspace |
| `apps/desktop/src/main/container.ts` | modifié | Injection de `workspaceTree` dans `TraceabilityService` |
| `apps/desktop/src/main/ipc/index.ts` | modifié | `requirements:create/update/open-draft/transition`, `tests:create/update/execute` : ajout `workspaceDir?` ; `traceability:matrix/missing-links/impact/test-plan/export-csv` : ajout `workspaceDir?` ; `baseline:create` : ajout `workspaceDir?` + tagging multi-repos via workspace tree |
| `packages/api-client/src/types.ts` | modifié | Signatures mises à jour pour `requirements.*`, `tests.*`, `traceability.*`, `baseline.create` avec `workspaceDir?: string` |
| `packages/api-client/src/ipc-client.ts` | modifié | Câblage des paramètres `workspaceDir` dans tous les canaux concernés |
| `scripts/migrate-workspace.ts` | existant | Outil de migration présent depuis Sprint 2 (déplacé depuis la racine vers `scripts/`) |

---

## Comportement implémenté

### CA-5 complet — Types et services sans url/branch

- `SystemNode` dans `packages/types/src/schema.ts` ne comporte plus `url` ni `branch` (supprimé en Sprint 1).
- `SchemaService` ne contient plus `syncSubmodules()`, `buildGitmodules()`, `cloneSubmodule()`, `removeSubmodule()`, `writeGitmodules()` (supprimés en Sprint 1).
- `SchemaService.resolveComponentRepoPath()` utilise le workspace tree cache (implémenté en Sprint 2).
- L'IPC `sync:submodule-tags` est supprimé (Sprint 1, commentaire de confirmation dans `ipc/index.ts`).

### RequirementsService — workspaceDir propagation

- `create(repoPath, dto, workspaceDir?)` : passe `workspaceDir` à `resolveComponentRepoPath()` pour résoudre le repo cible d'un composant dans le workspace plat.
- `update(repoPath, id, dto, workspaceDir?)` : idem.
- `openDraft(repoPath, id, targetStatus, workspaceDir?)` : idem.
- `transition(repoPath, id, dto, workspaceDir?)` : idem.
- En mode mono-repo (pas de `workspaceDir`), le comportement est identique à avant.

### TestsService — workspaceDir propagation

- `create(repoPath, dto, workspaceDir?)` : passe `workspaceDir` à `resolveComponentRepoPath()`.
- `update(repoPath, id, dto, workspaceDir?)` : idem.
- `execute(repoPath, tcId, dto, workspaceDir?)` : idem.

### TraceabilityService — multi-repos via workspace tree

- `WorkspaceTreeService` est injecté dans `TraceabilityService` (optionnel, pour la compatibilité tests unitaires).
- `resolveRepoPaths(repoPath, workspaceDir?)` : retourne la liste des chemins repos à interroger. En mode mono-repo, retourne `[repoPath]`. En mode workspace, lit `tree.cache.yaml` et retourne `[repoPath, ...nodeRepoPaths]`.
- `findRequirementById(id, repoPaths)` : cherche un requirement par ID dans tous les repos (premier trouvé).
- `getMatrix(repoPath, filters, workspaceDir?)` : agrège requirements, tests, runs et liens de tous les repos du workspace.
- `getMissingLinks(repoPath, workspaceDir?)` : agrège depuis tous les repos ; utilise `findRequirementById` pour les lookups cross-repo dans les items de revalidation.
- `getImpactReport(repoPath, reqId, depth, workspaceDir?)` : recherche l'exigence trigger et les runs dans tous les repos ; parcours BFS cross-repo.
- `generateTestPlan(repoPath, dto, workspaceDir?)` : agrège requirements, tests et liens depuis tous les repos.
- `exportCsv(repoPath, filters, workspaceDir?)` : délègue à `getMatrix` avec `workspaceDir`.

### BaselineService — tagging multi-repos

- `baseline:create(repoPath, dto, workspaceDir?)` : si `workspaceDir` est fourni, lit le `tree.cache.yaml` du workspace et crée le même tag git sur chaque repo composant. Les erreurs de tagging d'un composant sont non-bloquantes (warning + continuation).

### Outil de migration

- `scripts/migrate-workspace.ts` : script autonome (tsx) qui lit `schema.yaml`, génère `polenta-repo.yaml` à partir des nœuds `url`, supprime les champs `url`/`branch` de `schema.yaml`, et supprime `.gitmodules`. Usage : `tsx scripts/migrate-workspace.ts <repo-path>`.

---

## Divergences par rapport au design

1. **`TraceabilityService` — workspaceDir non propagé aux IPC d'acknowledge** : `acknowledgeImpact()` n'a pas de `workspaceDir` car l'accusé d'impact est toujours écrit dans le repo root (`impact-acks/`). L'exigence trigger est cherchée via `findRequirementById` si besoin dans les futures évolutions.

2. **Tagging multi-repos dans `baseline:create` : non-bloquant** : si le tagging échoue sur un composant (réseau, droits, pin non valide), un warning est loggé mais la baseline est quand même créée dans le repo root. Ce comportement est cohérent avec la spec "erreur non bloquante" pour les opérations réseau.

3. **`TraceabilityService.getImpactReport` : acks toujours dans le repo root** : les fichiers `impact-acks/` ne sont lus que dans `repoPath` (repo root). Cross-repo ack tracking est hors scope Sprint 3.

4. **`scripts/migrate-workspace.ts` : pin = branch name** : faute de SHA disponible dans `schema.yaml`, le `pin` est initialisé au nom de la branche (ex: `"main"`). L'utilisateur doit le remplacer par un SHA reproductible. Note inscrite dans la sortie de l'outil.

---

## Comment tester manuellement

### Test CA-5 — Outil de migration

1. Prendre un repo avec un `schema.yaml` comportant des nœuds avec `url` (format pré-T69).
2. Lancer : `tsx scripts/migrate-workspace.ts /chemin/vers/repo`
3. Vérifier :
   - `polenta-repo.yaml` créé à la racine avec les dépendances issues des nœuds url.
   - `schema.yaml` mis à jour : champs `url` et `branch` supprimés des nœuds.
   - `.gitmodules` supprimé s'il existait.
   - Les noms de nœuds (`name`) sont préservés comme `name` dans `polenta-repo.yaml`.
4. Ouvrir le projet dans Polenta après migration : aucun message d'erreur.

### Test CA-6 — Mono-repo : aucune régression

1. Ouvrir un projet mono-repo existant depuis la liste "Récents".
2. Créer une exigence (POST `requirements:create` sans `workspaceDir`).
3. Créer un test (POST `tests:create` sans `workspaceDir`).
4. Consulter la matrice de traçabilité (`traceability:matrix` sans `workspaceDir`).
5. Créer une baseline (`baseline:create` sans `workspaceDir`).
6. Vérifier : comportement identique à avant Sprint 3 dans tous ces flows.

### Test workspace multi-repos — Requirements cross-composant

1. Ouvrir un workspace avec `product-root` (root) + `comp-a` (composant).
2. Dans l'UI du composant `comp-a`, créer une exigence en passant `workspaceDir` dans l'appel IPC.
3. Vérifier : l'exigence est créée dans `comp-a/requirements/` et non dans `product-root/requirements/`.

### Test workspace multi-repos — Traceability matrix agrégée

1. Ouvrir un workspace avec `product-root` + `comp-a`.
2. Chaque repo a des exigences et tests.
3. Appeler `traceability:matrix` avec `workspaceDir` fourni.
4. Vérifier : la matrice inclut les exigences et tests des deux repos.

### Test workspace multi-repos — Baseline multi-repos

1. Ouvrir un workspace avec `product-root` + `comp-a`.
2. Créer une baseline avec `baseline:create(repoPath, dto, workspaceDir)`.
3. Vérifier : le tag git est créé sur `product-root` ET sur `comp-a`.

### Test via DevTools

```js
// Créer un requirement dans un composant du workspace
await window.polenta.invoke(
  'requirements:create',
  '/workspace/product-root',         // repoPath (root du projet)
  { objectTypeRef: 'comp-a::exigence-fw', title: 'Test cross-repo', fields: {} },
  '/workspace'                       // workspaceDir (optionnel)
)
// → Requirement créé dans comp-a/requirements/ selon le workspace tree

// Matrice de traçabilité agrégée multi-repos
await window.polenta.invoke(
  'traceability:matrix',
  '/workspace/product-root',
  {},
  '/workspace'
)
// → Matrice incluant les exigences et tests de product-root ET des composants du workspace
```
