# T74-design — Éditer / retirer un composant ou une interface dans Structure

## 1. Vue d'ensemble

| Besoin | Primitive déjà existante | Nouveau ? |
|---|---|---|
| Corriger le `pin` d'une dépendance déjà déclarée | `addDependency()` (T70) — gère déjà "même name+url, pin différent" en le corrigeant en place (`lib/workspaceActions.ts:52-53`) | Non — réutilisée telle quelle |
| Lire/écrire `polenta-repo.yaml` | `api.polentaRepo.get/save` | Non |
| Lire/écrire `schema.yaml` (dont `implements[]`) | `api.schema.get/save` | Non |
| Rebuild de l'arbre après mutation | `api.workspace.rebuildTree` | Non |
| Confirmation avec case à cocher | Aucun composant existant ne le fait (`ConfirmDelete` est un simple bouton) | Oui — nouvelle petite modale |
| Suppression physique d'un répertoire cloné | Aucune (grep négatif sur tout `apps/desktop/src/main`) | Oui — nouveau canal IPC + méthode service |
| Modale d'édition pré-remplie (vs création vide) | `AddDependencyModal` existe pour la création | Étendue avec un mode édition |
| Savoir quel est le **parent direct** d'un nœud pour muter le bon `polenta-repo.yaml`/`schema.yaml` | `RepoRow` ne propage pas cette info à ses enfants aujourd'hui | Oui — nouvelle prop `parentRepoPath` |

Sprint 1 (ce document) : édition branche + rôles, retrait avec suppression disque optionnelle.
Sprint 2 (esquissé en §7, affiné avant son propre démarrage) : renommage de mount avec cascade.

---

## 2. Fichiers à modifier — Sprint 1

### 2.1 `apps/desktop/src/main/services/workspace-tree.service.ts`

Nouvelle méthode, symétrique du clone déjà présent dans `buildTree()` :

```ts
/** Physically deletes a cloned dependency's directory. Called only after the
 *  caller has already removed its reference from polenta-repo.yaml — never
 *  the other way around, so a failed manifest write never orphans deleted
 *  files with no way back. */
async removeClonedRepo(repoPath: string): Promise<void> {
  await fsP.rm(repoPath, { recursive: true, force: true })
}
```

### 2.2 `apps/desktop/src/main/ipc/index.ts`

```ts
ipcMain.handle('workspace:remove-repo-dir', (_e, repoPath: string) =>
  c.workspaceTree.removeClonedRepo(repoPath))
```

### 2.3 `packages/api-client/src/ipc-client.ts`

```ts
removeRepoDir: (repoPath: string) => invoke('workspace:remove-repo-dir', repoPath),
```
(ajouté dans le bloc `workspace: { ... }` existant)

### 2.4 `apps/desktop/src/renderer/lib/workspaceActions.ts`

Deux nouvelles fonctions, à côté de `addDependency`/`addInterfaceImplementation` :

```ts
/** Updates the roles a component declares for an already-added interface (edit, not add). */
export async function updateInterfaceRoles(
  parentRepoPath: string, interfaceName: string, roles: string[],
): Promise<void> {
  const schema = await api.schema.get(parentRepoPath)
  const nextImplements = (schema.implements ?? []).map(impl =>
    impl.interface === interfaceName ? { ...impl, roles } : impl,
  )
  await api.schema.save(parentRepoPath, { ...schema, implements: nextImplements })
}

/**
 * Removes a dependency from `parentRepoPath`'s polenta-repo.yaml, cleans up a matching
 * `implements[]` entry if it was an interface, rebuilds the tree, and — only if the rebuild
 * succeeds and `deleteLocalFolder` is set — physically deletes the cloned directory.
 * Order matters: the manifest write always happens before any disk deletion, so a failure
 * here never leaves a dangling reference AND a missing folder at the same time.
 */
export async function removeDependency(
  workspaceDir: string,
  parentRepoPath: string,
  dep: { name: string; url: string; repoPath: string },
  deleteLocalFolder: boolean,
): Promise<WorkspaceOpenResult> {
  const manifest = await api.polentaRepo.get(parentRepoPath).then((m): PolentaRepoManifest => m ?? {})
  const dependencies = (manifest.dependencies ?? []).filter(d => !(d.name === dep.name && d.url === dep.url))
  await api.polentaRepo.save(parentRepoPath, { ...manifest, dependencies })

  const schema = await api.schema.get(parentRepoPath)
  if (schema.implements?.some(impl => impl.interface === dep.name)) {
    await api.schema.save(parentRepoPath, {
      ...schema,
      implements: schema.implements.filter(impl => impl.interface !== dep.name),
    })
  }

  const result = await api.workspace.rebuildTree(workspaceDir)
  if (result.status === 'ok' && deleteLocalFolder) {
    await api.workspace.removeRepoDir(dep.repoPath)
  }
  return result
}
```

### 2.5 `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx`

Étendue pour couvrir le mode édition, sans dupliquer le composant :

```ts
interface Props {
  kind: 'component' | 'interface'
  parentLabel: string
  isSaving: boolean
  error: string | null
  onSubmit: (values: AddDependencyValues) => void
  onClose: () => void
  /** Present → modale en mode édition : champs pré-remplis, url et name en lecture seule
   *  (le renommage du mount arrive en sprint 2 — cf. §7). */
  initialValues?: AddDependencyValues
}
```
- Titre dynamique : `Modifier ${parentLabel === 'component' ? 'le composant' : "l'interface"}` en
  mode édition (au lieu de "Ajouter…").
- `url`/`name` : `disabled` quand `initialValues` est fourni (sprint 1 — deviendra `disabled`
  seulement sur `url` en sprint 2).
- Bouton principal : "Enregistrer" au lieu de "Ajouter" en mode édition.

### 2.6 `apps/desktop/src/renderer/components/schema/RemoveDependencyModal.tsx` (nouveau)

Petite modale de confirmation, sur le modèle de `NodeEditModal` (pas `ConfirmDelete`, qui n'a pas
de place pour une case à cocher) :

```tsx
interface Props {
  repoLabel: string
  isRemoving: boolean
  error: string | null
  onConfirm: (deleteLocalFolder: boolean) => void
  onClose: () => void
}
```
Affiche `repoLabel`, une case à cocher "Supprimer aussi le dossier local (irréversible)" non
cochée par défaut, boutons Annuler / Retirer.

### 2.7 `apps/desktop/src/renderer/components/schema/StructureTab.tsx`

- `RepoRow` gagne une prop `parentRepoPath: string | undefined` (undefined uniquement pour le
  nœud racine du workspace — jamais éditable/retirable, ce n'est pas une dépendance).
  Propagée par le parent lors du rendu de `node.children.map(child => <RepoRow parentRepoPath={node.repoPath} .../>)`.
- Deux nouvelles icônes sur chaque `RepoRow` dont `parentRepoPath` est défini (donc jamais sur la
  racine), à côté du crayon existant qui édite déjà le `SystemNode` local :
  - crayon "Modifier la dépendance" → ouvre `AddDependencyModal` en mode édition, pré-rempli
    depuis `node` (url, name, pin) et, pour une interface, les rôles trouvés dans
    `schemasByRepoPath.get(parentRepoPath)?.implements?.find(i => i.interface === node.name)?.roles`.
  - icône "Retirer" → ouvre `RemoveDependencyModal`.
- Nouveaux states : `editingDependency`, `removingDependency` (même forme que
  `pendingDependency` existant, plus `parentRepoPath` et les valeurs actuelles).
- `handleSubmitEditDependency` : appelle `addDependency()` (branche) et, si interface,
  `updateInterfaceRoles()` — tous deux déjà idempotents/en place, pas de nouvelle logique de
  fusion nécessaire ici.
- `handleConfirmRemove` : appelle `removeDependency()`.

### 2.8 `apps/desktop/src/main/services/workspace-tree.service.ts` et `sync.service.ts` — correctif de sécurité (découvert en vérification live, pas dans le plan initial)

**Bug trouvé en testant L2** (branche invalide) contre un vrai clone existant : `buildTree()`
appelait inconditionnellement `syncService.clone()` dès que `repoExistsAtPin()` retournait
`false` — or cette fonction retourne `false` aussi bien quand le répertoire n'existe pas du tout
que quand il existe déjà avec un clone valide mais que le pin demandé n'y est pas résolvable
(ex. juste édité vers une branche pas encore récupérée). `clone()` d'isomorphic-git réinitialise
`.git` en tout début d'opération, avant même la tentative réseau — donc un clone déclenché sur un
répertoire déjà peuplé **détruit le `.git` existant avant de découvrir que la référence demandée
est introuvable**. Reproduit en direct : éditer la branche de `comp-controller` (déjà cloné) vers
un nom inexistant a fait disparaître son `.git` entier (contenu du répertoire de travail
préservé, historique git perdu).

Ce chemin de code est antérieur à T74 (T69/T70) et n'était auparavant atteignable que pour
l'ajout d'une toute nouvelle dépendance (répertoire réellement vide, cloner est sûr) — T74 est la
première fonctionnalité qui le rend trivialement déclenchable sur une dépendance **existante** via
un usage normal (une faute de frappe sur un nom de branche).

**Correctif** :
- Nouvelle méthode `WorkspaceTreeService.hasGitDir(repoPath)` — distingue "jamais cloné" de
  "cloné mais pin différent".
- Nouvelle méthode `SyncService.fetch(repoPath, urlFallback, remote='origin')` — récupère les
  refs sans fusionner ni rien extraire (symétrique de `pull()` en plus léger), avec repli sur
  `urlFallback` (l'URL déclarée dans `polenta-repo.yaml`) si le repo local n'a pas encore de
  remote configuré.
- `buildTree()` : quand `!exists` mais `hasGitDir(repoPath)` est vrai, appelle `fetch()` puis
  tente le `checkout` normal — ne clone **jamais** par-dessus un repo déjà présent. En cas
  d'échec, message d'erreur identique à avant ("branche/tag introuvable"), mais le repo local
  n'est plus jamais touché.
- Vérifié en direct : même scénario destructeur reproduit après correctif → `.git` intact, pin
  correctement restauré dans `polenta-repo.yaml`, même message d'erreur affiché à l'utilisateur
  (aucune régression du comportement d'erreur, uniquement suppression de l'effet destructeur).

---

## 3. Nouvelles interfaces / types

Aucun nouveau type partagé dans `@polenta/types` pour le sprint 1 — `PolentaRepoDependency`,
`ImplementsDeclaration`, `WorkspaceTreeNode` couvrent déjà tous les champs manipulés.

Un seul ajout côté `packages/api-client/src/types.ts` : la signature de `removeRepoDir` dans
l'interface `Api.workspace`.

---

## 4. Décisions techniques et alternatives rejetées

### 4.1 Étendre `AddDependencyModal` plutôt que créer un composant séparé

**Décision** : ajout d'une prop optionnelle `initialValues` plutôt qu'un `EditDependencyModal`
dupliqué.
**Rationale** : les deux modales partagent 100% des champs et de la validation ; la seule
différence est l'état initial et si `url`/`name` sont modifiables. Dupliquer aurait signifié
maintenir deux copies du même formulaire.

### 4.2 Réutiliser `addDependency()` pour l'édition de branche plutôt qu'une fonction dédiée

**Décision** : aucun changement à `addDependency()` — son comportement "corrige en place si
name+url identiques, pin différent" (T70) est exactement ce dont l'édition de branche a besoin.
**Rationale** : découvert en explorant le code avant de designer quoi que ce soit — évite de
dupliquer une logique de "diff + patch" déjà écrite et déjà testée.

### 4.3 Suppression disque : nouveau canal IPC dédié, pas de réutilisation détournée

**Décision** : `workspace:remove-repo-dir` est un nouveau canal minimal (une seule
responsabilité : `fs.rm(path, {recursive:true, force:true})`), pas une extension d'un canal
existant.
**Alternative rejetée** : passer par un canal générique de fichiers s'il en existait un — aucun
canal générique de ce type n'existe dans ce codebase (chaque canal est scopé à une ressource
métier précise), donc suivre la même convention plutôt qu'en introduire une nouvelle.
**Sécurité** : `repoPath` provient toujours d'un `WorkspaceTreeNode.repoPath` déjà résolu par le
backend (jamais une saisie utilisateur libre), donc pas de validation de chemin supplémentaire
nécessaire côté handler — cohérent avec tous les autres canaux `repoPath`-scoped existants.

### 4.4 Ordre manifeste-puis-disque, jamais l'inverse

**Décision** : `removeDependency()` écrit toujours le manifeste (+ rebuild) avant de supprimer le
dossier, et seulement si le rebuild a réussi.
**Rationale** : si la suppression disque se produisait en premier et que l'écriture du manifeste
échouait ensuite, l'utilisateur perdrait le dossier local tout en gardant une entrée
`polenta-repo.yaml` pointant vers un chemin qui n'existe plus — un état bien pire qu'un simple
échec de retrait de référence (récupérable en réessayant).

### 4.5 `parentRepoPath` propagé par prop plutôt que recalculé

**Décision** : `StructureTab` propage explicitement `parentRepoPath` à chaque `RepoRow` enfant au
moment du rendu (`node.repoPath` du parent), plutôt que de chercher à le retrouver après coup
(ex. en remontant l'arbre depuis `tree.nodes` par nom).
**Rationale** : l'arbre est déjà construit avec la relation parent→enfant explicite
(`node.children`) ; la propager au rendu est trivial et évite une recherche O(n) par clic.

---

## 5. Impact sur les services existants

| Service | Impact |
|---|---|
| `WorkspaceTreeService` | + `removeClonedRepo()` (§2.1) ; + `hasGitDir()` et correctif sécurité dans `buildTree()` (§2.8) |
| `SyncService` | + `fetch()` (§2.8) — correctif sécurité, pas dans le plan initial |
| `PolentaRepoService` | Aucun changement — `get`/`save` déjà suffisants |
| `SchemaService` | Aucun changement — `get`/`save` déjà suffisants |
| `InterfaceComplianceService` | Aucun changement — recalcule déjà à la volée depuis l'arbre et les schémas ; un composant retiré disparaît naturellement de la matrice au prochain calcul |
| IPC (`ipc/index.ts`) | + 1 nouveau canal (`workspace:remove-repo-dir`) |

---

## 6. Sprint 1 — critères de validation

Tous les critères d'acceptation de `T74.md` sauf ceux marqués "(sprint 2)".

---

## 7. Sprint 2 — renommage de mount avec cascade (esquisse)

À affiner en détail avant le démarrage de ce sprint (le périmètre ci-dessous est indicatif, pas
gelé) :

- Nouveau canal IPC `workspace:rename-repo-dir(oldRepoPath, newRepoPath)` →
  `fsP.rename(oldRepoPath, newRepoPath)` côté `WorkspaceTreeService`.
- Nouvelle fonction `renameDependency(workspaceDir, parentRepoPath, dep, newName)` dans
  `workspaceActions.ts` :
  1. Renomme le répertoire physique (nouveau canal ci-dessus).
  2. Met à jour `name` dans l'entrée `dependencies[]` du parent direct.
  3. Parcourt **tous** les repos de `tree.nodes` (pas seulement le parent direct — un mount peut
     être implémenté par n'importe quel composant du workspace, pas seulement celui qui l'a
     ajouté) et, pour chacun dont `schema.implements` contient une entrée
     `interface === oldName`, réécrit cette entrée avec `newName`.
  4. Rebuild de l'arbre.
- Cas MountOverride (diamond conflict résolu, même URL montée deux fois sous deux noms) : le
  filtre de l'étape 3 doit comparer sur le mount name exact (`impl.interface === oldName`), donc
  ne touche jamais l'autre montage de la même URL — déjà garanti par construction puisque
  `implements[].interface` référence toujours un nom de montage précis, jamais une URL.
- Rollback : si une étape échoue après le renommage physique du dossier (ex. écriture manifeste
  échoue), il faut soit annuler le renommage physique (rename inverse), soit accepter un état
  incohérent transitoire signalé à l'utilisateur — décision à trancher explicitement dans la spec
  de sprint 2 avant de coder (actuellement non tranchée, volontairement laissée ouverte ici).
