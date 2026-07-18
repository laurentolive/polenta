import { api } from '../api'
import type { PolentaRepoDependency, PolentaRepoManifest, ImplementsDeclaration, WorkspaceOpenResult, WorkspaceTreeNode } from '@polenta/types'

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
  const implementsList = schema.implements ?? []
  const existingIndex = implementsList.findIndex(impl => impl.interface === interfaceName)
  const nextImplements = existingIndex >= 0
    ? implementsList.map((impl, i) => i === existingIndex ? { ...impl, roles } : impl)
    : [...implementsList, { interface: interfaceName, roles }]
  await api.schema.save(parentRepoPath, { ...schema, implements: nextImplements })
}

/**
 * Removes a dependency from `parentRepoPath`'s polenta-repo.yaml, cleans up a matching
 * `implements[]` entry on the same repo if it was an interface, rebuilds the tree, and —
 * only once the rebuild has actually succeeded — physically deletes the cloned directory
 * if `deleteLocalFolder` is set (T74). The manifest write always happens before any disk
 * deletion: a failure here must never leave a dangling polenta-repo.yaml reference AND a
 * missing folder at the same time.
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

/**
 * Reorders a dependency within `parentRepoPath`'s polenta-repo.yaml (T74 — component/interface
 * ordering, mirroring the up/down reorder already available for elements). `name` is the
 * dependency's current mount name; `dir` swaps it with its previous (-1) or next (+1) sibling
 * in declaration order, which is exactly the order `WorkspaceTreeService` uses to build each
 * node's `children` — reordering here is therefore sufficient to reorder the rendered tree.
 * A no-op (still rebuilds/returns the tree) if `name` isn't found or is already at the boundary.
 */
export async function moveDependency(
  workspaceDir: string, parentRepoPath: string, name: string, dir: -1 | 1,
): Promise<WorkspaceOpenResult> {
  const manifest = await api.polentaRepo.get(parentRepoPath).then((m): PolentaRepoManifest => m ?? {})
  const dependencies = manifest.dependencies ?? []
  const i = dependencies.findIndex(d => d.name === name)
  const j = i + dir
  if (i < 0 || j < 0 || j >= dependencies.length) {
    return api.workspace.rebuildTree(workspaceDir)
  }
  const nextDependencies = [...dependencies]
  ;[nextDependencies[i], nextDependencies[j]] = [nextDependencies[j], nextDependencies[i]]
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
