import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'

import type { AuthService } from './auth.service'
import type { GitAuthor } from './git.service'

const execFileAsync = promisify(execFile)

export interface SyncFileStatus {
  path: string
  marker: 'M' | 'A' | 'D'
}

export interface GitRef {
  name: string
  sha: string
  type: 'branch' | 'remote-branch' | 'tag' | 'commit'
  short?: string
  message?: string
}

export interface SyncStatus {
  branch: string
  staged: SyncFileStatus[]
  unstaged: SyncFileStatus[]
  ahead: number
  behind: number
}

export interface GraphCommit {
  sha: string
  short: string
  message: string
  author: string
  date: string
  refs: string[]
  isCurrent: boolean
  parents: string[]
}

export interface CommitResult {
  sha: string
  message: string
  timestamp: string
}

export type MergeResult =
  | { success: true; sha: string }
  | { success: false; conflicts: string[] }

/**
 * isomorphic-git's transport layer only implements the http(s) smart protocol — a local
 * filesystem path used as `origin` (e.g. a demo/test bare repo) throws UrlParseError before
 * any network call happens. Route those through the native `git` binary instead, which talks
 * to local paths natively.
 */
function isHttpRemote(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Returns the conflicting file paths if `err` is isomorphic-git's `MergeConflictError`, `null`
 * otherwise. `err.message` does *not* contain the string `'MergeConflictError'` — it reads
 * "Automatic merge failed with one or more merge conflicts in the following files: …" — so a
 * substring check on the message never matches; `instanceof` against the typed error class is
 * both the correct check and gives typed access to `.data.filepaths`.
 */
function conflictFiles(err: unknown): string[] | null {
  return err instanceof git.Errors.MergeConflictError ? err.data.filepaths : null
}

export class SyncService {
  constructor(private readonly auth: AuthService) {}

  async clone(remoteUrl: string, localPath: string, onProgress?: (p: number) => void): Promise<void> {
    const credentials = await this.auth.getHttpsCredentials(remoteUrl)

    await git.clone({
      fs,
      http,
      dir: localPath,
      url: remoteUrl,
      onAuth: () => credentials ?? undefined,
      onProgress: onProgress
        ? (evt: { phase: string; loaded: number; total?: number }) => {
            if (evt.total) {
              onProgress(Math.round((evt.loaded / evt.total) * 100))
            }
          }
        : undefined,
    })
  }

  /**
   * Fetches new refs from `remote` into an already-cloned repo, without merging or checking
   * anything out (T74). Used when a repo already exists locally but a requested pin isn't
   * resolvable yet — the caller then checks out the pin directly. Never call `clone()` for
   * this case: isomorphic-git's clone() re-initializes .git as an early step, before the
   * network fetch that might then fail, which would destroy the existing checkout.
   *
   * `urlFallback` (the dependency's declared URL from polenta-repo.yaml) is used only if the
   * local repo has no `remote` configured yet — normal repos cloned by this app always do,
   * this just avoids failing outright on a repo that was set up some other way.
   */
  async fetch(repoPath: string, urlFallback: string, remote = 'origin'): Promise<void> {
    const remoteUrl = (await getRemoteUrl(repoPath, remote)) || urlFallback
    const credentials = await this.auth.getHttpsCredentials(remoteUrl)

    await git.fetch({
      fs,
      http,
      dir: repoPath,
      url: remoteUrl,
      remote,
      onAuth: () => credentials ?? undefined,
    })
  }

  async status(repoPath: string): Promise<SyncStatus> {
    const matrix = await git.statusMatrix({ fs, dir: repoPath })

    const staged: SyncFileStatus[] = []
    const unstaged: SyncFileStatus[] = []

    for (const [filepath, head, workdir, stage] of matrix) {
      // Skip unmodified
      if (head === 1 && workdir === 1 && stage === 1) continue
      if (head === 0 && workdir === 0 && stage === 0) continue

      // Staged: explicitly indexed (exclude untracked files where head=0 and stage=0)
      if (stage !== 1 && !(head === 0 && stage === 0)) {
        if (head === 0) staged.push({ path: filepath, marker: 'A' })          // new file staged
        else if (stage === 0) staged.push({ path: filepath, marker: 'D' })    // deleted from index
        else staged.push({ path: filepath, marker: 'M' })                     // modified in index
      }

      // Unstaged: workdir differs from stage
      if (head === 0 && workdir === 2 && stage === 0) {
        unstaged.push({ path: filepath, marker: 'A' })   // new untracked file
      } else if (head === 1 && workdir === 2 && stage === 1) {
        unstaged.push({ path: filepath, marker: 'M' })   // modified, not staged
      } else if (head === 1 && workdir === 0 && stage === 1) {
        unstaged.push({ path: filepath, marker: 'D' })   // deleted, not staged
      } else if (head === 1 && workdir === 2 && stage === 3) {
        unstaged.push({ path: filepath, marker: 'M' })   // staged partially, workdir still differs
      }
    }

    // Calculate ahead/behind
    let branch = ''
    let ahead = 0
    let behind = 0
    try {
      const b = await git.currentBranch({ fs, dir: repoPath })
      branch = b ?? ''
      if (b) {
        const localCommits = await git.log({ fs, dir: repoPath, ref: b, depth: 100 })
        const remoteRef = `refs/remotes/origin/${b}`
        try {
          const remoteCommits = await git.log({ fs, dir: repoPath, ref: remoteRef, depth: 100 })
          const remoteSet = new Set(remoteCommits.map(c => c.oid))
          const localSet = new Set(localCommits.map(c => c.oid))
          ahead = localCommits.filter(c => !remoteSet.has(c.oid)).length
          behind = remoteCommits.filter(c => !localSet.has(c.oid)).length
        } catch {
          // No refs/remotes/origin/<branch> yet. Only treat local commits as "ahead" if a
          // remote is actually configured (branch just never pushed) — with no remote at
          // all there's nowhere to push to, so the whole local history isn't "to push" (T89).
          const hasRemote = (await getRemoteUrl(repoPath, 'origin')) !== null
          ahead = hasRemote ? localCommits.length : 0
        }
      }
    } catch {
      // ignore
    }

    return { branch, staged, unstaged, ahead, behind }
  }

  async commit(repoPath: string, message: string, author?: GitAuthor): Promise<CommitResult> {
    const resolvedAuthor = author ?? (await this.auth.getAuthor(repoPath))

    const sha = await git.commit({
      fs,
      dir: repoPath,
      message,
      author: {
        name: resolvedAuthor.name,
        email: resolvedAuthor.email,
      },
    })

    return {
      sha,
      message,
      timestamp: new Date().toISOString(),
    }
  }

  async stage(repoPath: string, filepath: string): Promise<void> {
    // For deleted files (no longer on disk), git.add() throws ENOENT.
    // Use git.remove() to stage the deletion instead.
    const absPath = path.join(repoPath, filepath)
    try {
      await fsP.access(absPath)
      // File exists on disk → normal add
      await git.add({ fs, dir: repoPath, filepath })
    } catch {
      // File absent from disk → stage the deletion
      await git.remove({ fs, dir: repoPath, filepath })
    }
  }

  async stageAll(repoPath: string): Promise<void> {
    const matrix = await git.statusMatrix({ fs, dir: repoPath })
    for (const [filepath, head, workdir] of matrix) {
      // Deleted file: exists in HEAD but absent from workdir
      if (head === 1 && workdir === 0) {
        await git.remove({ fs, dir: repoPath, filepath })
      }
    }
    // Stage all present files (new + modified)
    await git.add({ fs, dir: repoPath, filepath: '.' })
  }

  async unstage(repoPath: string, filepath: string): Promise<void> {
    await git.resetIndex({ fs, dir: repoPath, filepath })
  }

  async unstageAll(repoPath: string): Promise<void> {
    const matrix = await git.statusMatrix({ fs, dir: repoPath })
    const toUnstage = matrix
      .filter(([, , , stage]) => stage !== 1)
      .map(([filepath]) => filepath)
    for (const f of toUnstage) {
      await git.resetIndex({ fs, dir: repoPath, filepath: f })
    }
  }

  async discard(repoPath: string, filepath: string): Promise<void> {
    const matrix = await git.statusMatrix({ fs, dir: repoPath, filepaths: [filepath] })
    if (!matrix.length) return
    const [, head] = matrix[0]
    if (head === 0) {
      // New file not in HEAD — delete it from workdir
      await fsP.unlink(path.join(repoPath, filepath)).catch(() => {})
    } else {
      // Restore file content from HEAD commit
      const headSha = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid: headSha, filepath })
      const absPath = path.join(repoPath, filepath)
      await fsP.mkdir(path.dirname(absPath), { recursive: true })
      await fsP.writeFile(absPath, blob)
    }
    // Always reset index for this file
    await git.resetIndex({ fs, dir: repoPath, filepath }).catch(() => {})
  }

  /** Discards every staged/unstaged change in one pass — same statusMatrix walk as stageAll/unstageAll. */
  async discardAll(repoPath: string): Promise<void> {
    const matrix = await git.statusMatrix({ fs, dir: repoPath })
    const changed = matrix.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
    for (const [filepath] of changed) {
      await this.discard(repoPath, filepath)
    }
  }

  async push(repoPath: string, remote = 'origin'): Promise<void> {
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    if (remoteUrl && !isHttpRemote(remoteUrl)) {
      await execFileAsync('git', ['push', remote], { cwd: repoPath })
      return
    }
    const credentials = remoteUrl ? await this.auth.getHttpsCredentials(remoteUrl) : null

    await git.push({
      fs,
      http,
      dir: repoPath,
      remote,
      onAuth: () => credentials ?? undefined,
    })
  }

  async pull(repoPath: string, remote = 'origin'): Promise<void> {
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    if (remoteUrl && !isHttpRemote(remoteUrl)) {
      await execFileAsync('git', ['pull', '--no-rebase', remote], { cwd: repoPath })
      return
    }
    const credentials = remoteUrl ? await this.auth.getHttpsCredentials(remoteUrl) : null
    const author = await this.auth.getAuthor(repoPath)

    await git.pull({
      fs,
      http,
      dir: repoPath,
      remote,
      author: { name: author.name, email: author.email },
      onAuth: () => credentials ?? undefined,
      fastForwardOnly: false,
    })
  }

  async graph(repoPath: string, limit = 100): Promise<GraphCommit[]> {
    const headSha = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' }).catch(() => '')
    const localBranches = await git.listBranches({ fs, dir: repoPath })
    const remoteBranchNames = await git.listBranches({ fs, dir: repoPath, remote: 'origin' }).catch(() => [] as string[])
    const remoteBranches = remoteBranchNames.filter(b => b !== 'HEAD').map(b => `origin/${b}`)
    const tags = await git.listTags({ fs, dir: repoPath }).catch(() => [] as string[])

    // sha → ref names (local branches + remote branches + tags)
    const refMap = new Map<string, string[]>()
    for (const b of localBranches) {
      try {
        const sha = await git.resolveRef({ fs, dir: repoPath, ref: b })
        const arr = refMap.get(sha) ?? []; arr.push(b); refMap.set(sha, arr)
      } catch {}
    }
    for (const rb of remoteBranches) {
      try {
        const sha = await git.resolveRef({ fs, dir: repoPath, ref: rb })
        const arr = refMap.get(sha) ?? []; arr.push(rb); refMap.set(sha, arr)
      } catch {}
    }
    for (const tag of tags) {
      try {
        const commits = await git.log({ fs, dir: repoPath, ref: tag, depth: 1 })
        if (commits.length > 0) {
          const sha = commits[0].oid
          const arr = refMap.get(sha) ?? []; arr.push(tag); refMap.set(sha, arr)
        }
      } catch {}
    }

    // Collect unique commits across local branches, remote branches and tags
    const seen = new Set<string>()
    const all: GraphCommit[] = []
    for (const ref of ['HEAD', ...localBranches, ...remoteBranches, ...tags]) {
      try {
        const commits = await git.log({ fs, dir: repoPath, ref, depth: limit })
        for (const c of commits) {
          if (seen.has(c.oid)) continue
          seen.add(c.oid)
          all.push({
            sha: c.oid,
            short: c.oid.slice(0, 7),
            message: c.commit.message.split('\n')[0],
            author: c.commit.author.name,
            date: new Date(c.commit.author.timestamp * 1000).toISOString(),
            refs: refMap.get(c.oid) ?? [],
            isCurrent: c.oid === headSha,
            parents: c.commit.parent ?? [],
          })
        }
      } catch {}
    }
    return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
  }

  async tags(repoPath: string): Promise<string[]> {
    try {
      return await git.listTags({ fs, dir: repoPath })
    } catch {
      return []
    }
  }

  async createTag(repoPath: string, tagName: string, commitSha?: string): Promise<void> {
    const sha = commitSha ?? await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
    await git.writeRef({ fs, dir: repoPath, ref: `refs/tags/${tagName}`, value: sha, force: false })
  }

  /** Annotated tag carrying a message (e.g. a baseline comment) — unlike `createTag`, readable back via `git.readTag`. */
  async createAnnotatedTag(repoPath: string, tagName: string, message: string, commitSha?: string): Promise<void> {
    const sha = commitSha ?? await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
    const author = await this.auth.getAuthor(repoPath)
    await git.annotatedTag({
      fs,
      dir: repoPath,
      ref: tagName,
      object: sha,
      message,
      tagger: { name: author.name, email: author.email },
    })
  }

  /** Resolves a tag name to its commit sha. Tags created by `createTag` are lightweight refs
   * written directly to a commit sha (no annotation to peel). Returns null if the tag doesn't exist. */
  async resolveTag(repoPath: string, tagName: string): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, dir: repoPath, ref: `refs/tags/${tagName}` })
    } catch {
      return null
    }
  }

  async tagsForCommit(repoPath: string, commitSha: string): Promise<string[]> {
    try {
      const allTags = await git.listTags({ fs, dir: repoPath })
      const matching: string[] = []
      for (const tag of allTags) {
        try {
          const tagSha = await git.resolveRef({ fs, dir: repoPath, ref: `refs/tags/${tag}` })
          if (tagSha === commitSha) matching.push(tag)
        } catch {}
      }
      return matching
    } catch {
      return []
    }
  }

  async pinnedSubmoduleCommit(repoPath: string, submoduleName: string): Promise<string | null> {
    try {
      const headSha = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
      const { commit } = await git.readCommit({ fs, dir: repoPath, oid: headSha })
      const { tree: rootTree } = await git.readTree({ fs, dir: repoPath, oid: commit.tree })
      const componentsEntry = rootTree.find((e: { path: string }) => e.path === 'components')
      if (!componentsEntry) return null
      const { tree: componentsTree } = await git.readTree({ fs, dir: repoPath, oid: componentsEntry.oid })
      const subEntry = componentsTree.find((e: { path: string }) => e.path === submoduleName)
      return subEntry?.oid ?? null
    } catch {
      return null
    }
  }

  async diff(repoPath: string, filepath: string): Promise<{ oldContent: string; newContent: string }> {
    let oldContent = ''
    try {
      const headSha = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid: headSha, filepath })
      oldContent = new TextDecoder().decode(blob)
    } catch {}

    let newContent = ''
    try {
      newContent = await fsP.readFile(path.join(repoPath, filepath), 'utf-8')
    } catch {}

    return { oldContent, newContent }
  }

  async commitFiles(repoPath: string, sha: string): Promise<SyncFileStatus[]> {
    const { commit } = await git.readCommit({ fs, dir: repoPath, oid: sha })
    const parentSha = commit.parent[0]

    const files: SyncFileStatus[] = []

    if (!parentSha) {
      // Initial commit: walk the tree and mark everything as Added
      await git.walk({
        fs,
        dir: repoPath,
        trees: [git.TREE({ ref: sha })],
        map: async (filepath, [entry]) => {
          if (filepath === '.') return
          if (!entry) return
          if (await entry.type() === 'tree') return
          files.push({ path: filepath, marker: 'A' })
        },
      })
      return files
    }

    await git.walk({
      fs,
      dir: repoPath,
      trees: [git.TREE({ ref: parentSha }), git.TREE({ ref: sha })],
      map: async (filepath, [A, B]) => {
        if (filepath === '.') return
        const Atype = A ? await A.type() : undefined
        const Btype = B ? await B.type() : undefined
        if (Atype === 'tree' || Btype === 'tree') return
        const Aoid = A ? await A.oid() : undefined
        const Boid = B ? await B.oid() : undefined
        if (Aoid === Boid) return
        if (!A && B) files.push({ path: filepath, marker: 'A' })
        else if (A && !B) files.push({ path: filepath, marker: 'D' })
        else files.push({ path: filepath, marker: 'M' })
      },
    })
    return files
  }

  async commitDiff(repoPath: string, sha: string, filepath: string): Promise<{ oldContent: string; newContent: string }> {
    const { commit } = await git.readCommit({ fs, dir: repoPath, oid: sha })
    const parentSha = commit.parent[0]

    let oldContent = ''
    if (parentSha) {
      try {
        const { blob } = await git.readBlob({ fs, dir: repoPath, oid: parentSha, filepath })
        oldContent = new TextDecoder().decode(blob)
      } catch {}
    }

    let newContent = ''
    try {
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid: sha, filepath })
      newContent = new TextDecoder().decode(blob)
    } catch {}

    return { oldContent, newContent }
  }

  async listBranches(repoPath: string): Promise<{ name: string; isCurrent: boolean; type: 'int' | 'dev' | 'other' }[]> {
    const branches = await git.listBranches({ fs, dir: repoPath })
    const current = await git.currentBranch({ fs, dir: repoPath }).catch(() => '')
    return branches.map(name => ({
      name,
      isCurrent: name === current,
      type: name.startsWith('int-') ? 'int' : name.startsWith('dev-') ? 'dev' : 'other',
    }))
  }

  /**
   * Creates `name` at the current HEAD and switches to it — without writing a single file to the
   * working directory (T87). `git.branch({ checkout: true })` delegates to isomorphic-git's
   * `checkout()`, which by default rewrites tracked files from the target tree — since the new
   * branch points at the exact same commit as before, that would silently clobber any uncommitted
   * edit sitting in the working directory at the moment of creation (the routine case now that
   * editing happens directly on the integration branch, deferred to "Publier"). `noCheckout: true`
   * moves HEAD without touching the filesystem.
   */
  async createBranch(repoPath: string, name: string): Promise<void> {
    await git.branch({ fs, dir: repoPath, ref: name, checkout: false })
    await git.checkout({ fs, dir: repoPath, ref: name, noCheckout: true })
  }

  async checkoutBranch(repoPath: string, name: string): Promise<void> {
    await git.checkout({ fs, dir: repoPath, ref: name })
  }

  async deleteBranch(repoPath: string, name: string): Promise<void> {
    await git.deleteBranch({ fs, dir: repoPath, ref: name })
  }

  async merge(repoPath: string, fromBranch: string): Promise<MergeResult> {
    const currentBranch = await git.currentBranch({ fs, dir: repoPath })
    if (!currentBranch) throw new Error('Detached HEAD — cannot merge')

    const author = await this.auth.getAuthor(repoPath)

    try {
      const result = await git.merge({
        fs,
        dir: repoPath,
        ours: currentBranch,
        theirs: fromBranch,
        author: { name: author.name, email: author.email },
        message: `Merge branch '${fromBranch}' into ${currentBranch}`,
        fastForwardOnly: false,
      })

      return { success: true, sha: result.oid ?? '' }
    } catch (err: unknown) {
      const conflicts = conflictFiles(err)
      if (conflicts) return { success: false, conflicts }
      throw err
    }
  }

  async mergeInto(repoPath: string, fromBranch: string, intoBranch: string): Promise<MergeResult> {
    const author = await this.auth.getAuthor(repoPath)
    try {
      const result = await git.merge({
        fs,
        dir: repoPath,
        ours: intoBranch,
        theirs: fromBranch,
        author: { name: author.name, email: author.email },
        message: `Merge branch '${fromBranch}' into ${intoBranch}`,
        fastForwardOnly: false,
      })
      return { success: true, sha: result.oid ?? '' }
    } catch (err: unknown) {
      const conflicts = conflictFiles(err)
      if (conflicts) return { success: false, conflicts }
      throw err
    }
  }

  async createBranchAt(repoPath: string, name: string, sha: string): Promise<void> {
    await git.branch({ fs, dir: repoPath, ref: name, object: sha, checkout: false })
  }

  async deleteRemoteBranch(repoPath: string, name: string, remote = 'origin'): Promise<void> {
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    if (remoteUrl && !isHttpRemote(remoteUrl)) {
      await execFileAsync('git', ['push', remote, '--delete', name], { cwd: repoPath })
      return
    }
    const credentials = remoteUrl ? await this.auth.getHttpsCredentials(remoteUrl) : null

    await git.push({
      fs,
      http,
      dir: repoPath,
      remote,
      remoteRef: name,
      delete: true,
      onAuth: () => credentials ?? undefined,
    })
  }

  async deleteTag(repoPath: string, tagName: string): Promise<void> {
    await git.deleteRef({ fs, dir: repoPath, ref: `refs/tags/${tagName}` })
  }

  async pushBranch(repoPath: string, branchName: string, remote = 'origin'): Promise<void> {
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    if (remoteUrl && !isHttpRemote(remoteUrl)) {
      await execFileAsync('git', ['push', remote, branchName], { cwd: repoPath })
      return
    }
    const credentials = remoteUrl ? await this.auth.getHttpsCredentials(remoteUrl) : null

    await git.push({
      fs,
      http,
      dir: repoPath,
      remote,
      ref: branchName,
      onAuth: () => credentials ?? undefined,
    })
  }

  async rebase(repoPath: string, onto: string): Promise<void> {
    try {
      await execFileAsync('git', ['rebase', onto], { cwd: repoPath })
    } catch (err: unknown) {
      // Only abort if a rebase is actually in progress (conflict mid-rebase).
      // Pre-rebase failures (unknown ref, dirty tree) never start a rebase, so
      // running --abort there would produce a spurious "no rebase in progress" error.
      const rebaseMergeDir = path.join(repoPath, '.git', 'rebase-merge')
      const rebaseApplyDir = path.join(repoPath, '.git', 'rebase-apply')
      const inProgress =
        await fsP.access(rebaseMergeDir).then(() => true).catch(() => false) ||
        await fsP.access(rebaseApplyDir).then(() => true).catch(() => false)
      if (inProgress) {
        await execFileAsync('git', ['rebase', '--abort'], { cwd: repoPath }).catch(() => {})
      }
      // Prefer stderr (actual git output) over message (just the command line)
      const stderr = (err as { stderr?: string }).stderr
      const msg = stderr?.trim() || (err instanceof Error ? err.message : String(err))
      throw new Error(`Rebase failed: ${msg}`)
    }
  }

  async diffFileBetween(
    repoPath: string,
    sha1: string,
    sha2: string,
    filepath: string,
  ): Promise<{ oldContent: string; newContent: string }> {
    let oldContent = ''
    try {
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid: sha1, filepath })
      oldContent = new TextDecoder().decode(blob)
    } catch {}

    let newContent = ''
    try {
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid: sha2, filepath })
      newContent = new TextDecoder().decode(blob)
    } catch {}

    return { oldContent, newContent }
  }

  async resolveRefs(repoPath: string): Promise<GitRef[]> {
    // Resolve all branches/tags concurrently to avoid N sequential round-trips
    const [localBranches, remoteBranchNames, tags] = await Promise.all([
      git.listBranches({ fs, dir: repoPath }).catch(() => [] as string[]),
      git.listBranches({ fs, dir: repoPath, remote: 'origin' }).catch(() => [] as string[]),
      git.listTags({ fs, dir: repoPath }).catch(() => [] as string[]),
    ])

    const [localResults, remoteResults, tagResults] = await Promise.all([
      // Local branches
      Promise.all(
        localBranches.map(async b => {
          try {
            const sha = await git.resolveRef({ fs, dir: repoPath, ref: b })
            return { name: b, sha, type: 'branch' as const }
          } catch {
            return null
          }
        }),
      ),
      // Remote branches (exclude HEAD pseudo-ref)
      Promise.all(
        remoteBranchNames.filter(b => b !== 'HEAD').map(async b => {
          try {
            const sha = await git.resolveRef({ fs, dir: repoPath, ref: `origin/${b}` })
            return { name: `origin/${b}`, sha, type: 'remote-branch' as const }
          } catch {
            return null
          }
        }),
      ),
      // Tags — use git.log to correctly dereference both lightweight and annotated tags
      Promise.all(
        tags.map(async tag => {
          try {
            const commits = await git.log({ fs, dir: repoPath, ref: tag, depth: 1 })
            if (commits.length > 0) {
              return { name: tag, sha: commits[0].oid, type: 'tag' as const }
            }
            return null
          } catch {
            return null
          }
        }),
      ),
    ])

    const nonNull = <T>(arr: (T | null)[]): T[] => arr.filter((r): r is T => r !== null)

    const refs: GitRef[] = [
      ...nonNull(localResults),
      ...nonNull(remoteResults),
      ...nonNull(tagResults),
    ]

    // Recent commits (50 last) — append only commits not already referenced above
    try {
      const commits = await git.log({ fs, dir: repoPath, depth: 50 })
      const seen = new Set(refs.map(r => r.sha))
      for (const c of commits) {
        if (seen.has(c.oid)) continue
        seen.add(c.oid)
        refs.push({
          name: c.oid.slice(0, 7),
          sha: c.oid,
          type: 'commit',
          short: c.oid.slice(0, 7),
          message: c.commit.message.split('\n')[0].slice(0, 60),
        })
      }
    } catch {}

    return refs
  }

  async diffBetween(repoPath: string, sha1: string, sha2: string): Promise<SyncFileStatus[]> {
    const files: SyncFileStatus[] = []

    await git.walk({
      fs,
      dir: repoPath,
      trees: [git.TREE({ ref: sha1 }), git.TREE({ ref: sha2 })],
      map: async (filepath, [A, B]) => {
        if (filepath === '.') return
        const Atype = A ? await A.type() : undefined
        const Btype = B ? await B.type() : undefined
        if (Atype === 'tree' || Btype === 'tree') return
        const Aoid = A ? await A.oid() : undefined
        const Boid = B ? await B.oid() : undefined
        if (Aoid === Boid) return
        if (!A && B) files.push({ path: filepath, marker: 'A' })
        else if (A && !B) files.push({ path: filepath, marker: 'D' })
        else files.push({ path: filepath, marker: 'M' })
      },
    })

    return files
  }
}

async function getRemoteUrl(repoPath: string, remote: string): Promise<string | null> {
  try {
    const remotes = await git.listRemotes({ fs, dir: repoPath })
    return remotes.find((r: { remote: string; url: string }) => r.remote === remote)?.url ?? null
  } catch {
    return null
  }
}
