import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { randomUUID } from 'crypto'
import type { TypeTree, TypeTreeNode } from '@polenta/types'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'

/**
 * GH180 — objets (id + titre) d'un type `<nœud>::<type>` d'un repo. L'inventaire d'un type vient
 * des fichiers objets (index), plus du fichier d'arbre : celui-ci ne garde que le rangement curaté.
 */
export type TreeObjectLister = (repoPath: string, objectTypeRef: string) => Promise<Array<{ id: string; title: string }>>

/** Lister branché sur les index exigences + tests (un type est de l'une ou l'autre catégorie). */
export function indexObjectLister(reqIndex: RequirementsIndexService, testsIndex: TestsIndexService): TreeObjectLister {
  return async (repoPath, objectTypeRef) => [
    ...(await reqIndex.findAll(repoPath, { type: objectTypeRef })),
    ...(await testsIndex.findAll(repoPath)).filter(t => t.objectTypeRef === objectTypeRef),
  ]
}

export class TreeService {
  /**
   * Sans `listObjects` (tests unitaires), le service est un simple stockage : `get`/`save` lisent
   * et écrivent le fichier tel quel, sans compléter ni dépouiller l'arbre (GH180).
   */
  constructor(private readonly listObjects?: TreeObjectLister) {}

  // ── Read ─────────────────────────────────────────────────────────────────────

  /**
   * GH180 — arbre d'affichage complet : le rangement stocké, avec le `name` de chaque élément lu
   * depuis le `title` de son objet, suivi des objets du type absents du fichier (« non classés »),
   * triés par ID en fin de racine. Créer un objet n'a donc plus besoin d'écrire dans l'arbre.
   */
  async get(repoPath: string, nodeId: string, typeId: string): Promise<TypeTree> {
    const stored = await this.readStored(repoPath, nodeId, typeId)
    if (!this.listObjects) return stored
    try {
      const objects = await this.listObjects(repoPath, `${nodeId}::${typeId}`)
      return { ...stored, root: hydrateTree(stored.root, objects) }
    } catch (err) {
      console.error(`[TreeService] Could not list objects for ${nodeId}::${typeId}:`, err)
      return stored
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────────

  /**
   * GH180 — n'écrit que le rangement curaté (`stripTree`) : ni le `name` des éléments, ni la queue
   * « non classée » que `get` reconstruit. Un arbre dont il ne reste rien n'est pas créé sur disque.
   */
  async save(repoPath: string, tree: TypeTree): Promise<void> {
    const root = this.listObjects ? stripTree(tree.root) : tree.root
    if (root.length === 0 && !(await this.exists(repoPath, tree.nodeId, tree.typeId))) return
    await this.writeStored(repoPath, { nodeId: tree.nodeId, typeId: tree.typeId, root })
  }

  /**
   * Moves the display-order file for one (node, type) pair to a different node (T135 sprint 3 —
   * an element dragged onto another node in the Structure tab). Without this, the curated
   * folder/order tree a user built for that type (Vue Système) would be silently orphaned at the
   * old node/type path — the type itself moved, but its saved layout wouldn't follow it, and the
   * new node/type location would start from an empty tree (`get()`'s fallback for a missing file)
   * as if the user had never organized anything.
   *
   * No-op if `fromNodeId === toNodeId` or if the old file never existed/was already empty (an
   * empty tree carries no user-authored ordering worth moving). Best-effort: a failure here is
   * logged, not thrown — losing the curated order is a UX regression, not the kind of data-loss
   * `objectTypeRef` correctness demands, so it must never block the rest of an element move.
   */
  async moveTypeTree(repoPath: string, fromNodeId: string, toNodeId: string, typeId: string): Promise<void> {
    if (fromNodeId === toNodeId) return
    try {
      const existing = await this.readStored(repoPath, fromNodeId, typeId)
      if (existing.root.length > 0) {
        await this.writeStored(repoPath, { nodeId: toNodeId, typeId, root: existing.root })
      }
      await fs.unlink(this.treePath(repoPath, fromNodeId, typeId)).catch(() => {})
    } catch (err) {
      console.error(`[TreeService] Could not move display order for ${typeId} from ${fromNodeId} to ${toNodeId}:`, err)
    }
  }

  /**
   * GH100 — le type `fromTypeId` du nœud `nodeId` a été renommé `toTypeId` : son fichier d'ordre le
   * suit (sinon `get()` repartirait d'un arbre vide sous le nouveau nom). Même règles que
   * `moveTypeTree` : no-op si rien à déplacer, au mieux (journalisé, jamais levé).
   */
  async renameTypeTree(repoPath: string, nodeId: string, fromTypeId: string, toTypeId: string): Promise<void> {
    if (fromTypeId === toTypeId) return
    try {
      const existing = await this.readStored(repoPath, nodeId, fromTypeId)
      if (existing.root.length > 0) {
        await this.writeStored(repoPath, { nodeId, typeId: toTypeId, root: existing.root })
      }
      await fs.unlink(this.treePath(repoPath, nodeId, fromTypeId)).catch(() => {})
    } catch (err) {
      console.error(`[TreeService] Could not rename display order ${nodeId}/${fromTypeId} to ${toTypeId}:`, err)
    }
  }

  /**
   * GH104 — le type `typeId` du nœud `nodeId` est supprimé : son fichier d'ordre aussi, et le
   * dossier du nœud s'il ne contient plus rien. Absent → rien. Au mieux (journalisé, jamais levé),
   * comme `moveTypeTree`.
   */
  async deleteTypeTree(repoPath: string, nodeId: string, typeId: string): Promise<void> {
    const file = this.treePath(repoPath, nodeId, typeId)
    try {
      await fs.rm(file, { force: true })
      // rmdir échoue sur un dossier non vide (autre type du nœud) : voulu.
      await fs.rmdir(path.dirname(file)).catch(() => {})
    } catch (err) {
      console.error(`[TreeService] Could not delete display order ${nodeId}/${typeId}:`, err)
    }
  }

  // ── ID generation ─────────────────────────────────────────────────────────────

  generateId(): string {
    return randomUUID()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** Fichier d'arbre tel que stocké (rangement curaté seul, sans complétion GH180). */
  private async readStored(repoPath: string, nodeId: string, typeId: string): Promise<TypeTree> {
    try {
      const raw = await fs.readFile(this.treePath(repoPath, nodeId, typeId), 'utf-8')
      const parsed = yaml.load(raw) as TypeTree
      if (!parsed || !Array.isArray(parsed.root)) {
        return this.empty(nodeId, typeId)
      }
      return parsed
    } catch {
      return this.empty(nodeId, typeId)
    }
  }

  private async writeStored(repoPath: string, tree: TypeTree): Promise<void> {
    const filePath = this.treePath(repoPath, tree.nodeId, tree.typeId)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, yaml.dump(tree, { lineWidth: 120 }), 'utf-8')
  }

  private async exists(repoPath: string, nodeId: string, typeId: string): Promise<boolean> {
    return fs.access(this.treePath(repoPath, nodeId, typeId)).then(() => true, () => false)
  }

  private treePath(repoPath: string, nodeId: string, typeId: string): string {
    return path.join(repoPath, '.polenta', 'trees', nodeId, `${typeId}.yaml`)
  }

  private empty(nodeId: string, typeId: string): TypeTree {
    return { nodeId, typeId, root: [] }
  }
}

// ── GH180 — stockage minimal / arbre d'affichage ───────────────────────────────

const byId = (a: string, b: string) => a.localeCompare(b)

/**
 * Arbre stocké → arbre d'affichage. Le `name` d'un élément est le `title` de son objet (repli sur
 * le `name` encore présent dans un ancien fichier, puis sur l'ID pour un objet disparu). Les objets
 * absents de l'arbre suivent en fin de racine, triés par ID, avec un id de nœud stable
 * (`item-<ID>`) pour que deux lectures successives donnent le même arbre.
 */
export function hydrateTree(root: TypeTreeNode[], objects: Array<{ id: string; title: string }>): TypeTreeNode[] {
  const titles = new Map(objects.map(o => [o.id, o.title]))
  const placed = new Set(flattenTree(root).map(n => n.objectId).filter((id): id is string => !!id))
  const named = (nodes: TypeTreeNode[]): TypeTreeNode[] => nodes.map(n => ({
    ...n,
    name: n.kind === 'item' && n.objectId ? titles.get(n.objectId) ?? n.name ?? n.objectId : n.name ?? '',
    children: named(n.children ?? []),
  }))
  const unclassified: TypeTreeNode[] = objects
    .filter(o => !placed.has(o.id))
    .sort((a, b) => byId(a.id, b.id))
    .map(o => ({ id: `item-${o.id}`, kind: 'item', name: o.title, objectId: o.id, children: [] }))
  return [...named(root), ...unclassified]
}

/**
 * Arbre d'affichage → ce qui est stocké. Retire le `name` des éléments liés à un objet (le titre
 * fait foi) et la queue de racine que `hydrateTree` reconstruirait à l'identique : éléments sans
 * enfant, présents une seule fois dans l'arbre, en ordre d'ID strictement croissant. Ajouter un
 * objet en fin de liste ne modifie donc pas le fichier ; seul un vrai rangement l'écrit.
 */
export function stripTree(root: TypeTreeNode[]): TypeTreeNode[] {
  const counts = new Map<string, number>()
  for (const n of flattenTree(root)) if (n.objectId) counts.set(n.objectId, (counts.get(n.objectId) ?? 0) + 1)

  let cut = root.length
  while (cut > 0) {
    const n = root[cut - 1]
    if (n.kind !== 'item' || !n.objectId || n.children.length > 0 || counts.get(n.objectId) !== 1) break
    if (cut < root.length && byId(n.objectId, root[cut].objectId!) >= 0) break
    cut--
  }

  const bare = (nodes: TypeTreeNode[]): TypeTreeNode[] => nodes.map(n => {
    const children = bare(n.children)
    return n.kind === 'item' && n.objectId
      ? { id: n.id, kind: n.kind, objectId: n.objectId, children } as TypeTreeNode
      : { id: n.id, kind: n.kind, name: n.name, ...(n.objectId ? { objectId: n.objectId } : {}), children }
  })
  return bare(root.slice(0, cut))
}

// ── Pure tree manipulation helpers (shared logic used by IPC handlers) ─────────

export function insertNode(
  root: TypeTreeNode[],
  newNode: TypeTreeNode,
  parentId: string | null,
  afterId: string | null,
): TypeTreeNode[] {
  if (parentId === null) {
    return insertAfter(root, newNode, afterId)
  }
  return root.map(n => {
    if (n.id === parentId) {
      return { ...n, children: insertAfter(n.children, newNode, afterId) }
    }
    return { ...n, children: insertNode(n.children, newNode, parentId, afterId) }
  })
}

function insertAfter(list: TypeTreeNode[], node: TypeTreeNode, afterId: string | null): TypeTreeNode[] {
  if (afterId === null) return [...list, node]
  const idx = list.findIndex(n => n.id === afterId)
  if (idx === -1) return [...list, node]
  const next = [...list]
  next.splice(idx + 1, 0, node)
  return next
}

export function removeNode(root: TypeTreeNode[], id: string): TypeTreeNode[] {
  return root
    .filter(n => n.id !== id)
    .map(n => ({ ...n, children: removeNode(n.children, id) }))
}

export function renameNode(root: TypeTreeNode[], id: string, name: string): TypeTreeNode[] {
  return root.map(n => {
    if (n.id === id) return { ...n, name }
    return { ...n, children: renameNode(n.children, id, name) }
  })
}

export function moveNodes(
  root: TypeTreeNode[],
  ids: string[],
  parentId: string | null,
  afterId: string | null,
): TypeTreeNode[] {
  // Collect nodes to move (preserving tree order)
  const collected: TypeTreeNode[] = []
  function collect(list: TypeTreeNode[]): TypeTreeNode[] {
    const result: TypeTreeNode[] = []
    for (const n of list) {
      if (ids.includes(n.id)) {
        collected.push({ ...n, children: n.children })
      } else {
        result.push({ ...n, children: collect(n.children) })
      }
    }
    return result
  }
  const pruned = collect(root)

  // Insert at destination
  return insertNodes(pruned, collected, parentId, afterId)
}

function insertNodes(
  root: TypeTreeNode[],
  nodes: TypeTreeNode[],
  parentId: string | null,
  afterId: string | null,
): TypeTreeNode[] {
  if (parentId === null) {
    if (afterId === null) return [...root, ...nodes]
    const idx = root.findIndex(n => n.id === afterId)
    if (idx === -1) return [...root, ...nodes]
    const next = [...root]
    next.splice(idx + 1, 0, ...nodes)
    return next
  }
  return root.map(n => {
    if (n.id === parentId) {
      return { ...n, children: insertNodes(n.children, nodes, null, afterId) }
    }
    return { ...n, children: insertNodes(n.children, nodes, parentId, afterId) }
  })
}

export function deepCopyWithNewIds(node: TypeTreeNode): TypeTreeNode {
  return {
    ...node,
    id: randomUUID(),
    objectId: node.kind === 'item' ? randomUUID() : undefined,
    children: node.children.map(deepCopyWithNewIds),
  }
}

export function flattenTree(root: TypeTreeNode[]): TypeTreeNode[] {
  const result: TypeTreeNode[] = []
  function walk(nodes: TypeTreeNode[]) {
    for (const n of nodes) {
      result.push(n)
      walk(n.children)
    }
  }
  walk(root)
  return result
}
