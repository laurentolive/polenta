/**
 * "Publier" across every repo of the workspace (GH38).
 *
 * Before GH38 "Publier" only ever published the "repo concerné" (root, or `?repo=`), so edits made
 * on a separate-repo component's objects from the Exigences/Tests views silently stayed
 * uncommitted. `publishWorkspace` publishes every repo that has something to publish, children
 * before parents, each one through the unchanged single-repo flow (`publishRepo`, T87/T154), and
 * propagates each published SHA as pin into its dependents (T82) — which are published right
 * after, so the pin update lands in the same publication.
 */

import { api } from '../api'
import type { WorkspaceTreeNode } from '@polenta/types'
import { propagatePinToDependents, type PinPropagationOutcome } from './workspaceActions'

const DIACRITICS = /[̀-ͯ]/g

/** `dev-<slug>` — lowercase, accents stripped, non-alphanumeric runs collapsed to `-`, capped. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

/** Detached HEAD, or an `int-*` branch other than the configured integration branch — same rule
 *  as `useModificationMode`'s `'other'`/`'blocked'` modes: "Publier" can't run from there. */
export function isBlockedBranch(branch: string, integrationBranch: string): boolean {
  return branch === '' || (branch.startsWith('int-') && branch !== integrationBranch)
}

/** Post-order DFS of the logical tree (children before parents), deduplicated by `repoPath` — a
 *  repo shared by two parents (diamond) is emitted once, at its first encounter, hence before
 *  every one of its parents. The root comes last. */
export function publishOrder(roots: WorkspaceTreeNode[]): WorkspaceTreeNode[] {
  const seen = new Set<string>()
  const out: WorkspaceTreeNode[] = []
  function visit(node: WorkspaceTreeNode) {
    if (seen.has(node.repoPath)) return
    seen.add(node.repoPath)
    for (const child of node.children) visit(child)
    out.push(node)
  }
  roots.forEach(visit)
  return out
}

/** Every transitive parent (in the logical tree) of `repoPaths` — the repos that will receive a
 *  pin update when those are published. Excludes `repoPaths` themselves unless they are also an
 *  ancestor of another one. */
export function ancestorRepoPaths(roots: WorkspaceTreeNode[], repoPaths: Set<string>): Set<string> {
  const parentsOf = new Map<string, Set<string>>()
  const seen = new Set<string>()
  function visit(node: WorkspaceTreeNode) {
    for (const child of node.children) {
      if (!parentsOf.has(child.repoPath)) parentsOf.set(child.repoPath, new Set())
      parentsOf.get(child.repoPath)!.add(node.repoPath)
    }
    if (seen.has(node.repoPath)) return
    seen.add(node.repoPath)
    node.children.forEach(visit)
  }
  roots.forEach(visit)

  const out = new Set<string>()
  const stack = [...repoPaths]
  while (stack.length > 0) {
    for (const parent of parentsOf.get(stack.pop()!) ?? []) {
      if (out.has(parent)) continue
      out.add(parent)
      stack.push(parent)
    }
  }
  return out
}

export interface PublishRepoRef {
  name: string
  label?: string
  repoPath: string
}

/** Thrown by `publishRepo` on a merge conflict — the repo is left checked out on `workBranch`.
 *  `ephemeral`: `workBranch` is the `dev-<slug>` this flow created (T87), not a user-owned branch. */
export class PublishConflictError extends Error {
  constructor(public readonly conflicts: string[], public readonly workBranch: string, public readonly ephemeral: boolean) {
    super('merge-conflict')
  }
}

/** T154: a `fetch` failed before anything was touched (GH38: on any candidate repo). */
export class PublishNetworkError extends Error {
  constructor(public readonly detail: string, public readonly repo: PublishRepoRef) {
    super('network-unavailable')
  }
}

/** GH38: a candidate repo sits on a branch "Publier" can't run from — nothing was touched. */
export class PublishBlockedError extends Error {
  constructor(public readonly repos: { repo: PublishRepoRef; branch: string; integrationBranch: string }[]) {
    super('blocked-branch')
  }
}

/** GH38: publishing `repo` failed (`reason` is a `PublishConflictError` or any other error) after
 *  `published` were already published — those stay published, nothing after `repo` was touched. */
export class PublishRepoError extends Error {
  constructor(
    public readonly reason: unknown,
    public readonly repo: PublishRepoRef,
    public readonly integrationBranch: string,
    public readonly published: PublishedRepo[],
  ) {
    super(reason instanceof Error ? reason.message : String(reason))
  }
}

export interface EphemeralBranch {
  repoPath: string
  branch: string
}

/**
 * The single-repo "Publier" flow (T87/T154), unchanged apart from the `fetch`, now done upfront
 * for every candidate by `publishWorkspace`. On the configured integration branch it creates an
 * ephemeral `dev-<slug>` first (deleted again once merged); from any other branch (dev-* or a
 * freely-named one — advanced usage) it commits directly on that branch and leaves it checked out.
 */
export async function publishRepo(opts: {
  repoPath: string
  branch: string
  integrationBranch: string
  title: string
  continuingEphemeral: boolean
  onEphemeralChange: (b: EphemeralBranch | null) => void
}): Promise<{ sha: string }> {
  const { repoPath, branch, integrationBranch, title, continuingEphemeral, onEphemeralChange } = opts
  const isNominal = branch === integrationBranch || continuingEphemeral
  let workBranch = branch

  if (branch === integrationBranch) {
    const branches = await api.sync.branches(repoPath)
    const existing = new Set(branches.map(b => b.name))
    const slug = slugify(title)
    const base = slug ? `dev-${slug}` : 'dev-modification'
    let name = base
    let n = 2
    while (existing.has(name)) {
      name = `${base}-${n}`
      n += 1
    }
    await api.sync.createBranch(repoPath, name)
    workBranch = name
    onEphemeralChange({ repoPath, branch: name })
  }

  // T154: `workBranch` is never `integrationBranch` at this point — either just created above
  // (nominal case) or already a dev-*/free branch the user was on (advanced case) — so moving
  // the integration branch's ref here can't desync it from a checkout. Fast-forwards it to the
  // fetch done upfront if it's a plain fast-forward; a genuine divergence (pre-existing, rare —
  // see SPEC-FORKS-BRANCHES-BASELINES.md §2.1) is left untouched and falls through to the
  // ordinary mergeInto/push behavior below.
  await api.sync.fastForwardBranch(repoPath, integrationBranch)

  await api.sync.stageAll(repoPath)
  await api.sync.commit(repoPath, title.trim() || `Modification sur ${branch}`)
  const merge = await api.sync.mergeInto(repoPath, workBranch, integrationBranch)
  if (!merge.success) throw new PublishConflictError(merge.conflicts, workBranch, isNominal)

  if (isNominal) {
    await leaveWorkBranch(repoPath, integrationBranch, workBranch)
    onEphemeralChange(null)
  }

  return { sha: merge.sha }
}

/** End of the nominal flow: back on the integration branch, the ephemeral `dev-<slug>` deleted. */
async function leaveWorkBranch(repoPath: string, integrationBranch: string, workBranch: string): Promise<void> {
  await api.sync.checkoutBranch(repoPath, integrationBranch)
  await api.sync.deleteBranch(repoPath, workBranch).catch(() => {})
}

export interface ResumePublishResult extends PublishWorkspaceResult {
  /** What stopped the publication of the remaining repos, if anything (same errors as
   *  `publishWorkspace`) — the resolved repo itself is always in `published`. */
  error?: unknown
}

/**
 * GH37 — the conflicting merge of `repo` was resolved in the merge editor, which committed the
 * merge (`sha`) on its integration branch: finish that repo exactly like `publishRepo` would
 * have (leave the ephemeral branch, propagate the pin), then publish the remaining repos under the
 * same title. Not a second `publishRepo` run on the work branch: that would commit an empty
 * commit on it and merge it again.
 */
export async function resumePublishAfterResolution(opts: {
  workspaceDir: string
  flatNodes: WorkspaceTreeNode[]
  roots: WorkspaceTreeNode[]
  repoPath: string
  workBranch: string
  /** The work branch is the ephemeral `dev-<slug>` "Publier" created (T87) — left and deleted. An
   *  advanced, user-owned branch is never checked out away from nor deleted, as in `publishRepo`. */
  ephemeral: boolean
  integrationBranch: string
  title: string
  sha: string
}): Promise<ResumePublishResult> {
  const { workspaceDir, flatNodes, roots, repoPath, workBranch, ephemeral, integrationBranch, title, sha } = opts
  const node = flatNodes.find(n => n.repoPath === repoPath)
  const resolved: PublishedRepo = { name: node?.name ?? 'root', label: node?.label, repoPath, integrationBranch, sha }
  const pinOutcome: PinPropagationOutcome = { updated: [], conflicted: [], failed: [] }

  if (ephemeral) {
    const status = await api.sync.status(repoPath)
    if (status.branch === workBranch) await leaveWorkBranch(repoPath, integrationBranch, workBranch)
  }
  if (node) {
    const outcome = await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, sha)
    pinOutcome.updated.push(...outcome.updated)
    pinOutcome.conflicted.push(...outcome.conflicted)
    pinOutcome.failed.push(...outcome.failed)
  }

  try {
    const rest = await publishWorkspace({
      workspaceDir, flatNodes, roots, title, ephemeral: null, onEphemeralChange: () => {},
    })
    // `publishWorkspace` only reattaches the repos it published itself (diamond case).
    await reattachPublished([resolved])
    return {
      published: [resolved, ...rest.published],
      pinOutcome: {
        updated: [...pinOutcome.updated, ...rest.pinOutcome.updated],
        conflicted: [...pinOutcome.conflicted, ...rest.pinOutcome.conflicted],
        failed: [...pinOutcome.failed, ...rest.pinOutcome.failed],
      },
    }
  } catch (error) {
    await reattachPublished([resolved])
    const published = error instanceof PublishRepoError ? [resolved, ...error.published] : [resolved]
    return { published, pinOutcome, error }
  }
}

export interface PublishedRepo extends PublishRepoRef {
  integrationBranch: string
  sha: string
}

export interface PublishWorkspaceResult {
  published: PublishedRepo[]
  pinOutcome: PinPropagationOutcome
}

interface RepoState {
  branch: string
  integrationBranch: string
  hasWork: boolean
  continuingEphemeral: boolean
}

async function readRepoState(repoPath: string, ephemeral: EphemeralBranch | null): Promise<RepoState> {
  const [status, integrationBranch] = await Promise.all([
    api.sync.status(repoPath),
    api.baseline.getIntegrationBranch(repoPath),
  ])
  const continuingEphemeral = ephemeral?.repoPath === repoPath && ephemeral.branch === status.branch
  const pending = status.staged.length + status.unstaged.length
  return { branch: status.branch, integrationBranch, hasWork: pending > 0 || continuingEphemeral, continuingEphemeral }
}

function ref(node: WorkspaceTreeNode): PublishRepoRef {
  return { name: node.name, label: node.label, repoPath: node.repoPath }
}

/**
 * Publishes every repo of the workspace that has something to publish (GH38 — see module doc).
 *
 * Nothing is written until every candidate (repos with work + their ancestors, which will receive
 * a pin update) has passed the branch check and its `fetch` (T154) — a blocked branch or a network
 * failure on any of them leaves the whole workspace exactly as it was. Past that point, a failure
 * on one repo stops the run there: the repos already published stay published (a merge already
 * pushed can't be undone), the next "Publier" resumes with the remaining ones.
 *
 * Each repo's pending state is re-read right before its turn: a child's pin propagation may have
 * just made a clean parent dirty, and that pin update must be published with it.
 */
export async function publishWorkspace(opts: {
  workspaceDir: string
  flatNodes: WorkspaceTreeNode[]
  roots: WorkspaceTreeNode[]
  title: string
  ephemeral: EphemeralBranch | null
  onEphemeralChange: (b: EphemeralBranch | null) => void
}): Promise<PublishWorkspaceResult> {
  const { workspaceDir, flatNodes, roots, title, onEphemeralChange } = opts
  let ephemeral = opts.ephemeral
  const trackEphemeral = (b: EphemeralBranch | null) => { ephemeral = b; onEphemeralChange(b) }

  const order = publishOrder(roots)
  const states = new Map<string, RepoState>()
  for (const node of order) states.set(node.repoPath, await readRepoState(node.repoPath, ephemeral))

  const withWork = new Set(order.filter(n => states.get(n.repoPath)!.hasWork).map(n => n.repoPath))
  const pinTargets = ancestorRepoPaths(roots, withWork)
  const candidates = order.filter(n => withWork.has(n.repoPath) || pinTargets.has(n.repoPath))

  const pinOutcome: PinPropagationOutcome = { updated: [], conflicted: [], failed: [] }
  if (candidates.length === 0) return { published: [], pinOutcome }

  const blocked = candidates
    .map(n => ({ repo: ref(n), ...states.get(n.repoPath)! }))
    .filter(s => isBlockedBranch(s.branch, s.integrationBranch))
  if (blocked.length > 0) {
    throw new PublishBlockedError(blocked.map(({ repo, branch, integrationBranch }) => ({ repo, branch, integrationBranch })))
  }

  // T154: every fetch first, before anything is touched. Safe while still checked out on the
  // integration branch: fetch only ever writes remote-tracking refs, never local branches.
  for (const node of candidates) {
    try {
      await api.sync.fetch(node.repoPath, node.url ?? '')
    } catch (err) {
      throw new PublishNetworkError(err instanceof Error ? err.message : String(err), ref(node))
    }
  }

  const published: PublishedRepo[] = []
  for (const node of candidates) {
    let state: RepoState | undefined
    try {
      state = await readRepoState(node.repoPath, ephemeral)
      if (!state.hasWork) continue
      const { sha } = await publishRepo({
        repoPath: node.repoPath,
        branch: state.branch,
        integrationBranch: state.integrationBranch,
        title,
        continuingEphemeral: state.continuingEphemeral,
        onEphemeralChange: trackEphemeral,
      })
      published.push({ ...ref(node), integrationBranch: state.integrationBranch, sha })

      // T82: propose the merge SHA as pin wherever this repo is declared as a dependency — the
      // dependents come later in `candidates`, so the pin update is published with them.
      const outcome = await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, sha)
      pinOutcome.updated.push(...outcome.updated)
      pinOutcome.conflicted.push(...outcome.conflicted)
      pinOutcome.failed.push(...outcome.failed)
    } catch (err) {
      await reattachPublished(published)
      const integrationBranch = state?.integrationBranch ?? states.get(node.repoPath)!.integrationBranch
      throw new PublishRepoError(err, ref(node), integrationBranch, published)
    }
  }

  await reattachPublished(published)
  return { published, pinOutcome }
}

/**
 * A repo shared by two parents (diamond) gets its pin propagated to each of them in turn: in
 * between, the two parents declare different pins for it, and the `rebuildTree()` run by
 * `propagatePinToDependents` checks one of them out — leaving the just-published repo on a
 * detached HEAD, where editing is blocked. Once every pin has landed, put each published repo
 * that ended up detached back on its integration branch (where its publication just left it:
 * the tree is clean, so this rewrites no user change). Best effort — a failure here must not
 * mask the publication's own outcome.
 */
async function reattachPublished(published: PublishedRepo[]): Promise<void> {
  for (const repo of published) {
    try {
      const status = await api.sync.status(repo.repoPath)
      if (status.branch === '' && status.staged.length + status.unstaged.length === 0) {
        await api.sync.checkoutBranch(repo.repoPath, repo.integrationBranch)
      }
    } catch (err) {
      console.warn(`[publishWorkspace] Could not reattach ${repo.name} to ${repo.integrationBranch}:`, err)
    }
  }
}
