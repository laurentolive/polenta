import { z } from 'zod'
import { flattenSystemNodes, type ProjectSchema, type TypeTreeNode } from '@polenta/types'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { errorToolResult, jsonToolResult } from '../mcp-types'
import { assertWritableBranch } from './suivi-common'
import { readOwnedTypeDef } from '../../main/services/field-write.util'
import { isRefInReadonlyNode } from '../../main/services/schema-lookup.util'
import { readAppLock, withTreeWriteLock, TreeLockedError, type TreeLockInfo } from '../../main/services/tree-lock.util'
import {
  TreeOpError, deleteFolder, ensureFolder, findFolder, joinPath, moveFolder, moveObject, parseFolderPath,
  renameFolder, reorderChildren, toEntries, type OrderEntry,
} from '../../main/services/tree-ops.util'

/**
 * GH361 — rangement en dossiers des exigences, tests et issues (`.polenta/trees/<nœud>/<type>.yaml`) :
 * `get_tree`, `create_folders`, `rename_folder`, `move_folder`, `delete_folders`, `move_to_folder`,
 * `reorder_tree`. specs/GH361.md, specs/GH361-design.md §4.
 *
 * Les dossiers sont désignés par chemin (`A/B`). Écritures : `dryRun` par défaut, entrées traitées
 * dans l'ordre (une entrée en erreur n'empêche pas les autres, et ne laisse aucun effet), une seule
 * écriture du fichier, sous verrou (`tree-lock.util.ts`) : refusées (`TREE_LOCKED`) tant que
 * l'application affiche ce rangement.
 */

type ToolResult = ReturnType<typeof jsonToolResult> | ReturnType<typeof errorToolResult>

const SUPPORTED = new Set(['requirement', 'test', 'issue'])

/** Erreur d'appel attendue (`[CODE] message`), renvoyée telle quelle à l'agent. */
class TreeToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export interface TreeTarget {
  objectTypeRef: string
  /** Repo qui porte le fichier d'arbre (repo du composant pour un type de composant en repo séparé). */
  repoPath: string
  nodeId: string
  typeId: string
}

export interface TreeLayout {
  placed: TypeTreeNode[]
  unclassified: Array<{ id: string; title: string }>
  objects: Array<{ id: string; title: string }>
}

/** Résout l'arbre qu'affiche l'application pour ce type. */
export async function resolveTreeTarget(c: McpContainer, objectTypeRef: string): Promise<TreeTarget> {
  const owner = (await c.schema.resolveComponentRepoPath(c.repoPath, objectTypeRef, c.workspaceDir)) ?? c.repoPath
  const typeDef = await readOwnedTypeDef(c.git, c.repoPath, objectTypeRef, owner)
  if (!typeDef) throw new TreeToolError('TYPE_NOT_FOUND', `Type inconnu : ${objectTypeRef} (cf. get_schema).`)
  if (!SUPPORTED.has(typeDef.category)) {
    throw new TreeToolError('TYPE_NOT_SUPPORTED', `Rangement en dossiers disponible pour les exigences, tests et issues seulement (${objectTypeRef} : ${typeDef.category}).`)
  }
  const [prefix] = objectTypeRef.split('::')
  const typeId = typeDef.name
  let nodeId = objectTypeRef.includes('::') ? prefix : 'root'
  if (owner !== c.repoPath) {
    // Composant en repo séparé : l'application ouvre l'arbre du nœud de SON schéma qui porte le type.
    const schema = await c.git.readYaml<ProjectSchema>(owner, '.polenta/schema.yaml').catch(() => null)
    nodeId = flattenSystemNodes(schema?.nodes ?? []).find(f => f.node.objectTypes?.some(t => t.name === typeId))?.node.name ?? 'root'
  }
  return { objectTypeRef, repoPath: owner, nodeId, typeId }
}

async function assertWritable(c: McpContainer, t: TreeTarget): Promise<void> {
  const branch = await assertWritableBranch(c)
  if (branch) throw new TreeToolError('READONLY_BRANCH', branch.content[0].text.replace(/^\[READONLY_BRANCH\] /, ''))
  const schema = await c.schema.get(c.repoPath)
  if (isRefInReadonlyNode(schema, t.objectTypeRef) || await c.versions.isReadonly(t.repoPath, c.workspaceDir)) {
    throw new TreeToolError('READONLY_REPO', `Le rangement de ${t.objectTypeRef} est en lecture seule.`)
  }
}

/** Ce process n'a pas de watcher : relit les objets du repo à chaque appel. */
function freshen(c: McpContainer, repoPath: string): void {
  c.reqIndex.invalidate(repoPath)
  c.testsIndex.invalidate(repoPath)
  c.issues.invalidate(repoPath)
}

export async function readTreeLayout(c: McpContainer, t: TreeTarget): Promise<TreeLayout> {
  freshen(c, t.repoPath)
  return c.tree.readLayout(t.repoPath, t.nodeId, t.typeId)
}

export interface Mutation<R> { root: TypeTreeNode[]; changed: boolean; result: R }

/**
 * Lit le rangement, applique `apply`, et l'écrit sous verrou si quelque chose a changé ; en
 * `dryRun`, n'écrit rien et signale le verrou de l'application (`locked`).
 */
export async function mutateTree<R>(
  c: McpContainer, t: TreeTarget, dryRun: boolean, apply: (layout: TreeLayout) => Mutation<R>,
): Promise<{ result: R; locked: TreeLockInfo | null }> {
  if (dryRun) {
    const out = apply(await readTreeLayout(c, t))
    return { result: out.result, locked: await readAppLock(t.repoPath, t.nodeId, t.typeId) }
  }
  await assertWritable(c, t)
  return withTreeWriteLock(t.repoPath, t.nodeId, t.typeId, async () => {
    const out = apply(await readTreeLayout(c, t))
    if (out.changed) await c.tree.save(t.repoPath, { nodeId: t.nodeId, typeId: t.typeId, root: out.root })
    return { result: out.result, locked: null }
  })
}

/** Applique `step` à chaque entrée : sans effet si elle échoue (erreur `TreeOpError` reportée). */
function eachEntry<E>(
  root: TypeTreeNode[], entries: E[],
  step: (root: TypeTreeNode[], entry: E, index: number) => { root: TypeTreeNode[]; changed: boolean },
  onError: (index: number, entry: E, reason: string) => void,
): { root: TypeTreeNode[]; changed: boolean } {
  let changed = false
  entries.forEach((entry, index) => {
    try {
      const out = step(root, entry, index)
      root = out.root
      changed ||= out.changed
    } catch (err) {
      if (!(err instanceof TreeOpError)) throw err
      onError(index, entry, err.reason)
    }
  })
  return { root, changed }
}

/** Erreur d'appel → résultat MCP ; toute autre erreur remonte (SPEC-MCP-SERVER §6). */
async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run()
  } catch (err) {
    return errorToolResult(expectedReason(err))
  }
}

/** `[CODE] message` d'une erreur attendue (appel ou entrée) ; toute autre erreur remonte. */
function expectedReason(err: unknown): string {
  if (err instanceof TreeToolError) return `[${err.code}] ${err.message}`
  if (err instanceof TreeLockedError) return `[TREE_LOCKED] ${err.message}`
  if (err instanceof TreeOpError) return err.reason
  throw err
}

// ── Champ `folder` de bulk_import_requirements / bulk_import_tests (design §4.6) ──

export interface BulkFolderEntry { index: number; objectTypeRef: string; folder: string }

/**
 * Contrôle les chemins `folder` d'un import, avant toute création : erreurs par entrée (chemin
 * invalide, dossier ambigu, type sans rangement) et, par type, dossiers qui seraient créés et
 * verrou de l'application.
 */
export async function planBulkFolders(c: McpContainer, entries: BulkFolderEntry[]): Promise<{
  errors: Map<number, string>
  folders: Array<{ objectTypeRef: string; toCreate: string[]; locked: TreeLockInfo | null }>
}> {
  const errors = new Map<number, string>()
  const folders: Array<{ objectTypeRef: string; toCreate: string[]; locked: TreeLockInfo | null }> = []
  for (const [ref, group] of groupByRef(entries)) {
    let t: TreeTarget
    let root: TypeTreeNode[]
    try {
      t = await resolveTreeTarget(c, ref)
      root = (await readTreeLayout(c, t)).placed
    } catch (err) {
      const reason = expectedReason(err)
      for (const e of group) errors.set(e.index, reason)
      continue
    }
    const toCreate: string[] = []
    for (const e of group) {
      try {
        const out = ensureFolder(root, parseFolderPath(e.folder), () => 'planned')
        root = out.root
        toCreate.push(...out.created)
      } catch (err) {
        errors.set(e.index, expectedReason(err))
      }
    }
    folders.push({ objectTypeRef: ref, toCreate, locked: await readAppLock(t.repoPath, t.nodeId, t.typeId) })
  }
  return { errors, folders }
}

/**
 * Range les objets créés par un import dans leur dossier : une écriture par type. Un échec laisse
 * l'objet créé et non classé : `FOLDER_PLACEMENT_FAILED: <cause>` par entrée.
 */
export async function placeBulkFolders(
  c: McpContainer, placed: Array<BulkFolderEntry & { id: string }>,
): Promise<Array<{ index: number; reason: string }>> {
  const errors: Array<{ index: number; reason: string }> = []
  const fail = (index: number, reason: string) => errors.push({ index, reason: `FOLDER_PLACEMENT_FAILED: ${reason}` })
  for (const [ref, group] of groupByRef(placed)) {
    try {
      const t = await resolveTreeTarget(c, ref)
      await mutateTree(c, t, false, (layout) => ({
        ...eachEntry(layout.placed, group, (root, e) => {
          const out = ensureFolder(root, parseFolderPath(e.folder), () => c.tree.generateId())
          const moved = moveObject(out.root, e.id, out.folderId, () => c.tree.generateId())
          return { root: moved.root, changed: true }
        }, (_i, e, reason) => fail(e.index, reason)),
        result: null,
      }))
    } catch (err) {
      const reason = expectedReason(err)
      for (const e of group) fail(e.index, reason)
    }
  }
  return errors
}

function groupByRef<E extends { objectTypeRef: string }>(entries: E[]): Map<string, E[]> {
  const out = new Map<string, E[]>()
  for (const e of entries) out.set(e.objectTypeRef, [...(out.get(e.objectTypeRef) ?? []), e])
  return out
}

const refSchema = z.string().min(1).describe('Type d’objet `<nœud>::<type>` (exigence, test ou issue ; cf. get_schema)')
const dryRunSchema = z.boolean().optional().default(true).describe('true (défaut) : aperçu, rien n’est écrit')
const LOCK_NOTE =
  ' Écriture refusée (TREE_LOCKED) tant que l’application Polenta affiche ce rangement : demander alors ' +
  'à l’utilisateur d’afficher un autre type ou un autre onglet, puis réessayer. Ne jamais éditer .polenta/trees/ à la main.'

export function registerTreeTools(server: McpServer, c: McpContainer): void {
  const genId = () => c.tree.generateId()

  server.registerTool(
    'get_tree',
    {
      title: 'Get tree',
      description:
        'Rangement en dossiers d’un type d’exigence, de test ou d’issue, tel que l’affiche l’application : ' +
        'dossiers (name, path « A/B » à réutiliser dans les autres outils ; path null = non désignable), ' +
        'objets rangés (id, title), et objets non classés (unclassified). locked : l’application affiche ce ' +
        'rangement, les écritures sont refusées.',
      inputSchema: { objectTypeRef: refSchema },
    },
    async ({ objectTypeRef }) => guarded(async () => {
      const t = await resolveTreeTarget(c, objectTypeRef)
      const layout = await readTreeLayout(c, t)
      const titles = new Map(layout.objects.map(o => [o.id, o.title]))
      return jsonToolResult({
        objectTypeRef,
        locked: await readAppLock(t.repoPath, t.nodeId, t.typeId),
        root: toEntries(layout.placed, titles),
        unclassified: layout.unclassified,
      })
    }),
  )

  server.registerTool(
    'create_folders',
    {
      title: 'Create folders',
      description:
        'Crée des dossiers par chemin (« Sécurité/Batterie ») ; les dossiers intermédiaires manquants sont créés, ' +
        'les existants réutilisés (un chemin existant n’est pas une erreur). Nouveau dossier : à la fin de son parent.' + LOCK_NOTE,
      inputSchema: { objectTypeRef: refSchema, paths: z.array(z.string()).min(1), dryRun: dryRunSchema },
    },
    async ({ objectTypeRef, paths, dryRun = true }) => guarded(async () => {
      const t = await resolveTreeTarget(c, objectTypeRef)
      const created: string[] = []
      const existing: string[] = []
      const errors: Array<{ index: number; path: string; reason: string }> = []
      const { result, locked } = await mutateTree(c, t, dryRun, (layout) => ({
        ...eachEntry(layout.placed, paths, (root, path) => {
          const segments = parseFolderPath(path)
          const out = ensureFolder(root, segments, genId)
          if (out.created.length > 0) created.push(...out.created)
          else existing.push(joinPath(segments))
          return { root: out.root, changed: out.created.length > 0 }
        }, (index, path, reason) => errors.push({ index, path, reason })),
        result: { created, existing, errors },
      }))
      return jsonToolResult({ dryRun, ...(dryRun && { locked }), ...result })
    }),
  )

  server.registerTool(
    'rename_folder',
    {
      title: 'Rename folder',
      description:
        'Renomme des dossiers (path → name, nom sans « / ») ; contenu et position inchangés. Refus si un dossier ' +
        'voisin porte déjà ce nom (FOLDER_EXISTS). Les entrées suivantes voient le nouveau chemin.' + LOCK_NOTE,
      inputSchema: {
        objectTypeRef: refSchema,
        renames: z.array(z.object({ path: z.string(), name: z.string() })).min(1),
        dryRun: dryRunSchema,
      },
    },
    async ({ objectTypeRef, renames, dryRun = true }) => guarded(async () => {
      const t = await resolveTreeTarget(c, objectTypeRef)
      const renamed: Array<{ from: string; to: string }> = []
      const unchanged: string[] = []
      const errors: Array<{ index: number; path: string; reason: string }> = []
      const { result, locked } = await mutateTree(c, t, dryRun, (layout) => ({
        ...eachEntry(layout.placed, renames, (root, { path, name }) => {
          const segments = parseFolderPath(path)
          const out = renameFolder(root, segments, name)
          if (out.changed) renamed.push({ from: joinPath(segments), to: out.to })
          else unchanged.push(joinPath(segments))
          return out
        }, (index, { path }, reason) => errors.push({ index, path, reason })),
        result: { renamed, unchanged, errors },
      }))
      return jsonToolResult({ dryRun, ...(dryRun && { locked }), ...result })
    }),
  )

  server.registerTool(
    'move_folder',
    {
      title: 'Move folder',
      description:
        'Déplace des dossiers, avec leur contenu, à la fin du dossier parent (chemin ; null = racine). Refus : ' +
        'dans lui-même ou un sous-dossier (FOLDER_CYCLE), homonyme dans le parent (FOLDER_EXISTS).' + LOCK_NOTE,
      inputSchema: {
        objectTypeRef: refSchema,
        moves: z.array(z.object({ path: z.string(), parent: z.string().nullable() })).min(1),
        dryRun: dryRunSchema,
      },
    },
    async ({ objectTypeRef, moves, dryRun = true }) => guarded(async () => {
      const t = await resolveTreeTarget(c, objectTypeRef)
      const moved: Array<{ from: string; to: string }> = []
      const unchanged: string[] = []
      const errors: Array<{ index: number; path: string; reason: string }> = []
      const { result, locked } = await mutateTree(c, t, dryRun, (layout) => ({
        ...eachEntry(layout.placed, moves, (root, { path, parent }) => {
          const segments = parseFolderPath(path)
          const out = moveFolder(root, segments, parent === null ? null : parseFolderPath(parent))
          if (out.changed) moved.push({ from: joinPath(segments), to: out.to })
          else unchanged.push(joinPath(segments))
          return out
        }, (index, { path }, reason) => errors.push({ index, path, reason })),
        result: { moved, unchanged, errors },
      }))
      return jsonToolResult({ dryRun, ...(dryRun && { locked }), ...result })
    }),
  )

  server.registerTool(
    'delete_folders',
    {
      title: 'Delete folders',
      description:
        'Supprime des dossiers. Dossier non vide : refusé (FOLDER_NOT_EMPTY) sauf recursive: true — le dossier et ses ' +
        'sous-dossiers sont supprimés, les objets qu’ils contenaient redeviennent non classés (unclassified). Aucun objet ' +
        'n’est jamais supprimé.' + LOCK_NOTE,
      inputSchema: {
        objectTypeRef: refSchema,
        paths: z.array(z.string()).min(1),
        recursive: z.boolean().optional().default(false),
        dryRun: dryRunSchema,
      },
    },
    async ({ objectTypeRef, paths, recursive = false, dryRun = true }) => guarded(async () => {
      const t = await resolveTreeTarget(c, objectTypeRef)
      const deleted: string[] = []
      const freed = new Set<string>()
      const errors: Array<{ index: number; path: string; reason: string }> = []
      const { result, locked } = await mutateTree(c, t, dryRun, (layout) => ({
        ...eachEntry(layout.placed, paths, (root, path) => {
          const segments = parseFolderPath(path)
          const out = deleteFolder(root, segments, recursive)
          deleted.push(joinPath(segments))
          for (const id of out.freed) freed.add(id)
          return { root: out.root, changed: true }
        }, (index, path, reason) => errors.push({ index, path, reason })),
        result: { deleted, unclassified: [...freed].sort(), errors },
      }))
      return jsonToolResult({ dryRun, ...(dryRun && { locked }), ...result })
    }),
  )

  server.registerTool(
    'move_to_folder',
    {
      title: 'Move objects to folder',
      description:
        'Range des objets existants du type (id) dans un dossier (chemin), à la fin, avec leurs sous-éléments ; ' +
        'folder: null les remet en non classé. createMissing (défaut true) crée le dossier cible s’il manque. ' +
        'Objet rangé à plusieurs endroits : OBJECT_AMBIGUOUS. Pour placer un objet à une position précise : reorder_tree.' + LOCK_NOTE,
      inputSchema: {
        objectTypeRef: refSchema,
        moves: z.array(z.object({ id: z.string().min(1), folder: z.string().nullable() })).min(1),
        createMissing: z.boolean().optional().default(true),
        dryRun: dryRunSchema,
      },
    },
    async ({ objectTypeRef, moves, createMissing = true, dryRun = true }) => guarded(async () => {
      const t = await resolveTreeTarget(c, objectTypeRef)
      const moved: Array<{ id: string; folder: string | null }> = []
      const unchanged: string[] = []
      const createdFolders: string[] = []
      const errors: Array<{ index: number; id: string; reason: string }> = []
      const { result, locked } = await mutateTree(c, t, dryRun, (layout) => {
        const known = new Set(layout.objects.map(o => o.id))
        return {
          ...eachEntry(layout.placed, moves, (root, { id, folder }) => {
            if (!known.has(id)) throw new TreeOpError('OBJECT_NOT_FOUND', `${id} n'existe pas ou n'est pas du type ${objectTypeRef}.`)
            let target: string | null = null
            let created: string[] = []
            if (folder !== null) {
              const segments = parseFolderPath(folder)
              if (createMissing) {
                const out = ensureFolder(root, segments, genId)
                root = out.root
                target = out.folderId
                created = out.created
              } else {
                target = findFolder(root, segments).id
              }
            }
            const out = moveObject(root, id, target, genId)
            createdFolders.push(...created)
            if (out.changed) moved.push({ id, folder: folder === null ? null : joinPath(parseFolderPath(folder)) })
            else unchanged.push(id)
            return { root: out.root, changed: out.changed || created.length > 0 }
          }, (index, { id }, reason) => errors.push({ index, id, reason })),
          result: { moved, unchanged, createdFolders, errors },
        }
      })
      return jsonToolResult({ dryRun, ...(dryRun && { locked }), ...result })
    }),
  )

  server.registerTool(
    'reorder_tree',
    {
      title: 'Reorder tree',
      description:
        'Réordonne les enfants directs d’un dossier (chemin ; null = racine). order cite des dossiers ({ folder: nom }) ' +
        'et des objets ({ id }) : placés en tête dans cet ordre, les autres suivent dans leur ordre actuel. À la racine, ' +
        'un objet non classé peut être cité (il devient rangé à cette position). Erreur (NOT_A_CHILD, DUPLICATE_ENTRY…) : ' +
        'rien n’est modifié.' + LOCK_NOTE,
      inputSchema: {
        objectTypeRef: refSchema,
        folder: z.string().nullable(),
        order: z.array(z.union([z.object({ folder: z.string() }).strict(), z.object({ id: z.string() }).strict()])).min(1),
        dryRun: dryRunSchema,
      },
    },
    async ({ objectTypeRef, folder, order, dryRun = true }) => guarded(async () => {
      const t = await resolveTreeTarget(c, objectTypeRef)
      const errors: Array<{ reason: string }> = []
      const { result, locked } = await mutateTree(c, t, dryRun, (layout) => {
        const unclassified = new Set(layout.unclassified.map(o => o.id))
        const titles = new Map(layout.objects.map(o => [o.id, o.title]))
        const segments = folder === null ? null : parseFolderPath(folder)
        const out = eachEntry(layout.placed, [order as OrderEntry[]], (root, entries) =>
          reorderChildren(root, segments, entries, genId, id => unclassified.has(id)),
        (_i, _e, reason) => errors.push({ reason }))
        const children = segments === null ? out.root : findFolder(out.root, segments).children
        return {
          ...out,
          result: {
            order: toEntries(children.map(n => ({ ...n, children: [] })), titles, segments ? joinPath(segments) : ''),
            errors,
          },
        }
      })
      return jsonToolResult({ dryRun, ...(dryRun && { locked }), ...result })
    }),
  )
}
