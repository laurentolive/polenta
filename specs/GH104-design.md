# GH104 — Design : suppression en cascade d'un composant local ou d'un type

Spec : `specs/GH104.md` (validée). Modèle suivi : GH100 (`TypeRenameService` : aperçu sans écriture,
pré-contrôles tout ou rien, écritures au mieux avec compte rendu, collision de refs `root::`) et
GH20 (`deleteWithTombstone`).

## 1. Vue d'ensemble

```
Corbeille (LocalNodeRow | ElementLeaf | bouton Supprimer de ElementConfigModal)
  └─ requestDelete(repoPath, target)
       └─ api.schema.previewDelete(repoPath, workspaceDir, target)        (aucune écriture)
            └─ SchemaDeleteConfirmModal (comptes, repos, types de lien vidés, erreurs)
                 ├─ errors[] non vide → message, bouton Supprimer désactivé
                 ├─ Annuler → rien
                 └─ Supprimer → api.schema.delete(...) → compte rendu → qc.invalidateQueries()
```

Différence avec GH100 : **le main écrit aussi le schéma**, en dernier. Dans GH100 le renderer
enregistre le schéma puis migre ; ici, enregistrer le schéma d'abord rendrait les objets
invisibles avant leur suppression — en cas d'échec, l'utilisateur n'aurait plus de corbeille pour
réessayer. Schéma en dernier : un échec en cours de route laisse le type visible, la suppression
peut être relancée (elle repart de l'état disque).

Le repo `R` reçu est celui qui **déclare** le nœud / type (`sel.repoPath` / `repoPath` de la
ligne) : pour un type d'un composant en repo séparé, c'est déjà le repo du composant, et ses
objets y vivent (`TestsService.create` résout `targetRepo` vers ce même repo). Le point « écrire
dans le repo du type » de la spec est donc couvert sans `resolveComponentRepoPath`.

## 2. Main process

### 2.1 Types (`packages/types/src/schema.ts`)

```ts
export type SchemaDeleteTarget =
  | { kind: 'node'; nodeName: string }                    // composant local + sous-arbre `children`
  | { kind: 'type'; nodeName: string; typeName: string }  // un type d'un nœud (root compris)

export interface SchemaDeletePlan {
  nodes: string[]        // nœuds supprimés (N + descendants) ; vide pour un type
  types: string[]        // refs `<nœud>::<type>` supprimées (ensemble S)
  objects: { requirement: string[]; test: string[]; campaign: string[] }   // IDs, dans R
  links: { repoPath: string; count: number }[]           // liens supprimés par repo (count > 0)
  linkTypes: { repoPath: string; name: string; emptied: boolean }[]  // types de lien modifiés
  errors: { code: 'NOT_FOUND' | 'READONLY' | 'REPO_MISSING'; detail: string }[]
}

export interface SchemaDeleteResult {
  deleted: string[]                         // IDs supprimés
  links: number
  failed: { id: string; error: string }[]   // id = ID d'objet, ou `<repo>:<chemin>`
}
```

Le type cible est désigné **par son nom**, pas par `typeIndex` (l'index du renderer devient faux si
le schéma a changé entre l'aperçu et la confirmation).

### 2.2 Utilitaires partagés avec GH100 (`services/schema-refs.util.ts`, nouveau)

Extraits de `type-rename.service.ts` (privés aujourd'hui) pour ne pas les dupliquer :

- `dedupeRepos(repoPath, repos)` — ex-`sameRepoDeduped` ;
- `declaresRef(schema, ref)` — ex-`declares` ;
- `mapLinkRefs(schema, fn: (ref) => string | null)` — généralise `retargetLinkRefs` : `null`
  retire la ref. GH100 l'appelle avec `r => r === oldRef ? newRef : r` ;
- `objectIdsOfType(services, repoPath, category, ref)` — ex-`TypeRenameService.objectIds`.

`TypeRenameService` est réécrit sur ces fonctions, sans changement de comportement (ses tests
existants doivent passer tels quels).

### 2.3 `SchemaDeleteService` (`services/schema-delete.service.ts`, nouveau)

Dépendances : `GitService`, `RequirementsService`, `TestsService`, `CampaignsService`,
`RequirementsIndexService` (liens), `TreeService`, `SchemaService`, `RevalidationService`
(`readonlyRepoPaths`), index exigences / tests (invalidation), `resolveRepos` (même fonction que
GH100 : `resolveWorkspaceRepoPaths`).

`plan(repoPath, workspaceDir, target)` / `delete(repoPath, workspaceDir, target)` partagent
`compute()` ; `delete` refait `compute()` (état disque frais) et lève si `errors` non vide.

**compute()**

1. `repos = dedupeRepos(R, resolveRepos(R, workspaceDir))` ; chemin absent → `REPO_MISSING`.
2. Schéma de `R` ; cible introuvable (nœud ou type absent) → `NOT_FOUND`.
3. `READONLY` si : le nœud cible (ou un de ses ancêtres) a `readonly: true` dans le schéma de `R`,
   ou `R ∈ readonlyRepoPaths(repo racine, workspaceDir)` (pin tag / SHA — même règle que
   `ParametersService`, T171). Repo racine : premier repo de l'arbre workspace (à confirmer en
   sprint 1 sur la fixture ; sans `workspaceDir`, seul le flag `readonly` du nœud compte).
4. `S` : `{nodeName}::{typeName}` pour un type ; pour un nœud, tous les types de `N` et de ses
   descendants (`flattenSystemNodes` sur le sous-arbre) ; `nodes` = noms du sous-arbre.
5. Objets : `objectIdsOfType` pour chaque ref de `S`, par catégorie du type.
6. Liens : pour chaque repo, `reloadLinks(repo)` (état disque, pas le cache) ; liens dont
   `sourceId` ou `targetId` ∈ objets supprimés. IDs uniques sur le projet (préfixe unique, règle 10),
   donc pas d'ambiguïté inter-repos.
7. Types de lien : schéma de `R` toujours ; schéma d'un autre repo sauf si un autre repo que `R`
   déclare la même ref (`declaresRef`, collision `root::`, comme GH100). Pour chaque `linkType`
   touché : `emptied = sourceRefs` ou `targetRefs` devient `[]`.

**delete()** — ordre de la spec §4, chaque étape au mieux (erreur → `failed`, on continue) :

1. Objets : exigences / tests → `deleteWithTombstone(git, R, '<dir>/<ID>.yaml', ID)` sous
   `withKeyLock` du fichier objet (même clé que les écritures des services) ; campagnes →
   `CampaignsService.delete` (déjà avec pierre tombale).
2. Dossiers propres aux objets supprimés : `test-runs/<ID>/` (tests), `impact-acks/<ID>/`
   (exigences) → `fsP.rm(recursive)`.
3. Liens : `RequirementsIndexService.deleteLinks(repo, ids)` par repo (verrou `links.yaml`, relecture
   disque, une écriture par repo — existe depuis GH16).
4. Arbres : `TreeService.deleteTypeTree(R, node, type)` (nouveau, à côté de `renameTypeTree`, même
   règle « au mieux, journalisé ») pour chaque ref de `S` ; pour un nœud supprimé, dossier
   `.polenta/trees/<nœud>/` retiré s'il est vide ensuite (`pruneEmptyDirs`).
5. Si une étape 1–3 a échoué : **arrêt** (vérifié avant l'étape 4 : ni arbres ni schémas), liens des objets
   restés conservés (le nœud / type reste visible, la suppression est relançable et ne reprend
   que ce qui reste — cf. `GH104-sprint1.md`). Sinon, schéma de `R` : `removeSystemNode` (nœud) ou retrait du type par nom, puis
   `mapLinkRefs(…, r => S.has(r) ? null : r)` → `SchemaService.save` (validation, cache).
6. Schémas des autres repos retenus en 7. : `mapLinkRefs` → `SchemaService.save`.
7. Invalidation des index exigences / tests de chaque repo touché.

Un type de lien vidé reste dans le schéma (`sourceRefs: []` / `targetRefs: []`) : `isLinkTypeValid`
le masque déjà des éditeurs de liens. **À vérifier en sprint 1** : `SchemaService.save` /
`validateSchema` accepte une liste vide (sinon la sauvegarde échouerait à l'étape 5).

### 2.4 Points « à trancher » de la spec — décisions

| Donnée | Décision | Raison |
|---|---|---|
| `impact-acks/<ID>/` d'une exigence supprimée | **supprimé** (étape 2) | appartient à l'objet, illisible sans lui |
| `impact-analyses/*.yaml` qui citent un ID supprimé | **conservé** | trace d'une analyse passée (comme `history`) ; l'ID reste littéral |
| `reviews/*.yaml` (`objects[].objectId`) | **conservé** | une revue est un enregistrement ; l'écran de revue doit afficher l'objet comme indisponible (scénario D13 — corriger l'écran s'il plante) |
| `needsRevalidation` posé sur d'autres objets par un objet supprimé | **laissé**, aucun nouveau flag posé | la confirmation liste déjà les liens supprimés ; l'utilisateur lève le flag comme aujourd'hui (`revalidation:clear`). Point à valider (cf. §6) |

### 2.5 IPC / preload / API renderer / web

- `schema:preview-delete (repoPath, workspaceDir, target)` → `SchemaDeletePlan`
- `schema:delete (repoPath, workspaceDir, target)` → `SchemaDeleteResult`
- `checkDeleteTarget(channel, target)` dans `ipc/index.ts` (modèle `checkTypeRename`) : `kind`,
  `nodeName` non vide, `typeName` non vide si `kind === 'type'`.
- `schema:delete` ajouté à `GRAPH_WRITE_CHANNELS`.
- `web-server/channel-policy.ts` : les deux canaux dans la liste blanche, arguments chemin `[0, 1]`
  (comme `schema:rename-type`).
- `container.ts` : instanciation (`schemaDelete`) et ajout au type `Container`.

## 3. Renderer

- `SchemaDeleteConfirmModal.tsx` (nouveau, gabarit `TypeRenameConfirmModal`) : titre « Supprimer
  le composant X » / « Supprimer le type X » ; lignes non vides seulement — sous-composants
  (texte T123 actuel), N exigences / tests / campagnes (5 premiers IDs + « … »), N liens et repos
  concernés, types de lien modifiés (et « devient invalide » pour `emptied`) ; rappel « non
  commité, relire le diff git ». Erreurs → affichées, bouton Supprimer désactivé.
- `StructureTab.tsx` :
  - `requestDelete(repoPath, target)` → `previewDelete` → `pendingDelete` ; `confirmDelete()` →
    `api.schema.delete` → `deleteReport` (affiché comme `renameReport`) → `qc.invalidateQueries()`.
  - `handleDeleteLocalComponent`, `handleDeleteElementAt` et `handleDeleteElement` (bouton de la
    modale) passent tous par `requestDelete` — les deux derniers aujourd'hui dupliqués
    (`withObjectTypeAt(…, () => null)`) sont fusionnés.
  - Un élément `isNew` abandonné (`handleCloseElementModal`) garde la suppression directe : rien
    n'est encore sur disque.
  - La corbeille de `LocalNodeRow` / `ElementLeaf` devient un simple bouton (plus de
    `ConfirmDelete` inline : la confirmation est la nouvelle modale, après l'aperçu). Le
    commentaire T123 « le nombre d'éléments réels n'est pas compté ici » est retiré.
  - `hotkeysSuspended` de `ElementConfigModal` inclut `!!pendingDelete`.
- `ElementConfigModal` : `onDelete` n'ouvre plus `ConfirmDelete` mais appelle directement
  `onDelete` (la confirmation vient de `StructureTab`). Vérifier que `ConfirmDelete` reste utilisé
  ailleurs (`objectTypeEditor`, `RolesImplementsFields`) — oui, il est conservé.
- i18n fr/en : `schema.deleteCascade.*` ; `schema.structureTab.deleteComponentCascadeBody_*`
  réutilisé pour la ligne sous-composants.

## 4. Fichiers touchés

| Fichier | Changement |
|---|---|
| `packages/types/src/schema.ts` | `SchemaDeleteTarget`, `SchemaDeletePlan`, `SchemaDeleteResult` |
| `main/services/schema-refs.util.ts` | nouveau — fonctions extraites de GH100 |
| `main/services/type-rename.service.ts` | utilise `schema-refs.util.ts` (refactor sans effet) |
| `main/services/schema-delete.service.ts` | nouveau |
| `main/services/tree.service.ts` | `deleteTypeTree` |
| `main/container.ts`, `main/ipc/index.ts`, `preload`, `renderer/api` | 2 canaux, DI |
| `web-server/channel-policy.ts` | 2 canaux |
| `renderer/components/schema/SchemaDeleteConfirmModal.tsx` | nouveau |
| `renderer/components/schema/StructureTab.tsx` | flux de suppression unifié |
| `renderer/components/schema/ElementConfigModal.tsx` | bouton Supprimer sans `ConfirmDelete` |
| `renderer/i18n/locales/{fr,en}.json` | libellés |
| `specs/SPEC-REQ-requirements.md` §9, `SPEC-ELECTRON-DESKTOP.md` §20, `SPEC-INDEX.md` | règle amendée, onglet Structure |

## 5. Alternatives rejetées

- **Renderer orchestre (schéma d'abord, puis migration, comme GH100)** : un échec laisserait des
  objets invisibles sans moyen de relancer. Rejeté (cf. §1).
- **Une méthode `delete` par service (exigences, tests)** : `SPEC-REQ` §9 interdit la suppression
  individuelle ; l'exposer sur les services inviterait à l'utiliser ailleurs. La suppression
  physique reste confinée à `SchemaDeleteService` (+ `CampaignsService.delete`, existant).
- **`ConfirmDelete` enrichi d'un `body` asynchrone** : le composant est synchrone et partagé ;
  une modale dédiée (comme GH82 / GH100) est plus simple et testable.
- **Supprimer un type de lien vidé** : décision utilisateur — conservé et signalé.

## 6. Risques / points à valider

- **`needsRevalidation`** (§2.4) : à confirmer au STOP HUMAIN — faut-il poser le flag sur les
  objets approuvés liés à un objet supprimé ? Défaut proposé : non.
- **Gros composants** (PH2 : 44 objets) : une écriture par objet + une par `links.yaml` ; pas de
  souci de volume attendu.
- **Watcher** : chaque suppression déclenche `repo:file-changed` ; l'invalidation finale en bloc
  (index + `qc.invalidateQueries`) couvre les rafales.
- **Repo épinglé autre que `R`** contenant des liens vers les objets supprimés : écrit, non
  commité — même règle que GH100.

## 7. Sprints

1. **Main** : types, `schema-refs.util.ts` + refactor GH100, `SchemaDeleteService` (plan +
   delete), `deleteTypeTree`, IPC / preload / channel-policy / DI — scénarios D1–D10 de
   `GH104-tests.md`.
2. **Renderer + doc** : modale, flux `StructureTab` / `ElementConfigModal`, i18n, SPEC §9 / §20,
   vérification écran de revue (D13) — scénarios D11–D15 + e2e web.
