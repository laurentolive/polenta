# T123 — Design

## 1. Vue d'ensemble

Deux axes indépendants mais qui touchent le même point d'entrée (`SystemNode`) :

- **A. Imbrication** : `SystemNode` devient un arbre (`children?: SystemNode[]`) au lieu d'un
  tableau plat.
- **B. Interfaces au niveau du composant** : `roles`/`implements` quittent `ProjectSchema`
  (niveau fichier) pour devenir des champs de `SystemNode` (niveau composant), `root` inclus.

Les deux axes partagent le même problème technique sous-jacent : toute la base de code qui
résout un composant par son nom (`schema.nodes.find(n => n.name === X)`) doit devenir récursive.
Plutôt que de dupliquer cette récursion dans chacun des ~8 call sites identifiés, ce design
introduit un **module de traversée partagé** dans `packages/types` (importable aussi bien par le
process main que par le renderer, puisque c'est un package de types/utilitaires purs sans
dépendance Node.js).

## 2. Nouveau module partagé : `packages/types/src/schema-tree.ts`

```ts
import type { SystemNode } from './schema'

/** Recherche récursive par nom dans l'arbre de SystemNode (root + descendants locaux). */
export function findSystemNode(nodes: SystemNode[], name: string): SystemNode | undefined {
  for (const n of nodes) {
    if (n.name === name) return n
    const found = findSystemNode(n.children ?? [], name)
    if (found) return found
  }
  return undefined
}

/** Un SystemNode aplati avec la chaîne de ses ancêtres locaux (root exclu de la chaîne — c'est
 *  le repo lui-même qui le représente déjà dans l'UI, cf. SPEC-SYSTEM-VIEW.md). */
export interface FlatSystemNode {
  node: SystemNode
  ancestors: SystemNode[]
}

/** Aplatit l'arbre en pré-ordre, avec pour chaque nœud la liste de ses ancêtres locaux. */
export function flattenSystemNodes(nodes: SystemNode[], ancestors: SystemNode[] = []): FlatSystemNode[] {
  const out: FlatSystemNode[] = []
  for (const n of nodes) {
    out.push({ node: n, ancestors })
    out.push(...flattenSystemNodes(n.children ?? [], [...ancestors, n]))
  }
  return out
}

/** Remplace immuablement le nœud nommé `targetName` par `fn(node)`, où qu'il soit dans l'arbre.
 *  Ne fait rien (retourne `nodes` inchangé en valeur, nouvelles références sur le chemin modifié
 *  uniquement) si `targetName` est introuvable — l'appelant est responsable de vérifier au
 *  préalable via `findSystemNode` s'il doit lever une erreur (cf. `requireNode`). */
export function mapSystemNode(
  nodes: SystemNode[], targetName: string, fn: (node: SystemNode) => SystemNode,
): SystemNode[] {
  return nodes.map(n => {
    if (n.name === targetName) return fn(n)
    if (!n.children?.length) return n
    const children = mapSystemNode(n.children, targetName, fn)
    return children === n.children ? n : { ...n, children }
  })
}

/** Retire immuablement le nœud nommé `targetName` de l'arbre (et tout son sous-arbre avec lui). */
export function removeSystemNode(nodes: SystemNode[], targetName: string): SystemNode[] {
  return nodes
    .filter(n => n.name !== targetName)
    .map(n => (!n.children?.length ? n : { ...n, children: removeSystemNode(n.children, targetName) }))
}

/** Compte les composants et éléments (exigences/tests/campagnes) dans un sous-arbre — utilisé
 *  pour le message de confirmation de suppression en cascade. */
export function countSubtree(node: SystemNode): { components: number; elements: number } {
  const children = node.children ?? []
  return children.reduce(
    (acc, child) => {
      const sub = countSubtree(child)
      return { components: acc.components + 1 + sub.components, elements: acc.elements + sub.elements }
    },
    { components: 0, elements: node.objectTypes?.length ? 0 : 0 }, // elements réel = hors scope schema (cf. §7)
  )
}
```

**Pourquoi un nouveau fichier plutôt qu'étendre `schema-lookup.util.ts`** : ce dernier vit dans
`apps/desktop/src/main/services/` (process main uniquement, jamais importé par le renderer —
vérifié par grep, seuls des services `main/services/*` l'utilisent). Les combobox de la Vue
Système (`SystemViewContext.tsx`, `useWorkspaceStructure.ts`) et l'arbre `StructureTab.tsx`
tournent côté renderer et dupliquent aujourd'hui leur propre traversée de `schema.nodes` en
`.find()`/boucles plates. Un module dans `packages/types` (déjà partagé entre les deux process,
zéro dépendance Node.js) évite de dupliquer la récursion une 3e fois côté renderer.

**Note sur `countSubtree`** : le nombre d'éléments (exigences/tests/campagnes) réels d'un
`SystemNode` n'est pas stocké dans `schema.yaml` (`objectTypes[]` ne décrit que les *types*
configurés, pas les instances — celles-ci vivent dans `requirements/`, `tests/`, `.polenta/trees/`
côté disque). Le compte exact nécessite un appel supplémentaire côté service (`RequirementsIndexService`/
`TestsIndexService`) avant suppression — à câbler dans `handleDeleteLocalComponent` (Sprint 2),
`countSubtree` ci-dessus ne donne que le nombre de composants, le nombre d'éléments s'ajoute côté
appelant. Documenté explicitement pour ne pas être oublié en Sprint 2.

## 3. Modèle de données (`packages/types/src/schema.ts`)

```ts
export interface SystemNode {
  name: string
  label: string
  description?: string
  readonly: boolean
  objectTypes?: ObjectTypeDefinition[]
  children?: SystemNode[]                    // NOUVEAU (T123, axe A)
  roles?: RoleDefinition[]                   // NOUVEAU (T123, axe B — déplacé depuis ProjectSchema)
  implements?: ImplementsDeclaration[]       // NOUVEAU (T123, axe B — déplacé depuis ProjectSchema)
}

export interface ProjectSchema {
  version: number
  nodes: SystemNode[]
  linkTypes: LinkTypeDefinition[]
  /** @deprecated T123 — lu en migration transparente vers nodes[root].roles, jamais réécrit ici. */
  roles?: RoleDefinition[]
  /** @deprecated T123 — lu en migration transparente vers nodes[root].implements, jamais réécrit ici. */
  implements?: ImplementsDeclaration[]
  preferences?: ProjectPreferences
}
```

Les champs `@deprecated` restent typés (pas de cassure de compilation sur du code non encore
migré) mais **`SchemaService.save()` ne les écrit plus jamais** — cf. §4 migration.

## 4. `schema.service.ts` — migration + récursion

### 4.1 Migration à la lecture

```ts
private async readFromDisk(repoPath: string): Promise<ProjectSchema> {
  try {
    const filePath = path.join(repoPath, '.polenta', 'schema.yaml')
    const raw = await fsP.readFile(filePath, 'utf-8')
    const parsed = yaml.load(raw) as ProjectSchema
    if (!parsed || !parsed.nodes) return DEFAULT_SCHEMA
    return this.migrateRootRolesImplements(parsed)
  } catch {
    return DEFAULT_SCHEMA
  }
}

/** T123 — un schema.yaml écrit avant ce ticket porte roles/implements au niveau racine du
 *  fichier ; on les relit comme ceux du node root, sans jamais les réécrire à cet endroit
 *  (save() suivant les retire du niveau racine). Idempotent : un schema.yaml déjà migré n'a
 *  plus de roles/implements racine, cette fonction est un no-op. */
private migrateRootRolesImplements(schema: ProjectSchema): ProjectSchema {
  if (!schema.roles?.length && !schema.implements?.length) return schema
  const { roles, implements: impl, ...rest } = schema
  return {
    ...rest,
    nodes: mapSystemNode(schema.nodes, 'root', root => ({
      ...root,
      roles: root.roles ?? roles,
      implements: root.implements ?? impl,
    })),
  }
}
```

`save()` sérialise `ProjectSchema` tel quel (`yaml.dump`) — puisque `migrateRootRolesImplements`
retire déjà `roles`/`implements` de l'objet avant qu'il ne soit modifié en mémoire, un
round-trip lecture→sauvegarde réécrit naturellement le nouveau format (root porte ses propres
`roles`/`implements`, plus rien au niveau racine du fichier). Aucun script de migration séparé.

### 4.2 `addNode` avec `parentName`

```ts
async addNode(
  repoPath: string,
  dto: { name: string; label: string; description?: string; readonly?: boolean; parentName?: string },
): Promise<ProjectSchema> {
  return this.withMutationQueue(repoPath, async () => {
    const schema = await this.get(repoPath)
    if (findSystemNode(schema.nodes, dto.name)) {
      throw new SchemaValidationError('NODE_NAME_TAKEN', `Le nom de composant "${dto.name}" est déjà utilisé dans ce projet.`)
    }
    const newNode: SystemNode = {
      name: dto.name, label: dto.label, readonly: dto.readonly ?? false, objectTypes: [],
      ...(dto.description ? { description: dto.description } : {}),
    }
    let nodes: SystemNode[]
    if (dto.parentName) {
      if (!findSystemNode(schema.nodes, dto.parentName)) {
        throw new SchemaValidationError('NODE_NOT_FOUND', `Composant parent "${dto.parentName}" introuvable.`)
      }
      nodes = mapSystemNode(schema.nodes, dto.parentName, parent => ({
        ...parent, children: [...(parent.children ?? []), newNode],
      }))
    } else {
      nodes = [...schema.nodes, newNode]
    }
    const updated: ProjectSchema = { ...schema, nodes }
    await this.save(repoPath, updated)
    return updated
  })
}
```

Uniqueness du nom (`findSystemNode`) porte sur **tout l'arbre** (décision validée : pas de nom
dupliqué même sous des parents différents) — pas de changement de comportement pour le cas non
imbriqué, juste une recherche récursive au lieu d'un `.some()` plat.

### 4.3 `requireNode` / `findNodeUsingPrefix` / `resolveComponentRepoPath`

- `requireNode` : `schema.nodes.find(...)` → `findSystemNode(schema.nodes, nodeName)`.
- `findNodeUsingPrefix` : parcours plat → `flattenSystemNodes(schema.nodes)` puis
  `.find(({node}) => node.objectTypes?.some(t => t.prefix === prefix))?.node.name`.
- `resolveComponentRepoPath` : **inchangé**. Il résout un `objectTypeRef` non-`root::` contre
  `tree.nodes` (des `WorkspaceTreeNode`, un par **repo**, pas un par `SystemNode`) — c'est déjà le
  mécanisme "repo séparé", orthogonal à l'imbrication locale (cf. §Hors scope de la spec). Un
  `objectTypeRef` ciblant un composant local imbriqué reste toujours `nodeName::typeName` avec
  `nodeName !== 'root'` mais **absent de `polenta-repo.yaml`** → cette méthode renvoie déjà `null`
  ("mono-repo mode, composant introuvable dans l'arbre workspace") pour ce cas, exactement comme
  pour un composant local non imbriqué aujourd'hui (T113) — aucune modification requise ici.

### 4.4 `findObjectTypeDef` (`schema-lookup.util.ts`)

```ts
export function findObjectTypeDef(schema: ProjectSchema, objectTypeRef: string): ResolvedObjectType {
  if (typeof objectTypeRef !== 'string' || objectTypeRef.length === 0) return 'unresolvable'
  const [nodeName, typeName] = objectTypeRef.includes('::') ? objectTypeRef.split('::') : [undefined, objectTypeRef]

  if (nodeName && nodeName !== 'root') {
    const node = findSystemNode(schema.nodes, nodeName)
    if (!node || node.objectTypes === undefined) return 'unresolvable'
    return node.objectTypes.find((t) => t.name === typeName) ?? null
  }
  for (const { node } of flattenSystemNodes(schema.nodes)) {
    const found = node.objectTypes?.find((t) => t.name === typeName)
    if (found) return found
  }
  return null
}
```

**Effet en cascade sans changement de code** : `nextId()`/`nextTestId()`
(`requirements.service.ts:134`, `tests.service.ts` équivalent) et `resolveIdPrefix()`
(`bulk-import-validation.util.ts:193`) appellent déjà exclusivement `findObjectTypeDef` — ils
héritent de la résolution récursive **sans aucune modification**. Vérifié en lisant les deux
call sites (T113 les avait déjà centralisés sur cette fonction pour corriger le bug de préfixe
signalé dans `specs/T113-sprint1.md` point 5).

## 5. MCP — `add_component`

`schema-mutation.tools.ts:75-80` : `addComponentInput` gagne `parentName: z.string().optional()`.
`registerTool('add_component', ...)` passe le dto tel quel à `container.schema.addNode` (déjà
inchangé, §4.2 gère `parentName`). Description du tool mise à jour pour mentionner l'imbrication.

`SPEC-MCP-SERVER.md` §4.3 documente le nouveau paramètre. Pas de tool dédié pour `roles`/
`implements` sur un composant local dans ce ticket (cf. spec Comportement attendu §14 — à évaluer
en Sprint 3/4 selon le temps restant, pas bloquant : un agent IA peut toujours créer le composant
via `add_component`, l'édition roles/implements restant un geste UI humain comme aujourd'hui pour
un composant repo séparé, cf. T110).

## 6. UI — `StructureTab.tsx`

- La ligne d'un composant local (`localNode`, aujourd'hui rendue en un seul passage plat lignes
  353-403) devient elle-même récursive : extraction d'un composant `LocalNodeRow` (nouveau)
  affichant le nœud, son `AddElementMenu` existant, une nouvelle action **"+ Composant local"**
  (ouvre `AddDependencyModal` en mode local avec un `parentName` = ce nœud), et
  `localNode.children?.map(child => <LocalNodeRow node={child} depth={depth+1} .../>)`.
- `handleAddLocalComponent` (ligne 684) gagne un paramètre `parentName?: string`, transmis à
  `SchemaService.addNode` (via l'IPC existant, signature étendue en cascade).
- `handleDeleteLocalComponent` (ligne 671) : remplace le filtre plat
  (`schema.nodes.filter((_, i) => i !== nodeIndex)`) par `removeSystemNode(schema.nodes, name)` —
  **note** : le code actuel indexe par `nodeIndex` (position dans le tableau plat) ; avec
  l'imbrication, l'identifiant stable devient le **nom** du nœud plutôt que sa position (une
  position n'a plus de sens unique une fois qu'il y a plusieurs niveaux). Impact : les signatures
  `onDeleteLocalComponent`, `onEditNode`, `onSelectElement`/`onMoveElement`/`onDeleteElement` qui
  passent aujourd'hui `nodeIndex` (un entier, position dans `schema.nodes`) doivent passer le
  **nom du nœud** à la place — répercuté dans tous les call sites de `RepoRow`/`LocalNodeRow`.
  C'est le changement le plus large en volume de diff (mécanique, pas conceptuel) : à confirmer
  précisément fichier par fichier en Sprint 2, `NodeEditTarget`/`Selection` (types locaux à
  `StructureTab.tsx`) sont concernés.
- Confirmation de suppression en cascade : nouveau composant `ConfirmDeleteSubtree` (ou extension
  de `ConfirmDelete` existant) affichant "X composants et Y éléments seront supprimés" — le compte
  d'éléments nécessite un appel IPC supplémentaire (cf. §2 note sur `countSubtree`).
- Badge "Interface" (violet, aujourd'hui uniquement sur `RepoRow` via `node.isInterface`) : ajouté
  sur `LocalNodeRow` si `localNode.roles?.length`.
- Édition roles/implements d'un composant local : réutilisation des sections de
  `AddDependencyModal.tsx` (lignes 179-284, "Rôles exposés par ce repo"/"Interfaces implémentées")
  — factorisées dans un sous-composant partagé `RolesImplementsFields` (nouveau, extrait de
  `AddDependencyModal`) pour être monté à la fois dans la popup d'édition d'une dépendance
  (comportement inchangé) et dans une nouvelle popup d'édition d'un composant local (Sprint 3).

## 7. `workspace-tree.service.ts` — dérivation depuis le node `root`

`getInterfaceFlag`/`getImplements` (lignes 469-478) lisent aujourd'hui `s?.roles`/`s?.implements`
(niveau fichier). Remplacés par :

```ts
const getRootNode = (name: string): SystemNode | undefined => {
  const s = schemaCache.get(name)
  return s ? findSystemNode(s.nodes, 'root') : undefined
}
const getInterfaceFlag = (name: string): boolean => {
  const root = getRootNode(name)
  return Array.isArray(root?.roles) && root!.roles!.length > 0
}
const getImplements = (name: string): ImplementsDeclaration[] | undefined => {
  const root = getRootNode(name)
  return root?.implements?.length ? root.implements : undefined
}
```

Comportement inchangé pour le cas repo-séparé (root porte, après migration §4.1, exactement ce
qui était au niveau fichier avant ce ticket).

## 8. `interface-compliance.service.ts` — extension à granularité composant

C'est le changement le plus profond du ticket. Aujourd'hui, `getComplianceMatrix`/`buildMatrix`/
`computeNeedsRevalidation` raisonnent **au niveau repo** : `tree.nodes` (un `WorkspaceTreeNode`
par repo), `node.isInterface`, `node.implements`, `node.repoPath` passé tel quel à
`reqIndex.findAll(repoPath, ...)`/`findAllLinks(repoPath)` (qui retournent TOUTES les exigences/
liens du repo, tous composants confondus).

**Nouveau modèle** : un "composant" pour cette matrice devient une paire `(repoPath, SystemNode)`
au lieu d'un `WorkspaceTreeNode` seul :

```ts
interface ComponentRef {
  repoPath: string
  node: SystemNode        // root, ou un composant local à n'importe quelle profondeur
  displayName: string     // "root" -> nom du repo ; sinon chemin "Parent › Enfant" (cf. §9)
}

private async listAllComponents(tree: WorkspaceTree): Promise<ComponentRef[]> {
  const out: ComponentRef[] = []
  for (const repoNode of tree.nodes) {
    const schema = await this.readSchema(repoNode.repoPath)
    if (!schema) continue
    for (const { node, ancestors } of flattenSystemNodes(schema.nodes)) {
      out.push({ repoPath: repoNode.repoPath, node, displayName: node.name === 'root' ? repoNode.name : [...ancestors.map(a=>a.label||a.name), node.label||node.name].join(' › ') })
    }
  }
  return out
}
```

`getComplianceMatrix` : `for (const comp of components) if (comp.node.roles?.length) buildMatrix(comp, ...)`
au lieu de `for (const node of tree.nodes) if (node.isInterface)`.

`buildMatrix`/`checkComponentCoverage`/`computeNeedsRevalidation` : `comp.node.implements` au lieu
de `node.implements` ; **surtout**, `reqIndex.findAll(comp.repoPath, {status:'approved'})` /
`findAllLinks(comp.repoPath)` retournent aujourd'hui les exigences/liens de **tout le repo** —
il faut désormais filtrer par `req.objectTypeRef` pour ne garder que celles appartenant à
`comp.node` (comparaison sur le nom du node dans l'`objectTypeRef`, `root::...` ou
`nodeName::...`). **Risque identifié** : `reqIndex.findAll`/`findAllLinks` n'ont aujourd'hui pas
de paramètre de filtrage par node — à vérifier en Sprint 4 si un filtrage post-lecture suffit
(volume de requirements par repo généralement faible) ou si `RequirementsIndexService` a besoin
d'un paramètre `nodeName` pour éviter de tout charger puis filtrer. Documenté comme point ouvert
de Sprint 4, pas résolu ici pour ne pas geler une décision qui dépend du volume réel observé.

## 9. Renderer — `SystemViewContext.tsx` / `useWorkspaceStructure.ts`

- `componentOptions` (lignes 223-235) : remplacé par un usage de `flattenSystemNodes` par repo,
  avec label = chemin `›` des `ancestors` + le nœud lui-même (`root` continue de n'afficher que le
  nom du repo, cf. décision validée — aucun changement pour le cas non imbriqué).
- `effectiveNode`/`nodes.find(...)` (lignes 248-256) : remplacé par `findSystemNode(nodes, selectedNodeId)`.
- `allPrefixes` (`useWorkspaceStructure.ts:80-87`) : boucle `for (const n of schema.nodes)` →
  `for (const { node } of flattenSystemNodes(schema.nodes))`.

## 10. Découpage en sprints

Le volume (nouveau module partagé, migration de données, ~10 fichiers touchés dont un service de
conformité interface substantiellement réécrit) dépasse un seul sprint — découpage en 4, chacun
livrable et vérifiable indépendamment (pas de sprint qui casse la compilation ou régresse un
comportement existant en fin de sprint) :

- **Sprint 1 — Fondation (modèle de données + résolution récursive)**. `schema-tree.ts` (nouveau),
  `schema.ts` (`children`/`roles`/`implements` sur `SystemNode`), `schema.service.ts` (migration,
  `addNode`+`parentName`, `requireNode`/`findNodeUsingPrefix` récursifs), `schema-lookup.util.ts`
  (`findObjectTypeDef` récursif), MCP `add_component`+`parentName`. Aucun changement UI visible —
  vérifiable via le tool MCP (`add_component` avec `parentName`) et inspection du `schema.yaml`
  résultant. Régression : `add_object_type`/`add_field`/`add_status` continuent de fonctionner
  sur un composant local non imbriqué (comportement T113 préservé).
- **Sprint 2 — UI Structure : imbrication**. `StructureTab.tsx` (rendu récursif, "+ Composant
  local", suppression en cascade + confirmation), migration `nodeIndex` → nom de nœud dans les
  signatures locales, `useWorkspaceStructure.ts` (`allPrefixes` récursif).
- **Sprint 3 — Interfaces sur SystemNode**. `workspace-tree.service.ts` (dérivation depuis
  `root`), badge Interface par composant local, `RolesImplementsFields` extrait et réutilisé pour
  l'édition d'un composant local, `SystemViewContext.tsx` (combobox en chemin `›`).
- **Sprint 4 (final) — Matrice de conformité + non-régression + SPEC**.
  `interface-compliance.service.ts` étendu (§8, avec le point ouvert sur le filtrage par node à
  trancher selon investigation), vérification de bout en bout éléments/liens/rôles sur composant
  local imbriqué, mise à jour de `SPEC-TEMPLATES.md`/`SPEC-SYSTEM-VIEW.md`/`SPEC-MCP-SERVER.md`/
  `SPEC-INDEX.md` (colonne MAJ), archive du ticket.

## 11. Alternatives rejetées

- **`SystemNode.parentName?: string` (référence arrière, tableau resté plat)** plutôt que
  `children?: SystemNode[]` (arbre) : rejeté — un tableau plat avec back-reference oblige à
  reconstruire l'arbre à chaque lecture pour tout ce qui affiche une hiérarchie (Structure,
  combobox), alors qu'un `schema.yaml` où l'imbrication est visuellement représentée par
  l'indentation YAML native (`children:` sous chaque nœud) est plus lisible à la main et
  correspond exactement au pattern déjà choisi pour `WorkspaceTreeNode.children` — cohérence avec
  l'existant plutôt qu'introduire un 2e style de modélisation d'arbre dans la même base de code.
- **`objectTypeRef` en chemin complet (`a/b::type`)** plutôt que nom simple unique projet-wide :
  rejeté par décision utilisateur (cf. spec §Décisions #1) — impact bien plus large
  (`schema-lookup.util.ts`, `requirements.service.ts`, `tests.service.ts`,
  `bulk-import-validation.util.ts`) pour un bénéfice (permettre des noms dupliqués sous des
  parents différents) jugé non prioritaire.
- **Dupliquer `roles`/`implements` (garder le niveau fichier pour `root`, ajouter un mécanisme
  séparé pour les composants locaux)** : rejeté par décision utilisateur (cf. spec §Décisions #4)
  — moins cohérent avec "un composant est un composant", et duplique la logique de résolution
  (`getInterfaceFlag`, matrice de conformité) pour deux représentations du même concept.
