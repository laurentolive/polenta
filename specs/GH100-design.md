# GH100 — Design : renommage de type (nom / préfixe) avec migration

Spec : `specs/GH100.md` (validée). Modèle suivi : GH77 (`FieldRenameService`, compte rendu) et GH82
(aperçu sans écriture puis confirmation) ; réécriture d'ID : GH37 (`renumberText`, `@polenta/merge-core`).

## 1. Vue d'ensemble

```
StructureTab.handleSaveElement
  ├─ nom/préfixe changés ? ── non ─→ flux actuel (GH77/GH82)
  └─ oui → api.schema.previewTypeRename(repoPath, workspaceDir, dto)   (aucune écriture)
             ├─ errors[] non vide → message, rien n'est enregistré
             ├─ 0 objet + 0 fichier → enregistrement direct puis renameType (arbre, refs de liens)
             └─ sinon → TypeRenameConfirm (comptes, repos, avertissements)
                          └─ Confirmer → saveAndMigrate : schéma → GH77 → GH82 → renameType
```

Ordre des migrations : **champs (GH77) → valeurs (GH82) → type (GH100)**. Les deux premières
cherchent les objets par l'**ancien** `objectTypeRef` (`selectedTypeRef`), qu'elles trouvent tant que
le renommage de type n'a pas tourné.

## 2. Main process

### 2.1 `TypeRenameDto` (`packages/types/src/schema.ts`)

```ts
export interface TypeRenameDto {
  nodeName: string
  category: 'requirement' | 'test' | 'campaign'
  oldName: string; newName: string
  oldPrefix: string; newPrefix: string
}
export interface TypeRenamePlan {
  objects: { oldId: string; newId: string }[]        // vide si préfixe inchangé ou campagne
  retargeted: number                                  // objets dont objectTypeRef change
  files: { repoPath: string; path: string; newPath?: string }[]  // fichiers réécrits / renommés, hors objets
  linkTypeRepos: string[]                             // schémas dont des refs de liens changent
  errors: { code: 'ID_COLLISION' | 'REPO_MISSING'; detail: string }[]
}
export type TypeRenameResult = FieldRenameResult & { files: number }
```

### 2.2 `TypeRenameService` (`services/type-rename.service.ts`, nouveau)

Dépendances : `RequirementsService`, `TestsService`, `CampaignsService`, `TreeService`,
`SchemaService`, `WorkspaceTreeService`, index exigences/tests (invalidation).

`plan(repoPath, workspaceDir, dto)` / `apply(repoPath, workspaceDir, dto)` partagent un calcul
`compute()` ; `apply` refait `compute()` (état disque frais) et refuse si `errors` non vide.

**Repos** : `resolveWorkspaceRepoPaths(workspaceTree, repoPath, workspaceDir)` (même graphe que la
traçabilité). Un chemin absent du disque → `REPO_MISSING`.

**Changement de nom** (`N::old` → `N::new`), seulement si `oldName !== newName` :
1. Objets du type dans `R` : `index.findAll(R, { type: 'N::old' })` (exigences), filtre
   `objectTypeRef` (tests, campagnes) → réécriture brute `objectTypeRef` via `rewriteObjects`
   (verrou par fichier, pas d'entrée d'historique — comme GH77).
2. Campagnes de **tous** les repos : `testSnapshot.objectTypeRef` réécrit **seulement si
   `testSnapshot.id` est un objet du type dans `R`** (évite la collision `root::X` d'un autre repo,
   sans règle spéciale). `CampaignsService.rewriteSnapshots` existe (GH82) : étendre son filtre
   (prédicat sur le snapshot) plutôt que dupliquer.
3. Arbre : `TreeService.renameTypeTree(R, N, old, new)` (nouveau, à côté de `moveTypeTree`) :
   renomme `.polenta/trees/N/old.yaml` → `new.yaml`, `typeId: new`. Absent → rien.
4. `linkTypes` : schéma de `R` toujours ; schémas des autres repos sauf si l'un d'eux (ou `R`
   lui-même, autre nœud) déclare encore `N::old`. Réécriture via `SchemaService.save` (validation
   des préfixes, cache à jour).

**Changement de préfixe** (`OLD` → `NEW`), seulement si `oldPrefix !== newPrefix` et catégorie
`requirement` ou `test` (campagnes : préfixe non utilisé, `CAMP-NNNN`) :
1. `objects` = IDs `OLD-NNNN` des objets du type dans `R` → `NEW-NNNN` (`formatCounterId`).
2. Pré-contrôle `ID_COLLISION` : `NEW-NNNN` présent comme fichier dans `R/requirements|tests` ou
   comme pierre tombale dans **un repo du workspace** (la pierre tombale du produit compte pour
   l'allocation d'un composant, `id-counter.util.ts`).
3. Réécriture textuelle, pour chaque repo du workspace, des fichiers des dossiers de données :
   `requirements/ tests/ campaigns/ test-runs/ links/ reviews/ impact-analyses/ impact-acks/
   .polenta/trees/` (liste blanche : jamais `diagrams/`, `images/`, `dashboards/`, `queries/`,
   code). Pour chaque fichier texte : `content' = fold(renumberText, objects)`,
   `path' = segments.map(s => fold(renumberText, objects))` — `renumberText` sur un **segment**
   couvre `OLD-0001.yaml`, le dossier `test-runs/OLD-0001/`, `OLD-0001-run-0003.yaml` et
   `impact-acks/OLD-0001/` (frontière d'ID de `idPattern`), sans toucher `OLD-00011`.
   Écriture : nouveau chemin d'abord, suppression de l'ancien ensuite (sous `withKeyLock` du
   fichier objet). Fonction pure `renumberAll(text|segment, pairs)` dans `type-rename.util.ts`.
4. Pierres tombales `R/.polenta/tombstones/OLD-NNNN` (`id-counter.util.ts`, création seule — ne
   jamais supprimer de fichier objet sans pierre tombale, GH20 : ici l'objet n'est pas supprimé,
   il change d'ID, l'ancien ID est retiré).
5. Les étapes « nom » 1–2 opèrent **après** le changement d'ID (fichiers déjà renommés) : ordre
   d'exécution = préfixe (étapes 1–4) puis nom (1–4), pour ne relire qu'une fois l'état final.

**Invalidation** : `requirementsIndex.invalidate` / `testsIndex.invalidate` de chaque repo touché,
`schema.invalidate` des schémas réécrits ; le canal est ajouté à `GRAPH_WRITE_CHANNELS`.

**Échecs** : au mieux par fichier, listés (`failed`), comme GH77 — sauf pré-contrôles (tout ou rien).

### 2.3 IPC / preload / API renderer

- `schema:preview-type-rename (repoPath, workspaceDir, dto)` → `TypeRenamePlan`
- `schema:rename-type (repoPath, workspaceDir, dto)` → `TypeRenameResult`
- validation du DTO dans le handler (chaînes non vides, `nodeName`, catégorie), comme
  `checkValueRenames`. `schema:rename-type` ajouté à `GRAPH_WRITE_CHANNELS`.
- Client web (`web-server`) : même table de canaux que l'IPC — à ajouter s'il y a une liste blanche.

## 3. Renderer

- `objectTypeEditor.ts` : `typeRename(updated, raw): TypeRenameDto | null` (pur, testé), sur le
  modèle de `fieldRenames` / `valueRenames`.
- `StructureTab.handleSaveElement` : si `typeRename` non nul et type existant (`!isNew`) →
  `previewTypeRename`. `errors` → `setSaveError` (rien enregistré). Plan non vide →
  `pendingTypeRename` → modale `TypeRenameConfirm` (nouveau composant, même gabarit que la modale
  GH82) : N objets `OLD-… → NEW-…` (5 premiers + « … »), fichiers par repo, avertissements fixes
  (date de création git ; scripts Suivi non réécrits). Confirmer → `saveAndMigrate(updated, chosen,
  dto)` ; Annuler → rien.
- `saveAndMigrate` : après GH77/GH82, `api.schema.renameType` ; compte rendu fusionné dans
  `renameReport` (déjà affiché) ; `qc.invalidateQueries()` (déjà fait).
- Les deux modales (GH82 valeurs, GH100 type) peuvent s'enchaîner : valeurs d'abord, type ensuite
  (`pendingValueRenames` puis `pendingTypeRename`).
- i18n fr/en : `schema.typeRename.*`.

## 4. Fichiers touchés

| Fichier | Changement |
|---|---|
| `packages/types/src/schema.ts` | `TypeRenameDto`, `TypeRenamePlan`, `TypeRenameResult` |
| `main/services/type-rename.util.ts` | nouveau — `renumberAll`, sélection des dossiers, pur |
| `main/services/type-rename.service.ts` | nouveau |
| `main/services/tree.service.ts` | `renameTypeTree` |
| `main/services/campaigns.service.ts` | `rewriteSnapshots` : prédicat de sélection |
| `main/container.ts` (ou équivalent DI) | instanciation |
| `main/ipc/index.ts`, `preload`, `renderer/api` | 2 canaux |
| `renderer/components/schema/objectTypeEditor.ts(x)` | `typeRename` |
| `renderer/components/schema/StructureTab.tsx` | flux de sauvegarde |
| `renderer/components/schema/TypeRenameConfirm.tsx` | nouveau |
| `renderer/i18n/locales/{fr,en}.json` | libellés |
| `specs/SPEC-REQ-requirements.md` §2/§4, `specs/SPEC-INDEX.md` | doc du renommage de type |

## 5. Risques

- **Repo composant épinglé** (HEAD détachée) : les écritures y restent non commitées, comme pour
  toute édition ; rien de spécifique.
- **Gros workspaces** : réécriture textuelle limitée aux dossiers de données ; lecture de fichiers
  texte uniquement (`isBinaryContent` déjà présent côté merge — à réutiliser ou équivalent).
- **Écriture concurrente par l'auto-pull / le watcher** : le watcher invalide les index fichier par
  fichier ; on invalide en bloc à la fin en plus.
- **`tree.cache.yaml` / `repoPath` relatifs** : `readCache` résout les chemins (à confirmer en
  sprint 1 par un test sur fixture workspace).

## 6. Sprints

1. Main : types, util pure, `TypeRenameService` (plan + apply), `renameTypeTree`, prédicat
   `rewriteSnapshots`, IPC/preload — tests unitaires (scénarios T1–T10 de `GH100-tests.md`).
2. Renderer : `typeRename`, modale, flux `StructureTab`, i18n, doc SPEC — tests T11–T14 + e2e si
   faisable sur la fixture existante.
