import type { TypeTreeNode } from '@polenta/types'
import { flattenTree, insertNode, removeNode, renameNode } from './tree.service'

/**
 * GH361 — opérations de rangement par chemin de dossier, pures (sans E/S), sur le rangement stocké
 * d'un type (`TreeService.readLayout().placed`). Utilisées par les outils MCP `create_folders`,
 * `rename_folder`, `move_folder`, `delete_folders`, `move_to_folder`, `reorder_tree` et par le champ
 * `folder` de `bulk_import_*`. specs/GH361.md, specs/GH361-design.md §4.3.
 *
 * Un chemin `A/B` ne traverse que des dossiers (jamais un élément) ; deux dossiers frères de même
 * nom le rendent ambigu.
 */

export type TreeOpCode =
  | 'FOLDER_PATH_INVALID' | 'FOLDER_NOT_FOUND' | 'FOLDER_AMBIGUOUS' | 'FOLDER_EXISTS' | 'FOLDER_CYCLE'
  | 'FOLDER_NOT_EMPTY' | 'OBJECT_NOT_FOUND' | 'OBJECT_AMBIGUOUS' | 'NOT_A_CHILD' | 'DUPLICATE_ENTRY'

export class TreeOpError extends Error {
  constructor(readonly code: TreeOpCode, message: string) {
    super(message)
  }
  /** `[CODE] message` — convention d'erreur du serveur MCP (SPEC-MCP-SERVER §6). */
  get reason(): string {
    return `[${this.code}] ${this.message}`
  }
}

export interface TreeEntry {
  kind: 'folder' | 'item'
  /** Dossier : nom ; élément : absent. */
  name?: string
  /** Dossier : chemin, `null` s'il n'est pas désignable (nom avec `/`, sous un élément). */
  path?: string | null
  /** Élément : ID de l'objet. */
  id?: string
  /** Élément : titre courant de l'objet. */
  title?: string
  children: TreeEntry[]
}

export type GenId = () => string

// ── Chemins ────────────────────────────────────────────────────────────────────

/** Segments d'un chemin `A/B`, nettoyés ; `FOLDER_PATH_INVALID` si vide ou segment vide. */
export function parseFolderPath(input: string): string[] {
  const segments = input.split('/').map(s => s.trim())
  if (segments.some(s => s === '')) {
    throw new TreeOpError('FOLDER_PATH_INVALID', `Chemin de dossier invalide : "${input}" (segments séparés par /, aucun vide).`)
  }
  return segments
}

/** Nom de dossier seul (renommage) : non vide, sans `/`. */
export function parseFolderName(input: string): string {
  const name = input.trim()
  if (!name || name.includes('/')) {
    throw new TreeOpError('FOLDER_PATH_INVALID', `Nom de dossier invalide : "${input}" (non vide, sans /).`)
  }
  return name
}

export const joinPath = (segments: string[]) => segments.join('/')

const folderNamed = (list: TypeTreeNode[], name: string) =>
  list.filter(n => n.kind === 'folder' && (n.name ?? '').trim() === name)

/** Dossier désigné par `segments` ; `FOLDER_NOT_FOUND` / `FOLDER_AMBIGUOUS`. */
export function findFolder(root: TypeTreeNode[], segments: string[]): TypeTreeNode {
  let list = root
  let found: TypeTreeNode | undefined
  segments.forEach((segment, i) => {
    const matches = folderNamed(list, segment)
    const at = joinPath(segments.slice(0, i + 1))
    if (matches.length === 0) throw new TreeOpError('FOLDER_NOT_FOUND', `Dossier introuvable : "${at}".`)
    if (matches.length > 1) {
      throw new TreeOpError('FOLDER_AMBIGUOUS', `Plusieurs dossiers "${at}" : à départager dans l'application (renommer l'un d'eux).`)
    }
    found = matches[0]
    list = found.children ?? []
  })
  return found!
}

/** Variante sans exception pour `FOLDER_NOT_FOUND` (les autres erreurs remontent). */
export function tryFindFolder(root: TypeTreeNode[], segments: string[]): TypeTreeNode | null {
  try {
    return findFolder(root, segments)
  } catch (err) {
    if (err instanceof TreeOpError && err.code === 'FOLDER_NOT_FOUND') return null
    throw err
  }
}

// ── Recherche ──────────────────────────────────────────────────────────────────

/** ID du parent d'un nœud (`null` = racine), `undefined` si absent. */
function parentOf(root: TypeTreeNode[], id: string, parent: string | null = null): string | null | undefined {
  for (const n of root) {
    if (n.id === id) return parent
    const inner = parentOf(n.children ?? [], id, n.id)
    if (inner !== undefined) return inner
  }
  return undefined
}

function childrenOf(root: TypeTreeNode[], parentId: string | null): TypeTreeNode[] {
  if (parentId === null) return root
  return flattenTree(root).find(n => n.id === parentId)?.children ?? []
}

function replaceChildren(root: TypeTreeNode[], parentId: string | null, children: TypeTreeNode[]): TypeTreeNode[] {
  if (parentId === null) return children
  return root.map(n => n.id === parentId
    ? { ...n, children }
    : { ...n, children: replaceChildren(n.children ?? [], parentId, children) })
}

const itemsOf = (root: TypeTreeNode[], objectId: string) =>
  flattenTree(root).filter(n => n.kind === 'item' && n.objectId === objectId)

/** Objets ayant au moins un élément dans le rangement. */
export function placedObjectIds(root: TypeTreeNode[]): Set<string> {
  return new Set(flattenTree(root).map(n => n.objectId).filter((id): id is string => !!id))
}

// ── Dossiers ───────────────────────────────────────────────────────────────────

/** Crée les dossiers manquants de `segments`, chacun à la fin de son parent. */
export function ensureFolder(root: TypeTreeNode[], segments: string[], genId: GenId): { root: TypeTreeNode[]; folderId: string; created: string[] } {
  const created: string[] = []
  let parentId: string | null = null
  let list = root
  segments.forEach((segment, i) => {
    const matches = folderNamed(list, segment)
    const at = joinPath(segments.slice(0, i + 1))
    if (matches.length > 1) {
      throw new TreeOpError('FOLDER_AMBIGUOUS', `Plusieurs dossiers "${at}" : à départager dans l'application (renommer l'un d'eux).`)
    }
    if (matches.length === 1) {
      parentId = matches[0].id
      list = matches[0].children ?? []
      return
    }
    const folder: TypeTreeNode = { id: genId(), kind: 'folder', name: segment, children: [] }
    root = insertNode(root, folder, parentId, null)
    created.push(at)
    parentId = folder.id
    list = []
  })
  return { root, folderId: parentId!, created }
}

export function renameFolder(root: TypeTreeNode[], segments: string[], newName: string): { root: TypeTreeNode[]; changed: boolean; to: string } {
  const name = parseFolderName(newName)
  const folder = findFolder(root, segments)
  const to = joinPath([...segments.slice(0, -1), name])
  if ((folder.name ?? '').trim() === name) return { root, changed: false, to }
  const siblings = childrenOf(root, parentOf(root, folder.id) ?? null)
  if (folderNamed(siblings, name).length > 0) throw new TreeOpError('FOLDER_EXISTS', `Un dossier "${to}" existe déjà.`)
  return { root: renameNode(root, folder.id, name), changed: true, to }
}

/** Déplace un dossier (avec son contenu) à la fin de `parentSegments` (`null` = racine). */
export function moveFolder(root: TypeTreeNode[], segments: string[], parentSegments: string[] | null): { root: TypeTreeNode[]; changed: boolean; to: string } {
  const folder = findFolder(root, segments)
  const name = (folder.name ?? '').trim()
  const parent = parentSegments ? findFolder(root, parentSegments) : null
  const to = joinPath([...(parentSegments ?? []), name])
  if (parent && (parent.id === folder.id || flattenTree(folder.children ?? []).some(n => n.id === parent.id))) {
    throw new TreeOpError('FOLDER_CYCLE', `Impossible de déplacer "${joinPath(segments)}" dans lui-même ou un de ses sous-dossiers.`)
  }
  const parentId = parent?.id ?? null
  if (parentOf(root, folder.id) === parentId) return { root, changed: false, to }
  if (folderNamed(childrenOf(root, parentId), name).length > 0) throw new TreeOpError('FOLDER_EXISTS', `Un dossier "${to}" existe déjà.`)
  return { root: insertNode(removeNode(root, folder.id), folder, parentId, null), changed: true, to }
}

/** Supprime un dossier ; `freed` = objets qui n'ont plus aucun élément (redevenus non classés). */
export function deleteFolder(root: TypeTreeNode[], segments: string[], recursive: boolean): { root: TypeTreeNode[]; freed: string[] } {
  const folder = findFolder(root, segments)
  if ((folder.children ?? []).length > 0 && !recursive) {
    throw new TreeOpError('FOLDER_NOT_EMPTY', `Le dossier "${joinPath(segments)}" n'est pas vide (recursive: true pour le supprimer avec son contenu).`)
  }
  const inside = [...placedObjectIds(folder.children ?? [])]
  const next = removeNode(root, folder.id)
  const remaining = placedObjectIds(next)
  return { root: next, freed: inside.filter(id => !remaining.has(id)) }
}

// ── Objets ─────────────────────────────────────────────────────────────────────

/**
 * Range l'objet à la fin du dossier `targetFolderId` (avec ses sous-éléments s'il est déjà rangé),
 * ou le retire du rangement (`null` : ses enfants prennent sa place).
 */
export function moveObject(root: TypeTreeNode[], objectId: string, targetFolderId: string | null, genId: GenId): { root: TypeTreeNode[]; changed: boolean } {
  const items = itemsOf(root, objectId)
  if (items.length > 1) {
    throw new TreeOpError('OBJECT_AMBIGUOUS', `${objectId} est rangé à plusieurs endroits : à départager dans l'application.`)
  }
  const item = items[0]
  if (targetFolderId === null) {
    if (!item) return { root, changed: false }
    const parentId = parentOf(root, item.id) ?? null
    const siblings = childrenOf(root, parentId)
    const lifted = siblings.flatMap(n => (n.id === item.id ? (n.children ?? []) : [n]))
    return { root: replaceChildren(root, parentId, lifted), changed: true }
  }
  if (item && parentOf(root, item.id) === targetFolderId) return { root, changed: false }
  const node: TypeTreeNode = item ?? { id: genId(), kind: 'item', name: '', objectId, children: [] }
  const pruned = item ? removeNode(root, item.id) : root
  return { root: insertNode(pruned, node, targetFolderId, null), changed: true }
}

export type OrderEntry = { folder: string } | { id: string }

/**
 * Réordonne les enfants directs de `segments` (`null` = racine) : les entrées citées en tête, dans
 * l'ordre donné, les autres ensuite dans leur ordre actuel. À la racine, un objet non classé
 * (`isUnclassified`) peut être cité : son élément est créé à la position demandée.
 */
export function reorderChildren(
  root: TypeTreeNode[], segments: string[] | null, order: OrderEntry[], genId: GenId,
  isUnclassified: (objectId: string) => boolean,
): { root: TypeTreeNode[]; changed: boolean } {
  const parentId = segments ? findFolder(root, segments).id : null
  const list = childrenOf(root, parentId)
  const cited: TypeTreeNode[] = []
  const seen = new Set<string>()
  for (const entry of order) {
    const key = 'folder' in entry ? `folder:${entry.folder.trim()}` : `id:${entry.id}`
    if (seen.has(key)) throw new TreeOpError('DUPLICATE_ENTRY', `Entrée citée deux fois : ${key.replace(':', ' ')}.`)
    seen.add(key)
    if ('folder' in entry) {
      const name = entry.folder.trim()
      const matches = folderNamed(list, name)
      if (matches.length === 0) throw new TreeOpError('NOT_A_CHILD', `Dossier "${name}" absent de ce niveau.`)
      if (matches.length > 1) throw new TreeOpError('FOLDER_AMBIGUOUS', `Plusieurs dossiers "${name}" à ce niveau.`)
      cited.push(matches[0])
      continue
    }
    const matches = list.filter(n => n.kind === 'item' && n.objectId === entry.id)
    if (matches.length > 1) throw new TreeOpError('OBJECT_AMBIGUOUS', `${entry.id} est rangé plusieurs fois à ce niveau.`)
    if (matches.length === 1) {
      cited.push(matches[0])
      continue
    }
    if (parentId === null && isUnclassified(entry.id)) {
      cited.push({ id: genId(), kind: 'item', name: '', objectId: entry.id, children: [] })
      continue
    }
    throw new TreeOpError('NOT_A_CHILD', `${entry.id} n'est pas à ce niveau (move_to_folder pour le déplacer).`)
  }
  const citedIds = new Set(cited.map(n => n.id))
  const next = [...cited, ...list.filter(n => !citedIds.has(n.id))]
  const changed = next.length !== list.length || next.some((n, i) => n.id !== list[i].id)
  return { root: changed ? replaceChildren(root, parentId, next) : root, changed }
}

// ── Lecture ────────────────────────────────────────────────────────────────────

/**
 * Rangement → entrées de `get_tree`, avec chemins et titres courants. `basePath` : chemin du dossier
 * dont `root` liste les enfants (`''` = racine du type).
 */
export function toEntries(root: TypeTreeNode[], titles: Map<string, string>, basePath = ''): TreeEntry[] {
  const walk = (nodes: TypeTreeNode[], parentPath: string | null): TreeEntry[] => nodes.map(n => {
    if (n.kind === 'folder') {
      const name = (n.name ?? '').trim()
      const path = parentPath === null || name.includes('/') || name === '' ? null : joinPath(parentPath ? [parentPath, name] : [name])
      return { kind: 'folder', name: n.name ?? '', path, children: walk(n.children ?? [], path) }
    }
    const id = n.objectId ?? ''
    // Sous un élément, un dossier n'est pas désignable par chemin.
    return { kind: 'item', id, title: titles.get(id) ?? n.name ?? id, children: walk(n.children ?? [], null) }
  })
  return walk(root, basePath)
}
