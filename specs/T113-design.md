# T113 — Design

## 1. Ce que l'exploration du code a changé par rapport à la spec

La spec (`specs/T113.md`) supposait que le badge "⚠ non associé à un repo" résultait d'une
tentative de résolution ratée (nom de nœud cherché dans l'arbre workspace, non trouvé). Ce n'est
pas le cas : dans `StructureTab.tsx` (`RepoRow`, ligne ~319-336), la condition est **purement
syntaxique** :

```tsx
{schema?.nodes.map((localNode, nodeIndex) => (
  <div key={nodeIndex}>
    {localNode.name !== 'root' && ( /* badge + Supprimer, inconditionnel */ )}
    {(localNode.objectTypes ?? []).map(...)}  {/* rendu que le nœud soit "orphelin" ou non */}
```

Tout nœud d'un `schema.nodes[]` dont le `name` n'est pas exactement `'root'` est marqué, sans
aucune vérification contre `polenta-repo.yaml` ni contre l'arbre workspace (`flatNodes`). C'est
cohérent avec l'architecture T69+ : une dépendance repo-séparé n'est **jamais** représentée comme
une entrée supplémentaire dans le `schema.nodes[]` d'un autre repo — c'est un repo entièrement
distinct, avec son propre `schema.yaml` et son propre nœud `root`, assemblé dans l'arbre via
`polenta-repo.yaml` + `WorkspaceTreeService`. Une dépendance dont le clone échoue ne produit pas
non plus d'entrée "orpheline" dans `schema.nodes[]` : `buildTree()` (`workspace-tree.service.ts`)
retourne un statut d'erreur dédié (`parse-error`, message "La branche/tag … est introuvable…"),
affiché tout en haut de `StructureTab` via la bannière `error`/`conflictError` existante — un
mécanisme entièrement séparé du rendu de l'arbre `schema.nodes[]`.

**Conséquence sur la spec** : le critère d'acceptation "le badge est conservé pour le vrai cas
d'erreur (dépendance déclarée mais non résolue)" ne correspond à aucun changement de code — ce
cas est déjà couvert par la bannière d'erreur existante, sans rapport avec le badge orphelin qui,
lui, disparaît entièrement. Aucune nouvelle détection à écrire. Le comportement utilisateur décrit
dans la spec reste correct (une vraie dépendance cassée reste signalée) ; seul le mécanisme change
(bannière existante, pas le badge).

## 2. Modèle mental retenu

Un repo (nœud de l'arbre workspace, ex. `polenta-projet1`, `HMI`, `BMS`) peut définir dans son
propre `.polenta/schema.yaml` :
- un nœud `root` (toujours présent, représente le repo lui-même) — comportement inchangé ;
- zéro ou plusieurs **sous-composants locaux** — des `SystemNode` additionnels, `name !== 'root'`,
  sans `url`, vivant dans le même `schema.yaml` / même historique git que `root`.

Un sous-composant local se comporte exactement comme `root` pour tout ce qui touche à ses propres
types d'objets : ajout/édition/suppression d'`ObjectTypeDefinition`, contraintes de préfixe unique
(déjà global via `allPrefixes`, inchangé), création d'exigences (`resolveComponentRepoPath` route
déjà vers le repo courant quand le nom ne matche rien dans l'arbre — vérifié empiriquement, cf.
spec §Comportement attendu 6, aucun changement de service requis).

Il ne participe **pas** au système `polenta-repo.yaml` / dépendances / interfaces (`roles`,
`implements` restent hors scope, cf. spec).

## 3. Changements UI (`StructureTab.tsx`)

### 3.1 Rendu d'un nœud local (remplace le bloc "orphelin")

Remplacer le bloc conditionnel `localNode.name !== 'root' && (badge + Supprimer)` par un
mini-header par nœud local, au même niveau visuel qu'une `RepoRow` mais sans les affordances
propres à un repo séparé (pas de branche/pin, pas de `RepoBranchSelector`, pas d'edit
dépendance) :

```
[chevron?] <label ou name>          [+ élément] [✎ label] [🗑]
    <ElementLeaf ...>   (objectTypes existants, rendu identique à aujourd'hui)
```

- Le `[+ élément]` ouvre le même sous-menu que `AddMenu` propose déjà pour `root`
  (Exigence / Test / Campagne) mais ciblant ce `nodeIndex` local au lieu de `rootNodeIndex`.
  → `AddMenu` est généralisé pour accepter une liste de "cibles" (`root` + chaque nœud local)
  plutôt qu'un unique `rootNodeIndex`, ou (plus simple, retenu) : chaque nœud local obtient son
  propre petit bouton `+` autonome à côté de son nom, réutilisant `onAddElement` avec son propre
  `nodeIndex` — pas besoin de dupliquer tout `AddMenu` pour ça, seulement son sous-menu de 3
  catégories.
- Le `[✎]` ouvre `NodeEditModal` (déjà générique sur `{repoPath, nodeIndex, label, description}`
  — aucun changement à ce composant, juste un nouvel appelant).
- Le `[🗑]` reste une suppression directe avec confirmation (`ConfirmDelete`, réutilisé tel quel) —
  reformulée sans référence à un "orphelin" : c'est une suppression de composant normale.

### 3.2 Création (`AddMenu` inchangé, `AddDependencyModal` étendu)

Pas de nouvelle entrée de menu (retour utilisateur : un seul point d'entrée). `AddMenu` garde
exactement "+ Composant" / "+ Interface" / éléments — inchangé. C'est `AddDependencyModal`
(ouvert par "+ Composant", `kind === 'component'`) qui gagne une case à cocher **"Composant local
(dans ce repo)"**, visible uniquement en mode création (`!isEdit`) et uniquement pour
`kind === 'component'` (une interface a structurellement besoin d'un repo séparé — `roles`/
`implements` n'ont pas de sens pour un sous-composant local, cf. spec Hors scope — donc pas de
case à cocher pour `kind === 'interface'`).

Cocher "Composant local" **masque** (pas seulement désactive — retour utilisateur après une
première version qui se contentait de griser les champs) les blocs **Repo (URL git)** et
**Branche** : ils n'ont aucun sens pour un sous-composant local, la popup se réduit à la case à
cocher + **Nom (montage)** (devient le `SystemNode.name`). Le bloc **Label affiché**/Description
reste réservé au mode édition (`isEdit` uniquement, comportement inchangé) — la case ne touche
plus à sa visibilité (une version intermédiaire l'avait fait apparaître aussi en mode création
local ; retiré sur retour explicite, le nom seul suffit à la création, le label se règle ensuite
via l'icône crayon comme pour tout autre nœud).

`AddDependencyValues` gagne un champ `isLocal: boolean`. `handleSubmit` de la modale valide
différemment selon l'état de la case :
- non cochée : validation inchangée (`url`, `name`, `branch` requis) ;
- cochée : seul `name` est requis.

`onSubmit` transmet toujours le même objet `AddDependencyValues` (avec `isLocal`) — c'est
`StructureTab.handleSubmitDependency` qui bifurque (§3.4), pas la modale elle-même.

### 3.3 Validation du `name`

`AddDependencyModal` reste un composant "bête" (pas d'accès à `schemasByRepoPath`) — il ne valide
que le minimum syntaxique (`name` non vide, trim). Les contraintes qui dépendent de l'état du
schéma sont vérifiées dans `StructureTab.handleSubmitDependency` (§3.4), avant tout appel à
`saveSchema`, avec le même mécanisme d'erreur inline que la modale affiche déjà
(`addDependencyError`) :
- `name` différent de `root` (réservé) ;
- pas de doublon dans `schema.nodes[].name` du repo ciblé (y compris `root`) ;
- pas de doublon avec un nom de dépendance déjà présent dans `flatNodes` du même sous-arbre
  (évite la confusion avec un vrai composant repo-séparé portant le même nom).

Pas de contrainte de format supplémentaire (pas de regex imposée) — un `name` sert uniquement de
segment gauche d'`objectTypeRef` (`name::type`), aucun caractère n'est structurellement interdit
par le parsing existant (`split('::')`).

### 3.4 Handler de sauvegarde

`handleSubmitDependency` (existant) bifurque en tête sur `values.isLocal` avant d'atteindre la
logique `addDependency`/`addInterfaceImplementation` actuelle, qui reste inchangée pour le
chemin non-local :

```ts
const handleSubmitDependency = async (values: AddDependencyValues) => {
  if (!pendingDependency) return
  if (values.isLocal) {
    const schema = schemasByRepoPath.get(pendingDependency.repoPath)
    if (!schema) return
    const name = values.name.trim()
    if (name === 'root' || schema.nodes.some(n => n.name === name)
        || flatNodes.some(n => n.name === name)) {
      setAddDependencyError('Ce nom est déjà utilisé dans ce repo ou ce workspace.')
      return
    }
    setIsAddingDependency(true)
    try {
      const newNode: SystemNode = { name, label: values.label.trim() || name, readonly: false, objectTypes: [] }
      await saveSchema(pendingDependency.repoPath, { ...schema, nodes: [...schema.nodes, newNode] })
      setPendingDependency(null)
    } catch (err) {
      setAddDependencyError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsAddingDependency(false)
    }
    return
  }
  // ...chemin existant inchangé (addDependency / addInterfaceImplementation)...
}
```

Purement local à `saveSchema` (déjà existant, `api.schema.save` + invalidation React Query) — pas
de nouvel appel IPC, pas de passage par `workspaceActions.ts` (réservé aux opérations impliquant
git/`polenta-repo.yaml`, non concernées ici), pas de `ensureWorkspaceInitialized` (inutile sans
dépendance).

`handleDeleteOrphanNode` renommé `handleDeleteLocalComponent` (même corps — aucun changement de
logique, seulement de nom et de commentaire, pour refléter que ce n'est plus un cas d'erreur).

## 4. Ce qui NE change PAS (vérifié, pas de risque de régression)

- `apps/desktop/src/main/services/schema.service.ts` (`resolveComponentRepoPath`) — déjà correct :
  un `objectTypeRef` dont le nœud n'est pas dans l'arbre workspace retombe sur le repo courant.
  Vérifié empiriquement (298 exigences créées directement en fichiers sur 6 nœuds locaux dans un
  projet de test, toutes lisibles/indexées/interrogeables via SQL et dashboards sans erreur).
- `apps/desktop/src/main/services/requirements.service.ts` / `requirements-index.service.ts` —
  aucune notion de "nœud orphelin", opèrent uniquement sur `objectTypeRef` + `repoPath`.
- `apps/desktop/src/main/services/workspace-tree.service.ts` / `polenta-repo.service.ts` —
  aucun changement : les sous-composants locaux ne touchent jamais `polenta-repo.yaml`.
- `packages/types/src/schema.ts` (`SystemNode`, `ProjectSchema`) — le type a déjà tous les champs
  nécessaires (`name`, `label`, `description?`, `readonly`, `objectTypes?`). Aucun changement de
  type.

## 5. Découpage en sprints

**Un seul sprint.** Le changement est contenu à `StructureTab.tsx` + `AddDependencyModal.tsx`,
sans impact service/IPC/types. Périmètre : §3.1 à §3.4 ci-dessus, + mise à jour de
`SPEC-TEMPLATES.md` §3 en fin de sprint (note explicite : plusieurs `SystemNode` locaux par repo
est un pattern supporté, avec pointeur vers la case "Composant local" de "+ Composant").

## 6. Alternatives rejetées

- **Un second point d'entrée "+ Sous-composant" distinct dans `AddMenu`, avec sa propre modale**
  (première version de ce design) : rejeté sur retour explicite — un seul point d'entrée
  "+ Composant" est préféré, avec une case à cocher qui active/désactive la configuration repo
  dans la même popup. Retenu : extension de `AddDependencyModal` (§3.2).
- **Généraliser `AddMenu` pour accepter une liste de cibles element-addable** (root + tous les
  nœuds locaux) plutôt que donner à chaque nœud local son propre petit bouton `+` autonome :
  rejeté pour ce sprint — plus de remaniement pour un gain cosmétique mineur (un seul menu
  déroulant au lieu d'un bouton par nœud). Le bouton autonome par nœud local est strictement
  local à sa propre ligne, plus simple à raisonner et à tester.
- **Détecter et signaler explicitement les dépendances `polenta-repo.yaml` cassées via le même
  mécanisme de badge** (au lieu de laisser la bannière d'erreur existante s'en charger) : rejeté —
  ce cas est déjà couvert (cf. §1), dupliquer la détection ajouterait de la complexité sans
  bénéfice utilisateur constaté.
- **Autoriser la conversion après coup local ↔ repo séparé** : rejeté, explicitement hors scope de
  la spec validée.

## 7. Fichiers modifiés

- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` — modifié (§3.1, §3.4).
- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` — modifié (§3.2 : case à
  cocher "Composant local", champ `isLocal` sur `AddDependencyValues`, validation allégée,
  affichage du champ label hors mode édition quand `isLocal`).
- `specs/SPEC-TEMPLATES.md` §3 — modifié en fin de sprint (documentation).
