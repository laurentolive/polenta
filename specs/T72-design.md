# T72-design — Vue système multi-repo

## 1. Vue d'ensemble

Bonne nouvelle (même constat qu'en T70) : l'essentiel de la mécanique nécessaire existe déjà,
construite pour d'autres besoins et directement réutilisable ici.

| Besoin | Primitive déjà existante | Nouveau ? |
|---|---|---|
| Lister tous les repos du workspace (racine + dépendances récursives) + leurs schémas | `useWorkspaceStructure(workspaceDir, repoPath)` (T70, `hooks/useWorkspaceStructure.ts`) — expose `{ tree, schemasByRepoPath, isWorkspace, refetchTree }` | Non |
| Détecter mono-repo vs workspace | `isWorkspace` (déjà retourné par le hook ci-dessus, basé sur `api.workspace.detect`) | Non |
| Charger le schéma d'un repo donné | `useProjectSchema(repoPath)` — déjà paramétré par `repoPath`, aucun changement de signature nécessaire | Non |
| Index requirements/tests par repo | `RequirementsIndexService` / `TestsIndexService` — déjà des `Map<repoPath, …>` internes, invalidation déjà par `repoPath` | Non |
| Détecter branche courante vs détaché (tag/SHA) sur un repo | `api.sync.status(repoPath)` → `{ branch }`, `branch === ''` si HEAD détaché — déjà utilisé par `VersioningContext.tsx` pour le même besoin sur le repo racine | Non |
| Repo sans `.polenta/schema.yaml` | `SchemaService.readFromDisk` retourne déjà `DEFAULT_SCHEMA` (un nœud vide) | Non |

Donc l'essentiel du travail est de **brancher `SystemViewContext` sur ces primitives** au lieu
de les réinventer, plus les ajustements UI/routing qui en découlent.

**Changement de définition assumé** (validé dans `specs/T72.md`) : le combobox **Composant**
devient un sélecteur de **repo du workspace**, pas de `SystemNode` local. Depuis T69, un repo
n'a en pratique plus qu'un seul `SystemNode` local (toujours nommé `root`) — l'ancien usage
multi-nœuds (submodules avec `url`) a disparu avec T69. Ce ticket ne rétablit pas de sélection
multi-nœuds locale au sein d'un même repo (voir §4.3).

---

## 2. Fichiers à modifier

### 2.1 `apps/desktop/src/renderer/contexts/SystemViewContext.tsx`

- Importer et utiliser `useWorkspaceStructure(workspaceDir, project?.localPath ?? '')`, avec
  `workspaceDir = project?.workspaceDir ?? ''` (déjà retourné par `api.workspace.resolve`,
  simplement inutilisé jusqu'ici dans ce contexte).
- Construire `repoOptions: { name: string; repoPath: string; label: string }[]` :
  - Si `isWorkspace` et `tree` chargé : un élément par `WorkspaceTreeNode` de `tree.nodes`
    (racine comprise), `label` = `label` du premier `SystemNode` du schéma de ce repo (lu depuis
    `schemasByRepoPath`, déjà chargé par le hook) si présent, sinon le mount `name` seul.
  - Sinon (mono-repo, ou tree pas encore construit) : un seul élément
    `{ name: path.basename(project.localPath), repoPath: project.localPath, label: … }` — mêmes
    valeurs qu'aujourd'hui, comportement inchangé pour ce cas.
- Nouveau paramètre d'URL `repo` (à côté de `node`/`component` et `type`/`level` existants) :
  `urlRepo = sp.get('repo') ?? null`. `selectedRepoName = urlRepo ?? repoOptions[0]?.name ?? ''`.
- `repoPath` n'est plus directement `project?.localPath` : devient
  `repoOptions.find(r => r.name === selectedRepoName)?.repoPath ?? project?.localPath ?? ''`.
  Toute la suite du fichier (schema, tree, index, save, création d'objets) consomme déjà
  `repoPath` en variable — **aucun changement requis en aval de cette ligne**.
- `handleNodeChange` actuel devient `handleRepoChange(repoName)` : met à jour l'URL (`repo`),
  et réinitialise `node`/`type` sur les valeurs par défaut du nouveau repo sélectionné (même
  logique de reset qu'aujourd'hui lors d'un changement de composant, appliquée à l'échelle repo
  plutôt que nœud local).
- `navigateWith` doit désormais propager `repo` dans les search params (`/product` et
  `/components`), en plus de `node`/`component` et `type`/`level` déjà gérés.
- Nouveau calcul de lecture seule par repo :
  ```ts
  const { data: repoSyncStatus } = useQuery({
    queryKey: ['sync:status', repoPath],
    queryFn: () => api.sync.status(repoPath),
    enabled: !!repoPath && repoPath !== project?.localPath, // racine déjà couverte par VersioningContext
  })
  const isRepoDetached = repoPath !== project?.localPath && (repoSyncStatus?.branch ?? '') === ''
  const readOnly = (effectiveNode?.readonly ?? false) || isBranchReadonly || isRepoDetached
  ```
  Pas de `refetchInterval` (contrairement à `VersioningContext`) : cette valeur ne doit être
  fraîche qu'au moment où l'utilisateur sélectionne/re-sélectionne le repo, pas pollée en continu
  — un repo dépendance change rarement de pin pendant une session.
- `SystemViewState` (interface exportée) gagne : `repoOptions`, `selectedRepoName`,
  `handleRepoChange`, `isRepoReadonly` (exposé séparément de `readOnly` global si l'UI veut
  afficher un message spécifique "figé sur une baseline").

### 2.2 `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx`

- Le `<select>` "Composant" (lignes 356–370 actuelles) itère désormais `repoOptions` au lieu de
  `nodes`, `value={selectedRepoName}`, `onChange` appelle `handleRepoChange`.
- Message d'état vide si `isRepoReadonly` : bandeau discret sous le combobox ("Ce composant est
  figé sur une baseline — passez sur une branche pour l'éditer"), désactivation des actions de
  création (`+ Nouvel élément`, bouton `+` contextuel de `ElementTree`) déjà pilotées par la prop
  `readOnly` existante de `ElementTree` — **aucun changement requis dans `ElementTree.tsx`**, il
  consomme déjà un simple booléen `readOnly`.

### 2.3 `apps/desktop/src/renderer/routes/product.tsx` et `routes/components.tsx`

- `validateSearch` gagne `repo: search['repo'] as string | undefined`.

### 2.4 `specs/SPEC-SYSTEM-VIEW.md` (sprint final)

- §Combobox Composant : remplacer "Liste les composants (SystemNodes) du projet" par la
  définition repo-du-workspace.
- §Persistance de l'état : ajouter la ligne `repo` dans le tableau des paramètres d'URL.

---

## 3. Nouvelles interfaces / types

Aucun nouveau type partagé dans `@polenta/types` — réutilisation intégrale de `WorkspaceTree`,
`WorkspaceTreeNode`, `ProjectSchema` (déjà en place depuis T69/T70).

Type purement renderer (interne à `SystemViewContext.tsx`, non exporté ailleurs) :

```typescript
interface RepoOption {
  name: string       // mount name dans le workspace (ou basename du repo en mono-repo)
  repoPath: string
  label: string       // label du premier SystemNode local du repo, ou name si absent
}
```

---

## 4. Décisions techniques et alternatives rejetées

### 4.1 Réutiliser `api.sync.status` plutôt que `git.listBranches` (mentionné dans `T72.md`)

**Décision** : le spec évoquait une vérification via `git.listBranches` (le repo est-il pointé
sur un nom qui existe comme branche locale). En creusant l'implémentation existante,
`api.sync.status(repoPath)` retourne déjà un `branch` vide quand le repo est en HEAD détaché
(tag/SHA checkout) — exactement l'information recherchée, déjà consommée pour le même besoin par
`VersioningContext.tsx` sur le repo racine.
**Rationale** : réutiliser un canal IPC existant et un pattern déjà éprouvé (`branch === ''`)
plutôt qu'ajouter une dépendance à `listBranches` + logique de comparaison pin/branches qui
duplique ce que `sync:status` calcule déjà côté main process.
**Impact sur le spec** : `T72.md` §4 sera mis à jour en sprint final pour refléter ce mécanisme
(fonctionnellement équivalent à l'intention initiale — lecture seule ssi pas sur une branche
mutable).

### 4.2 Pas de nouveau combobox "Repo" séparé du combobox "Composant"

**Décision** : le combobox Composant existant change de source de données (repos au lieu de
nœuds locaux) plutôt que d'ajouter un troisième niveau de sélection au-dessus.
**Alternative rejetée** : ajouter un combobox "Repo" distinct, garder "Composant" pour les
nœuds locaux du repo sélectionné. Rejeté — depuis T69 un repo n'a plus qu'un seul nœud local en
pratique (`root`), donc un combobox "Composant" dédié aux nœuds locaux serait redondant à 99% du
temps (toujours une seule option). Le nom "Composant" reste dans l'UI (label inchangé), seule sa
sémantique interne change (repo plutôt que `SystemNode`).

### 4.3 Repo avec plusieurs `SystemNode` locaux : non géré, régression assumée nulle

**Décision** : si un repo déclare plusieurs entrées dans `schema.yaml → nodes[]` (cas
techniquement encore permis par le type `ProjectSchema`, mais mort en pratique depuis T69), seul
`nodes[0]` est utilisé comme nœud local de ce repo dans la vue Système.
**Rationale** : cette possibilité n'était déjà plus exposée nulle part dans l'UI courante pour un
repo choisi hors racine (la vue Système ne parcourait que le repo racine avant ce ticket) — ce
n'est donc pas une régression introduite par T72, juste un cas resté théorique. Si le besoin
réapparaît, un ticket dédié pourra réintroduire un second niveau de combobox.

### 4.4 Pas de rafraîchissement automatique (`refetchInterval`) du statut lecture seule par repo

**Décision** : contrairement à `VersioningContext` (poll toutes les 3s sur le repo racine, où
l'utilisateur change fréquemment de branche pendant qu'il travaille), le statut de chaque repo
dépendance n'est requêté qu'à la sélection.
**Rationale** : un repo dépendance ne change de pin/branche que via l'onglet Structure (action
utilisateur explicite et peu fréquente) — pas besoin de polling continu pour N repos en
parallèle. `qc.invalidateQueries(['sync:status', repoPath])` peut être déclenché explicitement
si besoin plus tard (ex. depuis `AddDependencyModal` après un changement de pin), mais ce n'est
pas ajouté par ce ticket (aucun repo n'est modifiable en pin depuis la vue Système elle-même).

---

## 5. Impact sur les services existants

| Service | Impact |
|---|---|
| `SystemViewContext.tsx` | Changements décrits en §2.1 |
| `SystemPanel.tsx` | Changements décrits en §2.2 |
| `useWorkspaceStructure.ts` | Aucun changement — réutilisé tel quel |
| `RequirementsIndexService` / `TestsIndexService` | Aucun changement — déjà keyés par `repoPath` |
| `SchemaService` | Aucun changement — déjà générique sur `repoPath` |
| IPC (`ipc/index.ts`) | Aucun nouveau canal |
| `EditView.tsx` / `LinkCombobox.tsx` | Aucun changement — consomment déjà `repoPath`/`linkTypes`/`objectLinks` en props, agnostiques de la provenance |
| `routes/req.$reqId.tsx`, `routes/test.$testId.tsx` | Aucun changement — prennent déjà `repoPath` en search param explicite, pas dérivé du contexte |
| `CampaignNavList` (`SystemPanel.tsx`) | Aucun changement de signature — reçoit déjà `repoPath` en prop depuis le contexte |

---

## 6. Sprint unique

Le changement est concentré dans un seul fichier de logique (`SystemViewContext.tsx`) et un seul
fichier d'UI (`SystemPanel.tsx`), plus deux `validateSearch` d'une ligne. Toutes les primitives
nécessaires existent déjà et sont réutilisées sans modification de signature. Pas de découpage
en sprints — tient dans un seul sprint.

**Critères de validation** : tous les critères d'acceptation de `specs/T72.md`.

---

## 7. Arbre de fichiers créés / modifiés

```
apps/desktop/src/renderer/
  contexts/SystemViewContext.tsx    modifié (§2.1)
  components/sidebar/SystemPanel.tsx modifié (§2.2)
  routes/product.tsx                 modifié (§2.3 — validateSearch)
  routes/components.tsx              modifié (§2.3 — validateSearch)

specs/SPEC-SYSTEM-VIEW.md            modifié (sprint final, §2.4)
specs/SPEC-INDEX.md                  modifié (sprint final — ligne SPEC-SYSTEM-VIEW.md → MAJ T72)
```
