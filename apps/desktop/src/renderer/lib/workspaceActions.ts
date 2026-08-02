import { api } from '../api'
import type { PolentaRepoDependency, PolentaRepoManifest, ImplementsDeclaration, WorkspaceOpenResult, WorkspaceTreeNode } from '@polenta/types'
import { findSystemNode, mapSystemNode, reorderByKey } from '@polenta/types'

/** Thrown when a mount name is already used elsewhere in the workspace for a different URL (T70 UC-2/UC-3). */
export class MountNameConflictError extends Error {
  constructor(public readonly mountName: string, public readonly existingUrl: string, public readonly newUrl: string) {
    super(`Le nom "${mountName}" est déjà utilisé par un autre repo (${existingUrl}) dans ce workspace.`)
  }
}

async function assertNoMountNameConflict(workspaceDir: string, dep: PolentaRepoDependency): Promise<void> {
  const tree = await api.workspace.getTree(workspaceDir)
  if (!tree) return // no cache yet — nothing to conflict with
  const existing = tree.nodes.find(n => n.name === dep.name)
  if (existing && existing.url && existing.url !== dep.url) {
    throw new MountNameConflictError(dep.name, existing.url, dep.url)
  }
}

/** Ensures `workspaceDir` is a recognized flat workspace before any dependency can be added to it (T70 cas limite "jamais initialisé"). */
export async function ensureWorkspaceInitialized(workspaceDir: string, repoPath: string): Promise<void> {
  const kind = await api.workspace.detect(workspaceDir)
  if (kind !== 'workspace') {
    await api.workspace.init(workspaceDir, repoPath)
  }
}

/**
 * Declares `dep` as a dependency of `parentRepoPath` and rebuilds the workspace tree
 * (cloning/checking it out if needed). Throws MountNameConflictError before writing
 * anything if the mount name collides with a different URL elsewhere in the workspace.
 *
 * The manifest write is atomic with respect to the caller (T70 UC-2 CA-2: "un échec de
 * clone... n'altère pas polenta-repo.yaml") — if the rebuild doesn't come back 'ok', the
 * manifest is rolled back to its prior state before returning.
 */
export async function addDependency(
  workspaceDir: string, parentRepoPath: string, dep: PolentaRepoDependency,
): Promise<WorkspaceOpenResult> {
  const [, manifest] = await Promise.all([
    assertNoMountNameConflict(workspaceDir, dep),
    api.polentaRepo.get(parentRepoPath).then((m): PolentaRepoManifest => m ?? {}),
  ])

  const dependencies = manifest.dependencies ?? []
  const existingIndex = dependencies.findIndex(d => d.name === dep.name && d.url === dep.url)
  const upToDate = existingIndex >= 0 && dependencies[existingIndex].pin === dep.pin
  if (upToDate) {
    return api.workspace.rebuildTree(workspaceDir)
  }

  const nextDependencies = existingIndex >= 0
    ? dependencies.map((d, i) => i === existingIndex ? dep : d) // correcting an existing entry's pin
    : [...dependencies, dep]
  await api.polentaRepo.save(parentRepoPath, { ...manifest, dependencies: nextDependencies })

  const result = await api.workspace.rebuildTree(workspaceDir)
  if (result.status !== 'ok') {
    await api.polentaRepo.save(parentRepoPath, manifest) // roll back — this action must be all-or-nothing
  }
  return result
}

/**
 * Adds `dep` as a dependency of `parentRepoPath` (like addDependency) AND declares,
 * on `parentRepoPath`'s own schema, that it implements that interface with the given
 * roles (T70 UC-3). The implemented version isn't declared here — it's derived from
 * `dep.pin` once resolved in the workspace tree (T71). The `implements` entry is only
 * written once the dependency has actually cloned successfully.
 */
export async function addInterfaceImplementation(
  workspaceDir: string, parentRepoPath: string, dep: PolentaRepoDependency, impl: ImplementsDeclaration,
): Promise<WorkspaceOpenResult> {
  const result = await addDependency(workspaceDir, parentRepoPath, dep)
  if (result.status !== 'ok') return result
  const schema = await api.schema.get(parentRepoPath)
  const nextImplements = [...(schema.implements ?? []), impl]
  await api.schema.save(parentRepoPath, { ...schema, implements: nextImplements })
  return result
}

/**
 * Updates the roles `parentRepoPath` declares for an interface (T74 — editing, not adding).
 * Corrects the matching `implements[]` entry in place if one already exists, same as
 * `addDependency`'s "correcting an existing entry" case — and creates one if it doesn't,
 * since the edit modal for an interface node whose tree-parent never declared `implements`
 * for it (e.g. it was added as a plain dependency, not via the "+ Interface" flow) must still
 * be able to save a first set of roles rather than silently discarding them.
 */
export async function updateInterfaceRoles(
  parentRepoPath: string, interfaceName: string, roles: string[],
): Promise<void> {
  const schema = await api.schema.get(parentRepoPath)
  // T123 — implements vit désormais sur le SystemNode `root` du repo (déprécié au niveau racine
  // du fichier, cf. schema.ts) : fichier d'abord (legacy, jamais retouché depuis ce ticket), node
  // root en repli — et toujours écrit sur le node root, jamais plus au niveau racine du fichier,
  // pour ne pas faire diverger les deux emplacements si ce repo a par ailleurs déjà été édité via
  // le node (NodeEditModal).
  const rootNode = findSystemNode(schema.nodes, 'root')
  const implementsList = schema.implements ?? rootNode?.implements ?? []
  const existingIndex = implementsList.findIndex(impl => impl.interface === interfaceName)
  const nextImplements = existingIndex >= 0
    ? implementsList.map((impl, i) => i === existingIndex ? { ...impl, roles } : impl)
    : [...implementsList, { interface: interfaceName, roles }]
  await api.schema.save(parentRepoPath, {
    ...schema,
    nodes: mapSystemNode(schema.nodes, 'root', n => ({ ...n, implements: nextImplements })),
  })
}

/**
 * Removes a dependency from `parentRepoPath`'s polenta-repo.yaml, cleans up a matching
 * `implements[]` entry on the same repo if it was an interface, rebuilds the tree, and —
 * only once the rebuild has actually succeeded — physically deletes the cloned directory
 * if `deleteLocalFolder` is set (T74). The manifest write always happens before any disk
 * deletion: a failure here must never leave a dangling polenta-repo.yaml reference AND a
 * missing folder at the same time.
 *
 * Cleans up the `implements[]` entry wherever it actually lives — the deprecated file-level
 * `schema.implements` *and* the T123 `nodes[root].implements` (a repo's own root node can carry
 * its own `implements`, cf. `updateInterfaceRoles`/`StructureTab.handleOpenEditDependency`, which
 * already read "file first, node fallback"). Checking only the file-level field would leave a
 * stale duplicate declaration behind on `nodes[root]` for any repo already using the node-level
 * convention — surfaced by T135 sprint 2's `moveDependencyToParent`, which relies on this cleanup
 * actually removing the source's declaration before recreating it on the new parent.
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
  const hasFileLevelEntry = schema.implements?.some(impl => impl.interface === dep.name) ?? false
  const rootNode = findSystemNode(schema.nodes, 'root')
  const hasRootNodeEntry = rootNode?.implements?.some(impl => impl.interface === dep.name) ?? false
  if (hasFileLevelEntry || hasRootNodeEntry) {
    await api.schema.save(parentRepoPath, {
      ...schema,
      implements: hasFileLevelEntry ? schema.implements!.filter(impl => impl.interface !== dep.name) : schema.implements,
      nodes: hasRootNodeEntry
        ? mapSystemNode(schema.nodes, 'root', n => ({ ...n, implements: n.implements?.filter(impl => impl.interface !== dep.name) }))
        : schema.nodes,
    })
  }

  const result = await api.workspace.rebuildTree(workspaceDir)
  if (result.status === 'ok' && deleteLocalFolder) {
    await api.workspace.removeRepoDir(dep.repoPath)
  }
  return result
}

/**
 * Moves a dependency from one parent to another by drag & drop (T135 sprint 2 — "drop onto a
 * folder row to reparent") — `removeDependency` (without deleting the cloned directory) followed
 * by `addDependency` on the new parent, reusing their existing diamond-conflict handling as-is.
 * `toLocalParent` mirrors `PolentaRepoDependency.localParent`: `undefined` to become a flat
 * dependency of `toParentRepoPath` itself, or a local component's name to nest under it.
 * `dep.localParent` is the dependency's *current* tag on the source (mirrors the same field) —
 * needed both to resolve which node declares its `implements` role (see below) and to restore it
 * to its exact former place if the add to the new parent fails.
 *
 * Preserves any `implements[]` role declaration the *source* parent had for this dependency —
 * `removeDependency` strips that declaration from the source (it no longer implements an
 * interface it no longer depends on), but `addDependency` alone doesn't recreate it on the new
 * parent. The declaring node is `fromParentRepoPath`'s own root when `dep.localParent` is
 * `undefined`, or the local component named `dep.localParent` otherwise — a local component's own
 * `SystemNode` can carry its own `implements` independently of root (T123). Read *before*
 * `removeDependency` runs, written back via `updateInterfaceRoles` once the dependency exists on
 * its new parent. Without resolving the correct node, a role declared on a local component (not
 * root) would silently be missed and lost across the move.
 *
 * Sequential, not `Promise.all` — `removeDependency`/`addDependency` each end in their own
 * `api.workspace.rebuildTree()`, which rewrites the single shared workspace tree cache; running
 * them concurrently would race on that file (same caution as `propagatePinToDependents`).
 *
 * If `addDependency` fails (diamond-conflict, parse-error) *after* `removeDependency` already
 * succeeded, the dependency is restored to its exact former parent/`localParent` — `addDependency`
 * only rolls back *its own* write on failure, so without this the dependency would otherwise
 * vanish from the workspace's entire dependency graph rather than simply staying where it was
 * before the drag (its cloned repo directory is untouched either way, never deleted here).
 */
export async function moveDependencyToParent(
  workspaceDir: string,
  fromParentRepoPath: string,
  toParentRepoPath: string,
  toLocalParent: string | undefined,
  dep: { name: string; url: string; pin: string; repoPath: string; localParent: string | undefined },
): Promise<WorkspaceOpenResult> {
  const fromSchema = await api.schema.get(fromParentRepoPath)
  const declaringNode = dep.localParent
    ? findSystemNode(fromSchema.nodes, dep.localParent)
    : findSystemNode(fromSchema.nodes, 'root')
  const preservedRoles = (dep.localParent ? declaringNode?.implements : (fromSchema.implements ?? declaringNode?.implements))
    ?.find(impl => impl.interface === dep.name)?.roles

  const removeResult = await removeDependency(workspaceDir, fromParentRepoPath, dep, false)
  if (removeResult.status !== 'ok') return removeResult

  const addResult = await addDependency(workspaceDir, toParentRepoPath, {
    name: dep.name, url: dep.url, pin: dep.pin, localParent: toLocalParent,
  })
  if (addResult.status !== 'ok') {
    // Restore the dependency to exactly where it was before this drag — addDependency's own
    // rollback on failure only undoes its own (destination-side) write.
    await addDependency(workspaceDir, fromParentRepoPath, {
      name: dep.name, url: dep.url, pin: dep.pin, localParent: dep.localParent,
    })
    return addResult
  }
  if (preservedRoles && preservedRoles.length > 0) {
    await updateInterfaceRoles(toParentRepoPath, dep.name, preservedRoles)
  }
  return addResult
}

/**
 * Reorders a dependency by drag & drop within `parentRepoPath`'s polenta-repo.yaml (T74 —
 * component/interface ordering by ↑/↓ buttons; T135 sprint 1 replaces those buttons with drag &
 * drop, dropping `dir`-based swapping for an arbitrary before/after drop position).
 *
 * `dependencies[]` is one flat array shared by every local-parent group of this repo (top-level
 * siblings with no `localParent`, plus one implicit group per local component that has its own
 * `localParent`-tagged dependencies nested under it in the Structure tab) — reordering must only
 * permute declaration order *within* `localParent`'s own group, leaving every other group's
 * relative order (and therefore its own rendered position) untouched. Achieved by reordering just
 * the matching subsequence of names via `reorderByKey`, then re-filling the array's original
 * slots for that group in the new order — every other dependency keeps its exact array index.
 *
 * `localParent` is `undefined` for the flat (repo-level) group, or a local component's name for
 * its own nested group — mirrors `ownDependencies`/`flatDeps` filtering in `StructureTab.tsx`.
 * A no-op (still rebuilds/returns the tree) if `draggedName`/`targetName` aren't both found in
 * the same group.
 */
export async function reorderDependencies(
  workspaceDir: string, parentRepoPath: string, localParent: string | undefined,
  draggedName: string, targetName: string, position: 'before' | 'after',
): Promise<WorkspaceOpenResult> {
  const manifest = await api.polentaRepo.get(parentRepoPath).then((m): PolentaRepoManifest => m ?? {})
  const dependencies = manifest.dependencies ?? []
  const inGroup = (d: PolentaRepoDependency) => (d.localParent ?? undefined) === localParent
  const group = dependencies.filter(inGroup)
  const groupNames = group.map(d => d.name)
  const reorderedGroupNames = reorderByKey(groupNames, draggedName, targetName, position)
  // Value comparison, not reference — `reorderByKey` returns a freshly built array whenever it
  // actually runs the splice path, even when the resulting order happens to match the input (e.g.
  // dropping an item back next to the neighbor it already sits beside). A reference check alone
  // would miss that case and still write an unchanged `polenta-repo.yaml`.
  const unchanged = reorderedGroupNames.length === groupNames.length
    && reorderedGroupNames.every((n, i) => n === groupNames[i])
  if (unchanged) {
    return api.workspace.rebuildTree(workspaceDir)
  }
  const byName = new Map(group.map(d => [d.name, d]))
  let i = 0
  const nextDependencies = dependencies.map(d => inGroup(d) ? byName.get(reorderedGroupNames[i++])! : d)
  await api.polentaRepo.save(parentRepoPath, { ...manifest, dependencies: nextDependencies })
  return api.workspace.rebuildTree(workspaceDir)
}

/** Thrown by renameDependency when the physical directory rename itself fails — a state
 *  distinct from every other failure here, since it happens before any manifest is touched. */
export class RenameError extends Error {}

/**
 * Renames a dependency's mount name (T74 sprint 2): physically renames its directory, updates
 * `name` in `parentRepoPath`'s own dependency entry, and rewrites every `implements[].interface`
 * in the workspace that points at the old name (a component can implement an interface that
 * isn't its direct tree-parent — cf. T74.md — so the cascade scans every repo, not just
 * `parentRepoPath`).
 *
 * Ordering: the directory rename runs first because it's atomic at the OS level (fully succeeds
 * or fully fails, nothing left inconsistent) — every write that follows assumes it already
 * landed. If a later step fails, nothing is destroyed (matching the sprint 1 finding): worst
 * case is a recoverable inconsistency (e.g. one repo's `implements` still references the old
 * name), never data loss. The cascade itself is best-effort per repo for the same reason — one
 * repo's schema write failing must not stop the others.
 */
export async function renameDependency(
  workspaceDir: string,
  parentRepoPath: string,
  dep: { oldName: string; newName: string; url: string },
): Promise<WorkspaceOpenResult> {
  const tree = await api.workspace.getTree(workspaceDir)
  if (tree?.nodes.some(n => n.name === dep.newName)) {
    throw new MountNameConflictError(dep.newName, tree.nodes.find(n => n.name === dep.newName)!.url, dep.url)
  }

  try {
    await api.workspace.renameRepoDir(workspaceDir, dep.oldName, dep.newName)
  } catch (err) {
    throw new RenameError(err instanceof Error ? err.message : String(err))
  }

  const manifest = await api.polentaRepo.get(parentRepoPath).then((m): PolentaRepoManifest => m ?? {})
  const nextDependencies = (manifest.dependencies ?? []).map(d =>
    d.name === dep.oldName && d.url === dep.url ? { ...d, name: dep.newName } : d,
  )
  await api.polentaRepo.save(parentRepoPath, { ...manifest, dependencies: nextDependencies })

  if (tree) {
    for (const node of tree.nodes) {
      const nodeSchema = await api.schema.get(node.repoPath).catch(() => null)
      if (!nodeSchema?.implements?.some(impl => impl.interface === dep.oldName)) continue
      try {
        await api.schema.save(node.repoPath, {
          ...nodeSchema,
          implements: nodeSchema.implements.map(impl =>
            impl.interface === dep.oldName ? { ...impl, interface: dep.newName } : impl,
          ),
        })
      } catch (err) {
        console.error(`[renameDependency] Could not update implements[] in ${node.name}:`, err)
      }
    }
  }

  return api.workspace.rebuildTree(workspaceDir)
}

/** Outcome of propagatePinToDependents, one entry per dependent repo actually found. */
export interface PinPropagationOutcome {
  /** Dependent repo names whose pin was successfully written (pending, uncommitted). */
  updated: string[]
  /** Dependent repo names where the write was rolled back due to a diamond-conflict. */
  conflicted: string[]
  /** Dependent repo names where the manifest write itself failed, with the error. */
  failed: { name: string; error: string }[]
}

/**
 * Finds every repo in `flatNodes` whose polenta-repo.yaml declares `target` (by name+url)
 * as a dependency, and rewrites its pin to `newPin` via addDependency() — reusing its
 * "correct an existing entry" path, its tree rebuild, and its diamond-conflict rollback
 * (T82). Never touches `target`'s own repo. Best-effort per dependent, same reasoning as
 * renameDependency's cascade: one repo's write failing must not stop the others.
 *
 * Deliberately calls addDependency() once per matched dependent (one manifest write + one
 * full workspace.rebuildTree() each) instead of batching writes and rebuilding once — unlike
 * renameDependency's cascade, each write here can independently roll back on a diamond-conflict,
 * and addDependency already owns that read/write/rebuild/rollback sequence atomically; splitting
 * it apart to batch would duplicate that logic. Workspaces are capped at a handful of repos
 * (see CLAUDE.md), so the extra rebuilds are cheap local file I/O, not a real scaling concern.
 *
 * The loop is sequential (not Promise.all) on purpose, not just for simplicity: every
 * addDependency() call ends in api.workspace.rebuildTree(), which deletes and rewrites the
 * single shared `.polenta/tree.cache.yaml` for the whole workspace — concurrent rebuilds would
 * race on that file. Do not parallelize this without first making rebuildTree safe to run
 * concurrently.
 */
export async function propagatePinToDependents(
  workspaceDir: string,
  flatNodes: WorkspaceTreeNode[],
  target: { name: string; url: string },
  newPin: string,
): Promise<PinPropagationOutcome> {
  const outcome: PinPropagationOutcome = { updated: [], conflicted: [], failed: [] }
  for (const node of flatNodes) {
    if (node.name === target.name) continue
    try {
      const manifest = await api.polentaRepo.get(node.repoPath).then((m): PolentaRepoManifest => m ?? {})
      const dep = (manifest.dependencies ?? []).find(d => d.name === target.name && d.url === target.url)
      if (!dep || dep.pin === newPin) continue
      const result = await addDependency(workspaceDir, node.repoPath, { ...dep, pin: newPin })
      if (result.status === 'diamond-conflict') outcome.conflicted.push(node.name)
      else if (result.status === 'ok') outcome.updated.push(node.name)
      else outcome.failed.push({ name: node.name, error: `Statut inattendu lors du rebuild : ${result.status}` })
    } catch (err) {
      outcome.failed.push({ name: node.name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return outcome
}
