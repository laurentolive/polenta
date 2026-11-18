import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'

import { isNetworkUnreachable } from './net-proxy'
import { ForgeAccessError, httpStatusOf, isNonGitResponse, isPushDeclined, revokedError, writeDeniedError } from './forge/forge-access'

import { AUTO_BRANCH_PREFIX, isAutoBranch } from '@polenta/types'

import { extractHost, type AuthService } from './auth.service'
import type { GitAuthor } from './git.service'
import { safeCheckout } from './safe-checkout.util'
import { readFileAt, resolveCommitSha } from './read-file-at.util'
import { assertNotVersionTag } from './version-tags.util'
import { gitClone, gitFor, gitLsRemoteHeads, type CommitInfo, type GitBackend, type NameStatus, type StatusEntry, type TreeEntry } from '../git/git-backend'
import type { CredentialResolver } from '../git/askpass'
import { GitError, MergeConflictError } from '../git/git-errors'

/** GH337 — commit visé par `rev` (tag annoté déréférencé, comme `git.readCommit`), erreur s'il n'existe pas. */
async function readCommitOrThrow(g: GitBackend, rev: string): Promise<CommitInfo> {
  const oid = await g.resolveCommit(rev)
  const c = oid ? await g.readCommit(oid) : null
  if (!c) throw new GitError('not-found', ['readCommit', rev], null, `commit introuvable : ${rev}`)
  return c
}

/** GH337 — fichiers d'un `diff-tree` (sans renommages) avec les marqueurs du panneau Version. */
function toFileStatuses(changes: NameStatus[]): SyncFileStatus[] {
  return changes.map(c => ({ path: c.path, marker: c.status === 'A' ? 'A' : c.status === 'D' ? 'D' : 'M' }))
}

/** GH337 — entrée de statut d'un fichier absent du disque (un `D.` peut être doublé d'un `??` si le fichier est revenu). */
const isDeletedOnDisk = (e: StatusEntry) => e.worktree === 'D' || (e.index === 'D' && e.worktree === '.')

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
  // GH37: `leftRef` (mes modifications) / `rightRef` (destination) of the conflicting merge, to
  // open the merge editor on it.
  | { success: false; conflicts: string[]; leftRef?: string; rightRef?: string }

/** GH39 — the configured integration branch compared to its remote-tracking ref (last fetch). */
export type IntegrationRemoteStateKind = 'no-remote' | 'up-to-date' | 'behind' | 'ahead' | 'diverged'

export interface IntegrationRemoteState {
  state: IntegrationRemoteStateKind
  /** Local commits absent from origin. */
  ahead: number
  /** Origin commits absent locally. */
  behind: number
  /** GH43 — set by `autoSync` only: the server was unreachable, the state is the last fetch's. */
  offline?: true
  /** GH45 — set by `autoSync` only: access to the server was revoked (no network call until re-login). */
  accessRevoked?: true
  /** GH45 — server (origin) whose access was revoked (with `accessRevoked`). */
  revokedServer?: string
}

/** GH138 — outcome of `checkoutBranch`: the branch checked out and, when `name` was a
 * remote-tracking label, where that local branch stands against it. */
export interface CheckoutBranchResult {
  branch: string
  remote?: 'created' | 'up-to-date' | 'behind' | 'ahead' | 'diverged'
  /** `<remote>/<branch>`, with `remote`. */
  remoteRef?: string
}

export type ResyncOutcome =
  | { outcome: 'up-to-date' | 'fast-forwarded' | 'pushed' | 'merged' }
  | { outcome: 'set-aside'; branch: string }

/** GH173 — what `settleAutoBranch` did: moved pending changes off the integration onto a fresh
 *  `dev-auto[-n]`, or went back to the integration from an idle one (deleted). */
export type AutoBranchOutcome =
  | { action: 'none' }
  | { action: 'switched' | 'returned'; branch: string }

/** GH39 — prefix of the branch `resyncIntegration` sets diverged local commits aside on. */
export const RESYNC_BRANCH_PREFIX = 'dev-resync'

/** GH39 — depth of the history walk used to count ahead/behind commits. */
const DIVERGENCE_LOG_DEPTH = 500

/**
 * GH337 — identifiants d'une opération réseau : lus à chaque invite de git par le serveur askpass
 * (§6), jamais placés dans son environnement. `null` (remote absente) : aucun identifiant.
 */
function credentialsFor(auth: AuthService, remoteUrl: string | null): CredentialResolver {
  return async () => (remoteUrl ? auth.getHttpsCredentials(remoteUrl) : null)
}

/** Progression de `git clone --progress` (« Receiving objects:  45% (…) ») → pourcentage. */
function progressPercent(onProgress: (p: number) => void): (line: string) => void {
  return line => {
    const m = /(\d{1,3})%/.exec(line)
    if (m) onProgress(Number(m[1]))
  }
}

/** GH178 — both sides of a file diff, with the refs actually read (`null` = working tree). */
export interface FileDiffContents {
  oldContent: string
  newContent: string
  oldRef: string | null
  newRef: string | null
  oldMissing: boolean
  newMissing: boolean
}

async function fileDiffContents(
  repoPath: string,
  filepath: string,
  oldRef: string | null,
  newRef: string | null,
  /** No "before" commit (initial commit, empty repo): the old side is absent, not the working tree. */
  noOldSide: boolean,
): Promise<FileDiffContents> {
  const decode = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : '')
  const oldBytes = noOldSide ? null : await readFileAt(repoPath, oldRef, filepath)
  const newBytes = await readFileAt(repoPath, newRef, filepath)
  return {
    oldContent: decode(oldBytes),
    newContent: decode(newBytes),
    oldRef: noOldSide ? null : oldRef,
    newRef,
    oldMissing: oldBytes === null,
    newMissing: newBytes === null,
  }
}

/** GH37 — chemins en conflit si `err` est une fusion bloquée par des conflits, `null` sinon. */
function conflictFiles(err: unknown): string[] | null {
  return err instanceof MergeConflictError ? err.paths : null
}

export class SyncService {
  constructor(private readonly auth: AuthService) {}

  /**
   * GH45 — runs a network git operation against an HTTPS remote and turns an access refusal into a
   * `ForgeAccessError` (design §3.4, revised §12):
   * - 401 while credentials were sent → access revoked (host flagged until re-login);
   * - 403 on a write (`write`) → no write permission (or protected branch), unless the API says the
   *   account is disabled;
   * - a non-git answer (HTML page) or a 403 → API probe: a disabled account answers git with
   *   HTTP 200 + an HTML page, not a 401. Other failures (non fast-forward, local errors) are never
   *   delayed by a probe.
   * Network errors and every other failure are rethrown untouched (GH30/GH43 paths unchanged).
   */
  private async guarded<T>(remoteUrl: string | null, write: boolean, op: () => Promise<T>): Promise<T> {
    try {
      return await op()
    } catch (err) {
      throw await this.classifyAccessError(err, remoteUrl, write)
    }
  }

  private async classifyAccessError(err: unknown, remoteUrl: string | null, write: boolean): Promise<unknown> {
    // Un refus HTTP ne concerne que les remotes http(s) (un remote ssh n'a pas de compte de forge).
    if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl) || err instanceof ForgeAccessError || isNetworkUnreachable(err)) return err
    if (conflictFiles(err)) return err
    const host = extractHost(remoteUrl)
    const status = httpStatusOf(err)
    if (status === 404 || status === 400 || (status !== null && status >= 500)) return err
    if (!(await this.hasHttpsCredentials(remoteUrl))) return err
    const revoked = (): ForgeAccessError => {
      this.auth.markAccessRevoked(host)
      return revokedError(host, new URL(remoteUrl).origin)
    }
    if (status === 401) return revoked()
    if (write && isPushDeclined(err)) return writeDeniedError(host, repoLabel(remoteUrl))
    if (status !== 403 && !isNonGitResponse(err)) return err
    if ((await this.auth.probeForgeAccess(remoteUrl)) === 'revoked') return revoked()
    if (status === 403 && write) return writeDeniedError(host, repoLabel(remoteUrl))
    return err
  }

  /** GH45 — forge type of the account registered for `remoteUrl`'s host (`null`: no account). */
  async forgeKindForUrl(remoteUrl: string) {
    return this.auth.providerKindForUrl(remoteUrl)
  }

  /** GH30 — whether a clone/fetch of `remoteUrl` would carry credentials at all. */
  async hasHttpsCredentials(remoteUrl: string): Promise<boolean> {
    return (await this.auth.getHttpsCredentials(remoteUrl)) !== null
  }

  /** Clone ; `onProgress` reçoit le pourcentage lu dans la progression de git (stderr). */
  async clone(remoteUrl: string, localPath: string, onProgress?: (p: number) => void): Promise<void> {
    await this.guarded(remoteUrl, false, () => gitClone(remoteUrl, localPath, {
      credentials: credentialsFor(this.auth, remoteUrl),
      onProgress: onProgress ? progressPercent(onProgress) : undefined,
    }))
  }

  /** GH107 — branches du serveur, sans rien écrire ; `[]` pour un repo vide. */
  async remoteHeads(remoteUrl: string): Promise<string[]> {
    return this.guarded(remoteUrl, false, () => gitLsRemoteHeads(remoteUrl, {
      credentials: credentialsFor(this.auth, remoteUrl),
    }))
  }

  /** GH107 — clone partiel d'une branche, pour lire ses fichiers (inspection d'un repo existant). */
  async cloneBranchShallow(remoteUrl: string, localPath: string, branch: string): Promise<void> {
    await this.guarded(remoteUrl, false, () => gitClone(remoteUrl, localPath, {
      credentials: credentialsFor(this.auth, remoteUrl), branch, depth: 1, noTags: true,
    }))
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
   *
   * GH337 — un seul transport, le git natif (http(s), ssh, chemin local) ; `git fetch --tags` (GH268).
   * Sans remote ni `urlFallback` (projet purement local), c'est un no-op.
   */
  async fetch(repoPath: string, urlFallback: string, remote = 'origin'): Promise<void> {
    const configured = await getRemoteUrl(repoPath, remote)
    const remoteUrl = configured || urlFallback
    if (!remoteUrl) return
    const g = gitFor(repoPath)
    await this.guarded(remoteUrl, false, () => g.fetch(remote, {
      credentials: credentialsFor(this.auth, remoteUrl),
      // Remote non configurée : repli sur l'URL déclarée, branches suivies sous `<remote>/*`.
      url: configured ? undefined : urlFallback,
    }))
  }

  /**
   * T154: fast-forwards the local `branchName` ref to match already-fetched remote-tracking refs
   * (`refs/remotes/<remote>/<branchName>`) — does **not** fetch itself, callers must `fetch()`
   * first (kept separate so "Publier" can do its early network-reachability check while still on
   * the integration branch, before this ref-rewrite runs — see below). Never touches the working
   * directory or index — safe to call regardless of which branch is currently checked out,
   * PROVIDED it isn't `branchName` itself. Only the ref is rewritten (`update-ref`); if
   * `branchName` were HEAD's target, the working tree/index would silently desync from the new
   * HEAD. Callers (see "Publier" in `ModificationControl.tsx`) always invoke this only after
   * moving off the integration branch onto a work branch.
   *
   * - Local `branchName` strictly behind the fetched remote tip → fast-forwarded in place.
   * - Local has commits the remote doesn't (a previous publish whose push failed silently — T153
   *   discussion, pre-existing and out of scope here) → left untouched, reported as `'diverged'`;
   *   callers fall back to today's plain `mergeInto` behavior for this rare case.
   */
  async fastForwardBranch(
    repoPath: string,
    branchName: string,
    remote = 'origin',
  ): Promise<'up-to-date' | 'fast-forwarded' | 'diverged' | 'no-remote-branch'> {
    const g = gitFor(repoPath)
    const remoteRef = `refs/remotes/${remote}/${branchName}`
    const remoteOid = await g.resolve(remoteRef).catch(() => null)
    if (!remoteOid) return 'no-remote-branch'

    const localRef = `refs/heads/${branchName}`
    const localOid = await g.resolveOrThrow(localRef)
    if (localOid === remoteOid) return 'up-to-date'

    const canFastForward = await g.isAncestor(localOid, remoteOid).catch(() => false)
    if (!canFastForward) return 'diverged'

    await g.updateRefs([{ ref: localRef, newOid: remoteOid, oldOid: localOid }])
    return 'fast-forwarded'
  }

  /**
   * GH337 — staged / unstaged d'après `GitBackend.status()` (GH336 C, seule définition de « modification
   * locale ») : `index` → staged (A, D, sinon M), `worktree` → unstaged (non suivi → A, D, sinon M).
   */
  async status(repoPath: string): Promise<SyncStatus> {
    const g = gitFor(repoPath)
    const entries = await g.status()

    const staged: SyncFileStatus[] = []
    const unstaged: SyncFileStatus[] = []

    for (const e of entries) {
      if (e.index === '?') {
        unstaged.push({ path: e.path, marker: 'A' })     // new untracked file
        continue
      }
      if (e.index === '!') continue
      if (e.index === 'U') {
        unstaged.push({ path: e.path, marker: 'M' })     // unmerged
        continue
      }
      if (e.index !== '.') {
        staged.push({ path: e.path, marker: e.index === 'A' ? 'A' : e.index === 'D' ? 'D' : 'M' })
      }
      if (e.worktree !== '.') {
        unstaged.push({ path: e.path, marker: e.worktree === 'D' ? 'D' : 'M' })
      }
    }

    // Calculate ahead/behind
    let branch = ''
    let ahead = 0
    let behind = 0
    try {
      const b = await g.currentBranch()
      branch = b ?? ''
      // Branche sans commit : rien à compter (isomorphic-git levait ici).
      // GH337 — résolutions par le `cat-file` persistant, puis un seul processus pour les comptes
      // (`rev-list --left-right --count`), au lieu de deux `log` : chemin de chaque rafraîchissement.
      const remoteRef = `refs/remotes/origin/${b}`
      const [localOid, remoteOid] = b ? await Promise.all([g.resolve(`refs/heads/${b}`), g.resolve(remoteRef)]) : [null, null]
      if (b && localOid) {
        if (remoteOid) {
          [ahead, behind] = await g.aheadBehind(localOid, remoteOid)
        } else {
          // No refs/remotes/origin/<branch> yet. Only treat local commits as "ahead" if a
          // remote is actually configured (branch just never pushed) — with no remote at
          // all there's nowhere to push to, so the whole local history isn't "to push" (T89).
          // GH41: and only the commits no remote branch already has (`git log <b> --not
          // --remotes`) — a branch forked from a pushed one would otherwise count its whole
          // history (e.g. `dev-resync`, GH39).
          const hasRemote = (await getRemoteUrl(repoPath, 'origin')) !== null
          // Même fenêtre de 100 commits qu'avant.
          ahead = hasRemote ? (await g.notOnRemotes(localOid, 'origin', 100).catch(() => [])).length : 0
        }
      }
    } catch {
      // ignore
    }

    return { branch, staged, unstaged, ahead, behind }
  }

  async commit(repoPath: string, message: string, author?: GitAuthor): Promise<CommitResult> {
    const resolvedAuthor = author ?? (await this.auth.getAuthor(repoPath))

    // GH337 — `allowEmpty` : isomorphic-git commitait aussi un index inchangé ; le comportement reste.
    const sha = await gitFor(repoPath).commit({
      message,
      author: { name: resolvedAuthor.name, email: resolvedAuthor.email },
      allowEmpty: true,
    })

    return {
      sha,
      message,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * GH106 — commits `filepath` alone with `content` on the checked-out branch. The commit tree is
   * HEAD's tree with that single entry replaced (`commit-tree`, the index is never read), so
   * pending changes — staged or not — stay out of the commit and stay pending. The index entry of
   * `filepath` is moved to the committed blob; the working directory is left to the caller.
   * GH201 — `beforeRefUpdate` runs on the new commit before the branch moves to it (e.g. tagging
   * it): if it throws, the branch, the index and the working directory are left untouched.
   * GH337 — the branch moves only if it is still on `head` (`update-ref` transaction): a commit
   * written in between is never overwritten.
   */
  async commitSingleFile(
    repoPath: string, filepath: string, content: string, message: string,
    beforeRefUpdate?: (sha: string) => Promise<void>,
  ): Promise<string> {
    const g = gitFor(repoPath)
    const branch = await g.currentBranch()
    if (!branch) throw new Error('Detached HEAD — cannot commit')
    const head = await g.resolveOrThrow('HEAD')
    const commit = await readCommitOrThrow(g, head)
    // Contenu stocké tel quel, comme `git.writeBlob` d'isomorphic-git (Polenta écrit en LF).
    const blob = await g.writeBlob(Buffer.from(content, 'utf8'))
    const { tree, mode } = await this.replaceTreeEntry(g, commit.tree, filepath.split('/'), blob)
    const author = await this.auth.getAuthor(repoPath)
    const ref = `refs/heads/${branch}`
    const sha = await g.commitTree(tree, [head], message, { name: author.name, email: author.email })
    if (beforeRefUpdate) {
      await beforeRefUpdate(sha)
      // La branche a pu avancer pendant le rappel : ne pas écraser un commit écrit entre-temps.
      if (await g.resolve(ref) !== head) throw new Error(`${branch} a avancé pendant le commit — réessayer`)
    }
    try {
      await g.updateRefs([{ ref, newOid: sha, oldOid: head }])
    } catch (err) {
      if (await g.resolve(ref) !== head) throw new Error(`${branch} a avancé pendant le commit — réessayer`)
      throw err
    }
    await g.setIndexEntries([{ mode, oid: blob, path: filepath }])
    return sha
  }

  /** Content of `filepath` in the HEAD commit, `null` if absent (or no commit yet). */
  async readFileAtHead(repoPath: string, filepath: string): Promise<string | null> {
    try {
      return await gitFor(repoPath).readText('HEAD', filepath)
    } catch {
      return null
    }
  }

  /** Arbre `treeOid` avec `parts` (chemin découpé) remplacé par le blob `blobOid` ; mode du fichier inclus. */
  private async replaceTreeEntry(g: GitBackend, treeOid: string | null, parts: string[], blobOid: string): Promise<{ tree: string; mode: string }> {
    const entries: TreeEntry[] = treeOid ? await g.lsTree(treeOid, { recursive: false }) : []
    const [name, ...rest] = parts
    const existing = entries.find(e => e.path === name)
    let entry: TreeEntry
    let mode: string
    if (rest.length === 0) {
      mode = existing?.type === 'blob' ? existing.mode : '100644'
      entry = { mode, path: name, oid: blobOid, type: 'blob' }
    } else {
      const sub = await this.replaceTreeEntry(g, existing?.type === 'tree' ? existing.oid : null, rest, blobOid)
      mode = sub.mode
      entry = { mode: '040000', path: name, type: 'tree', oid: sub.tree }
    }
    return { tree: await g.mktree([...entries.filter(e => e.path !== name), entry]), mode }
  }

  /**
   * GH337 — `add` natif : contenu normalisé selon `.gitattributes` (fins de ligne, #336) ; un fichier
   * absent du disque est retiré de l'index (suppression indexée).
   */
  async stage(repoPath: string, filepath: string): Promise<void> {
    const g = gitFor(repoPath)
    if (fs.existsSync(path.join(repoPath, filepath))) await g.add([filepath])
    else await g.remove([filepath], { cached: true })
  }

  async stageAll(repoPath: string): Promise<void> {
    const g = gitFor(repoPath)
    const entries = await g.status()
    // Un `D.` doublé d'un `??` : fichier retiré de l'index mais présent sur le disque → à ajouter.
    const onDisk = new Set(entries.filter(e => !isDeletedOnDisk(e)).map(e => e.path))
    const toAdd = new Set<string>()
    const toRemove = new Set<string>()
    for (const e of entries) {
      if (e.index === '!') continue
      if (onDisk.has(e.path)) toAdd.add(e.path) // nouveaux et modifiés
      else if (e.index !== 'A') toRemove.add(e.path) // supprimés du disque, encore dans HEAD
    }
    // Un seul processus par sorte, quel que soit le nombre de fichiers.
    await g.add([...toAdd])
    await g.remove([...toRemove].filter(p => !toAdd.has(p)), { cached: true })
  }

  async unstage(repoPath: string, filepath: string): Promise<void> {
    await gitFor(repoPath).resetPaths([filepath])
  }

  async unstageAll(repoPath: string): Promise<void> {
    // Entrées dont l'index diffère de HEAD (un non suivi n'a rien à retirer de l'index).
    const g = gitFor(repoPath)
    const toUnstage = (await g.status())
      .filter(e => e.index !== '.' && e.index !== '?' && e.index !== '!')
      .map(e => e.path)
    await g.resetPaths([...new Set(toUnstage)])
  }

  /** Ramène `filepath` à HEAD (index et disque, fins de ligne selon `.gitattributes`) ; un fichier absent de HEAD est supprimé. */
  async discard(repoPath: string, filepath: string): Promise<void> {
    const g = gitFor(repoPath)
    const inHead = (await g.objectInfo(`HEAD:${filepath}`).catch(() => null)) !== null
    // Not in HEAD: nothing to do unless git sees it (staged or untracked — not ignored)
    if (!inHead && !(await g.status({ prefixes: [filepath] })).some(e => e.path === filepath && e.index !== '!')) return
    await g.restore([filepath])
  }

  /**
   * Discards every staged/unstaged change. GH336 — en une passe (un `restore` pour tous les fichiers
   * suivis, une suppression des nouveaux), jamais fichier par fichier (plusieurs minutes pour
   * quelques centaines de fichiers, ex. après un checkout interrompu).
   */
  async discardAll(repoPath: string): Promise<void> {
    const g = gitFor(repoPath)
    const changed = (await g.status()).filter(e => e.index !== '!')
    if (changed.length === 0) return
    // Un `??` doublant un `D.` (fichier de HEAD retiré de l'index) est restauré, pas supprimé.
    await g.restore([...new Set(changed.map(e => e.path))])
  }

  async push(repoPath: string, remote = 'origin'): Promise<void> {
    const g = gitFor(repoPath)
    const branch = await g.currentBranch()
    if (!branch) throw new Error('Detached HEAD — cannot push')
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    await this.guarded(remoteUrl, true, () => g.push(remote, [`refs/heads/${branch}:refs/heads/${branch}`], {
      credentials: credentialsFor(this.auth, remoteUrl),
    }))
    await this.pushPendingTags(repoPath, remote)
  }

  /**
   * "Rafraîchir" (T153), reworked by GH37: fetch, then merge `refs/remotes/<remote>/<branch>` into
   * the current branch through isomorphic-git with `abortOnConflict` — a conflict leaves the
   * working directory and the index untouched (no conflict markers, SSH remote included: the
   * former `git pull --no-rebase` CLI path wrote them into the user's files) and is returned so
   * the caller can open the merge editor (`leftRef` = local branch, `rightRef` = remote branch).
   * On success the working directory is realigned on the new HEAD (`git.merge` alone doesn't).
   * Only ever called on a clean tree (UI guard, re-checked here before anything moves).
   */
  async pull(repoPath: string, remote = 'origin'): Promise<MergeResult> {
    const g = gitFor(repoPath)
    const branch = await g.currentBranch()
    if (!branch) throw new Error('Detached HEAD — cannot pull')
    const status = await this.status(repoPath)
    if (status.staged.length + status.unstaged.length > 0) throw new Error('Uncommitted changes — cannot pull')

    await this.fetch(repoPath, '', remote)
    const remoteRef = `refs/remotes/${remote}/${branch}`
    const localOid = await g.resolveOrThrow(`refs/heads/${branch}`)
    const remoteOid = await g.resolve(remoteRef).catch(() => null)
    if (!remoteOid || remoteOid === localOid) return { success: true, sha: localOid }

    const author = await this.auth.getAuthor(repoPath)
    try {
      const result = await g.mergeBranches(branch, remoteRef, {
        author: { name: author.name, email: author.email },
        message: `Merge remote-tracking branch '${remote}/${branch}' into ${branch}`,
      })
      // La fusion n'a déplacé que la ref : index et disque réalignés sur la nouvelle pointe.
      await g.checkout(branch, { force: true })
      return { success: true, sha: result.oid }
    } catch (err: unknown) {
      const conflicts = conflictFiles(err)
      if (conflicts) return { success: false, conflicts, leftRef: branch, rightRef: remoteRef }
      throw err
    }
  }

  /**
   * T155: like `pull()`, but refuses to do anything beyond a plain fast-forward — never attempts
   * a real 3-way merge, so it can never write conflict markers into the working directory. Was used
   * by the periodic background auto-pull until GH39 replaced it there by `autoSync`: a *silent* operation the
   * user never asked for must not be able to leave a repo mid-conflict while they're looking at
   * something else entirely. If the branch can't fast-forward (local has unpushed commits —
   * dirty-but-uncommitted is filtered out by the caller before this is even reached, so this is
   * the "diverged" case from `fastForwardBranch`/T154), this throws and the caller skips this
   * repo for the current tick, same as any other transient failure (offline, auth).
   *
   * A repo with no remote configured is a no-op, not an error — same reasoning as `fetch()`.
   */
  async pullFastForwardOnly(repoPath: string, remote = 'origin'): Promise<void> {
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    if (!remoteUrl) return
    // Fetch (tags compris, GH268), puis avance rapide de la branche courante seulement.
    await this.fetch(repoPath, remoteUrl, remote)
    const g = gitFor(repoPath)
    const branch = await g.currentBranch()
    if (!branch) throw new Error('Detached HEAD — cannot pull')
    const remoteRef = `refs/remotes/${remote}/${branch}`
    if (!(await g.resolve(remoteRef).catch(() => null))) return
    // `merge --ff-only` : refuse une branche divergente (non-fast-forward), sans rien écrire.
    await g.mergeFastForward(remoteRef)
  }

  /**
   * GH39: where the local integration branch stands against `origin/<branch>` as of the last fetch
   * — purely local, no network. A repo without remote, or whose branch was never pushed, is
   * `no-remote` (nothing to compare against, nothing to alert about).
   */
  async integrationState(repoPath: string, branch: string, remote = 'origin'): Promise<IntegrationRemoteState> {
    const none: IntegrationRemoteState = { state: 'no-remote', ahead: 0, behind: 0 }
    if (!branch || !(await getRemoteUrl(repoPath, remote))) return none
    const g = gitFor(repoPath)
    const [localOid, remoteOid] = await Promise.all([
      g.resolve(`refs/heads/${branch}`).catch(() => null),
      g.resolve(`refs/remotes/${remote}/${branch}`).catch(() => null),
    ])
    if (!localOid || !remoteOid) return none
    if (localOid === remoteOid) return { state: 'up-to-date', ahead: 0, behind: 0 }

    const [localCommits, remoteCommits] = await Promise.all([
      g.log(localOid, { limit: DIVERGENCE_LOG_DEPTH }),
      g.log(remoteOid, { limit: DIVERGENCE_LOG_DEPTH }),
    ])
    const localSet = new Set(localCommits.map(c => c.oid))
    const remoteSet = new Set(remoteCommits.map(c => c.oid))
    const ahead = localCommits.filter(c => !remoteSet.has(c.oid)).length
    const behind = remoteCommits.filter(c => !localSet.has(c.oid)).length

    const isDescendent = (oid: string, ancestor: string) => g.isAncestor(ancestor, oid).catch(() => false)
    if (await isDescendent(remoteOid, localOid)) return { state: 'behind', ahead: 0, behind }
    if (await isDescendent(localOid, remoteOid)) return { state: 'ahead', ahead, behind: 0 }
    return { state: 'diverged', ahead, behind }
  }

  /** GH39: would merging `origin/<branch>` into `<branch>` conflict? Simulated — nothing is written. */
  async canMergeRemoteIntoIntegration(
    repoPath: string,
    branch: string,
    remote = 'origin',
  ): Promise<{ ok: true } | { ok: false; conflicts: string[] }> {
    const author = await this.auth.getAuthor(repoPath)
    try {
      await gitFor(repoPath).mergeBranches(branch, `${remote}/${branch}`, {
        author: { name: author.name, email: author.email },
        dryRun: true,
      })
      return { ok: true }
    } catch (err: unknown) {
      const conflicts = conflictFiles(err)
      if (conflicts) return { ok: false, conflicts }
      throw err
    }
  }

  /** GH39: true when `branch` has no commit that `into` doesn't already contain. */
  async isMergedInto(repoPath: string, branch: string, into: string): Promise<boolean> {
    const g = gitFor(repoPath)
    const [oid, intoOid] = await Promise.all([g.resolveOrThrow(branch), g.resolveOrThrow(into)])
    if (oid === intoOid) return true
    return g.isAncestor(oid, intoOid).catch(() => false)
  }

  /**
   * GH39: the explicit "Resynchroniser" action — brings the integration branch back in line with
   * `origin` whatever its state (see specs/GH39.md §3.2):
   * - `behind` → fast-forward; `ahead` → push; `diverged` → merge `origin/<branch>` then push.
   * - When `branch` is checked out, the working tree follows (merge + checkout, same mechanics as
   *   `git.pull`) — refused with `integration-dirty` if the repo has pending changes, so this can
   *   never overwrite them.
   * - `diverged` with conflicts → the local commits are set aside on `dev-resync[-n]`, the
   *   integration is realigned on origin, and "Publier" from `dev-resync` then goes through the
   *   ordinary conflict flow (§2.4). Nothing in the working tree is touched.
   */
  async resyncIntegration(repoPath: string, branch: string, remote = 'origin'): Promise<ResyncOutcome> {
    // GH173: pending changes on the checked-out integration go onto `dev-auto` first — the
    // integration is then resynchronized by reference, without touching them.
    await this.settleAutoBranch(repoPath, branch, remote)
    await this.fetch(repoPath, '', remote)
    const { state } = await this.integrationState(repoPath, branch, remote)
    if (state === 'no-remote' || state === 'up-to-date') return { outcome: 'up-to-date' }
    if (state === 'ahead') {
      await this.pushBranch(repoPath, branch, remote)
      return { outcome: 'pushed' }
    }

    const checkedOut = (await gitFor(repoPath).currentBranch()) === branch
    if (checkedOut) {
      const { staged, unstaged } = await this.status(repoPath)
      if (staged.length + unstaged.length > 0) throw new Error('integration-dirty')
    }
    // Commit du working directory avant que la fusion n'avance la branche par référence.
    const before = await gitFor(repoPath).resolveOrThrow(`refs/heads/${branch}`)

    const author = await this.auth.getAuthor(repoPath)
    try {
      await gitFor(repoPath).mergeBranches(branch, `${remote}/${branch}`, {
        author: { name: author.name, email: author.email },
        message: `Merge ${remote}/${branch} into ${branch}`,
        fastForwardOnly: state === 'behind',
      })
    } catch (err: unknown) {
      if (!conflictFiles(err)) throw err
      return { outcome: 'set-aside', branch: await this.setAside(repoPath, branch, checkedOut, remote) }
    }
    if (checkedOut) await safeCheckout({ dir: repoPath, ref: branch, from: before })
    if (state === 'behind') return { outcome: 'fast-forwarded' }
    await this.pushBranch(repoPath, branch, remote)
    return { outcome: 'merged' }
  }

  /** GH39: moves the diverged local integration commits onto a fresh `dev-resync[-n]` branch and
   *  realigns `branch` on `<remote>/<branch>`. HEAD is moved first (same commit, no file touched —
   *  `createBranch`'s T87 technique), so the ref rewrite never desyncs a checkout. */
  private async setAside(repoPath: string, branch: string, checkedOut: boolean, remote: string): Promise<string> {
    const g = gitFor(repoPath)
    const localOid = await g.resolveOrThrow(`refs/heads/${branch}`)
    const remoteOid = await g.resolveOrThrow(`refs/remotes/${remote}/${branch}`)
    // GH173: checked out on a `dev-auto` grown from those very commits (pending changes moved off
    // the integration) — it already carries them: no second branch, "Publier" merges it.
    const current = await g.currentBranch()
    if (current && isAutoBranch(current) && await this.isMergedInto(repoPath, branch, current).catch(() => false)) {
      await g.updateRefs([{ ref: `refs/heads/${branch}`, newOid: remoteOid }])
      return current
    }
    const name = await this.nextFreeBranchName(repoPath, RESYNC_BRANCH_PREFIX)
    await g.createBranch(name, localOid)
    if (checkedOut) await g.setHeadBranch(name)
    await g.updateRefs([{ ref: `refs/heads/${branch}`, newOid: remoteOid }])
    return name
  }

  /** `prefix`, else `prefix-2`, `prefix-3`… — the first name no local branch has. */
  private async nextFreeBranchName(repoPath: string, prefix: string): Promise<string> {
    const existing = new Set(await gitFor(repoPath).refNames('refs/heads'))
    let name = prefix
    for (let n = 2; existing.has(name); n += 1) name = `${prefix}-${n}`
    return name
  }

  /**
   * GH173: keeps the integration branch free of pending changes, so that the auto-pull can move it
   * forward (specs/GH173-design.md §2.2). Local git operations only — never the network:
   * - idle `dev-auto[-n]` branches (not checked out, fully merged into the integration) are deleted
   *   first, so the switch below reuses the freed name;
   * - integration checked out with pending changes → a fresh `dev-auto[-n]` at the same commit,
   *   HEAD moved onto it without touching a file (`createBranch`, T87);
   * - checked out on a clean `dev-auto[-n]` fully merged into the integration → back on the
   *   integration (clean tree: the checkout can't overwrite anything), branch deleted.
   * Nothing happens without a remote (nothing to unblock) nor on a detached HEAD.
   */
  async settleAutoBranch(repoPath: string, integrationBranch: string, remote = 'origin'): Promise<AutoBranchOutcome> {
    const none: AutoBranchOutcome = { action: 'none' }
    if (!integrationBranch || !(await getRemoteUrl(repoPath, remote))) return none
    const g = gitFor(repoPath)
    const current = await g.currentBranch()

    for (const branch of await g.refNames('refs/heads')) {
      if (branch === current || !isAutoBranch(branch)) continue
      if (await this.isMergedInto(repoPath, branch, integrationBranch).catch(() => false)) {
        await this.deleteBranch(repoPath, branch).catch(() => {})
      }
    }

    if (!current) return none
    const { staged, unstaged } = await this.status(repoPath)
    const dirty = staged.length + unstaged.length > 0
    if (current === integrationBranch && dirty) {
      const branch = await this.nextFreeBranchName(repoPath, AUTO_BRANCH_PREFIX)
      await this.createBranch(repoPath, branch)
      return { action: 'switched', branch }
    }
    if (isAutoBranch(current) && !dirty
      && await this.isMergedInto(repoPath, current, integrationBranch).catch(() => false)) {
      await safeCheckout({ dir: repoPath, ref: integrationBranch })
      await this.deleteBranch(repoPath, current).catch(() => {})
      return { action: 'returned', branch: current }
    }
    return none
  }

  /**
   * GH39: one background auto-pull tick (T155) for a repo, with a single network round-trip:
   * - fetch, even with pending changes (fetch only writes remote-tracking refs) — so the
   *   integration state reflects the server;
   * - clean repo → fast-forward-only of the current branch onto its fetched remote counterpart
   *   (never a 3-way merge — T155); a branch that can't fast-forward is left alone;
   * - integration `ahead` only (a previous push failed) → push retried — push never touches files.
   * GH173: before the fetch (so offline too), `settleAutoBranch` moves pending changes off the
   * integration; whenever the integration isn't checked out, it is fast-forwarded by reference.
   * Returns the final integration state. An unreachable server (offline, DNS — GH43) is an
   * expected condition, not an error: the state as of the last fetch is returned flagged
   * `offline` (a rejected IPC handler would be logged by Electron at every tick). Other errors
   * (auth, rejected push…) propagate to the caller.
   */
  async autoSync(repoPath: string, integrationBranch: string, remote = 'origin'): Promise<IntegrationRemoteState> {
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    if (!remoteUrl) return { state: 'no-remote', ahead: 0, behind: 0 }
    // GH45: access already known to be revoked — no network call (and no new error) per tick until
    // the user logs in again on this host.
    const revoked = async (): Promise<IntegrationRemoteState> => ({
      ...(await this.integrationState(repoPath, integrationBranch, remote)),
      accessRevoked: true,
      revokedServer: new URL(remoteUrl).origin,
    })
    // A local git failure here must not cost the tick its fetch and push retry.
    await this.settleAutoBranch(repoPath, integrationBranch, remote)
      .catch(err => console.warn(`[autoSync] ${repoPath}: settleAutoBranch failed:`, err))
    if (/^https?:\/\//i.test(remoteUrl) && this.auth.isAccessRevoked(extractHost(remoteUrl))) return revoked()
    const offline = async (err: unknown): Promise<IntegrationRemoteState> => {
      if (err instanceof ForgeAccessError && err.issue.status === 401) return revoked()
      if (!isNetworkUnreachable(err)) throw err
      return { ...(await this.integrationState(repoPath, integrationBranch, remote)), offline: true }
    }
    try {
      await this.fetch(repoPath, '', remote)
    } catch (err) {
      return offline(err)
    }

    const g = gitFor(repoPath)
    const current = await g.currentBranch()
    const { staged, unstaged } = await this.status(repoPath)
    if (current && staged.length + unstaged.length === 0) {
      const hasRemoteBranch = await g.resolve(`refs/remotes/${remote}/${current}`).then(oid => oid !== null, () => false)
      if (hasRemoteBranch) {
        // Commit du working directory avant que la fusion n'avance la branche par référence.
        const before = await g.resolveOrThrow(`refs/heads/${current}`)
        const author = await this.auth.getAuthor(repoPath)
        // Avance rapide seulement : la ref bouge (oid ≠ `before`), déjà fusionné → inchangé.
        const fastForwarded = await g
          .mergeBranches(current, `${remote}/${current}`, {
            author: { name: author.name, email: author.email },
            fastForwardOnly: true,
          })
          .then(r => r.oid !== before, () => false)
        if (fastForwarded) await safeCheckout({ dir: repoPath, ref: current, from: before })
      }
    }
    // GH173: not checked out → only its ref moves, never the working directory. Only while the
    // current branch holds no commit of its own (pending changes at most): a work branch with
    // commits may be in a publication whose merge editor recorded the integration's tip — moving
    // it would turn that resolution stale (GH37).
    if (current && current !== integrationBranch
      && await this.isMergedInto(repoPath, current, integrationBranch).catch(() => false)) {
      await this.fastForwardBranch(repoPath, integrationBranch, remote).catch(() => {})
    }

    const state = await this.integrationState(repoPath, integrationBranch, remote)
    if (state.state !== 'ahead') return state
    try {
      await this.pushBranch(repoPath, integrationBranch, remote)
    } catch (err) {
      return offline(err)
    }
    return this.integrationState(repoPath, integrationBranch, remote)
  }

  async graph(repoPath: string, limit = 100): Promise<GraphCommit[]> {
    const g = gitFor(repoPath)
    const headSha = await g.resolve('HEAD').catch(() => null) ?? ''
    const refs = await g.refCommits(['refs/heads', 'refs/remotes/origin', 'refs/tags']).catch(() => [])

    // sha → ref names (local branches + remote branches + tags)
    const refMap = new Map<string, string[]>()
    const label = (ref: string): string | null => {
      if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length)
      if (ref.startsWith('refs/remotes/origin/')) return ref === 'refs/remotes/origin/HEAD' ? null : ref.slice('refs/remotes/'.length)
      if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length)
      return null
    }
    const byKind = (prefix: string) => refs.filter(r => r.ref.startsWith(prefix))
    for (const r of [...byKind('refs/heads/'), ...byKind('refs/remotes/origin/'), ...byKind('refs/tags/')]) {
      const name = label(r.ref)
      if (!name || !r.commit) continue
      const arr = refMap.get(r.commit) ?? []; arr.push(name); refMap.set(r.commit, arr)
    }

    // GH337 — un seul `git log` sur HEAD, les branches locales et distantes et les tags (au lieu d'un
    // journal de `limit` commits par ref), puis le même tri par date d'auteur.
    // Sélecteurs de git plutôt que la liste des oid : pas de limite de longueur de ligne de commande.
    if (!headSha && refs.length === 0) return []
    const tips = [...(headSha ? ['HEAD'] : []), '--branches', '--remotes=origin', '--tags']
    let commits: Awaited<ReturnType<GitBackend['log']>>
    try {
      commits = await g.log(tips, { limit })
    } catch {
      return []
    }
    const all: GraphCommit[] = commits.map(c => ({
      sha: c.oid,
      short: c.oid.slice(0, 7),
      message: c.message.split('\n')[0],
      author: c.author.name,
      date: new Date(c.author.timestamp * 1000).toISOString(),
      refs: refMap.get(c.oid) ?? [],
      isCurrent: c.oid === headSha,
      parents: c.parents,
    }))
    return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
  }

  async tags(repoPath: string): Promise<string[]> {
    try {
      return await gitFor(repoPath).refNames('refs/tags')
    } catch {
      return []
    }
  }

  async createTag(repoPath: string, tagName: string, commitSha?: string): Promise<void> {
    const g = gitFor(repoPath)
    const sha = commitSha ?? await g.resolveOrThrow('HEAD')
    // Jamais d'écrasement d'un tag existant (`oldOid: null` : la ref ne doit pas exister).
    await g.updateRefs([{ ref: `refs/tags/${tagName}`, newOid: sha, oldOid: null }])
  }

  /** Annotated tag carrying a message (e.g. a baseline comment) — unlike `createTag`, readable back via `git.readTag`. */
  async createAnnotatedTag(repoPath: string, tagName: string, message: string, commitSha?: string): Promise<void> {
    const g = gitFor(repoPath)
    const sha = commitSha ?? await g.resolveOrThrow('HEAD')
    const author = await this.auth.getAuthor(repoPath)
    await g.annotatedTag(tagName, sha, message, { name: author.name, email: author.email })
  }

  /** HEAD commit sha, or null when the repo has no commit yet. */
  async resolveHead(repoPath: string): Promise<string | null> {
    try {
      return await gitFor(repoPath).resolve('HEAD')
    } catch {
      return null
    }
  }

  /**
   * T175 — files whose working-tree content differs from HEAD (staged, unstaged and untracked
   * alike — the index is irrelevant, disk is compared to HEAD), restricted to `prefixes`.
   * GH337 — d'après `GitBackend.status()` : index et disque combinés (HEAD → index → disque). Un
   * fichier indexé puis ramené sur disque au contenu de HEAD (`MM`) compte comme modifié.
   */
  async workdirChangesVsHead(repoPath: string, prefixes: string[]): Promise<{ path: string; change: 'added' | 'removed' | 'modified' }[]> {
    if (prefixes.length === 0) return []
    let entries: StatusEntry[]
    try {
      entries = await gitFor(repoPath).status({ prefixes })
    } catch {
      return []
    }
    const g = gitFor(repoPath)
    const changes = new Map<string, 'added' | 'removed' | 'modified'>()
    // Index identique à HEAD (`.X`, `??`) : le statut compare déjà le disque à HEAD.
    const staged = new Set(entries.filter(e => e.index !== '.' && e.index !== '?' && e.index !== '!').map(e => e.path))
    for (const e of entries) {
      if (e.index === '!' || staged.has(e.path)) continue
      if (e.index === '?') changes.set(e.path, 'added')
      else if (e.worktree === 'D') changes.set(e.path, 'removed')
      else changes.set(e.path, 'modified')
    }
    // Index différent de HEAD (`D.` + `??`, `MM`, `A.`…) : on compare directement le disque à HEAD,
    // contenu filtré (.gitattributes), l'index n'entrant pas en compte.
    if (staged.size > 0) {
      const paths = [...staged]
      const onDisk = paths.filter(p => fs.existsSync(path.join(repoPath, p)))
      const diskOid = new Map((await g.hashFiles(onDisk).catch(() => [] as string[])).map((oid, i) => [onDisk[i], oid]))
      for (const p of paths) {
        const head = (await g.objectInfo(`HEAD:${p}`))?.oid ?? null
        const disk = diskOid.get(p) ?? null
        if (!head && disk) changes.set(p, 'added')
        else if (head && !disk) changes.set(p, 'removed')
        else if (head && disk && head !== disk) changes.set(p, 'modified')
      }
    }
    return [...changes].map(([p, change]) => ({ path: p, change }))
  }

  /** Resolves a tag name to its commit sha, lightweight or annotated (a baseline: GH21, `resolveRef`
   * alone stops at the tag object). Returns null if the tag doesn't exist. */
  async resolveTag(repoPath: string, tagName: string): Promise<string | null> {
    try {
      return await gitFor(repoPath).resolveCommit(`refs/tags/${tagName}`)
    } catch {
      return null
    }
  }

  /** GH199 — borne d'un change « sur l'existant » : tag, puis SHA (complet ou abrégé) d'un commit. */
  async resolveCommitish(repoPath: string, ref: string): Promise<string | null> {
    const tag = await this.resolveTag(repoPath, ref)
    if (tag) return tag
    // Un SHA seulement (pas un nom de branche) ; abrégé ambigu ou absent → null.
    const sha = ref.trim().toLowerCase()
    if (!/^[0-9a-f]{4,40}$/.test(sha)) return null
    try {
      return await gitFor(repoPath).resolveCommit(sha)
    } catch {
      return null
    }
  }

  /** Tags qui visent directement `commitSha` (un tag annoté vise son objet tag, pas le commit). */
  async tagsForCommit(repoPath: string, commitSha: string): Promise<string[]> {
    try {
      return (await gitFor(repoPath).refs(['refs/tags']))
        .filter(r => r.oid === commitSha)
        .map(r => r.ref.slice('refs/tags/'.length))
    } catch {
      return []
    }
  }

  async pinnedSubmoduleCommit(repoPath: string, submoduleName: string): Promise<string | null> {
    try {
      const entries = await gitFor(repoPath).lsTree('HEAD', { prefix: 'components', recursive: false })
      return entries.find(e => e.path === `components/${submoduleName}`)?.oid ?? null
    } catch {
      return null
    }
  }

  async diff(repoPath: string, filepath: string): Promise<FileDiffContents> {
    const headSha = await resolveCommitSha(repoPath, 'HEAD')
    return fileDiffContents(repoPath, filepath, headSha, null, headSha === null)
  }

  async commitFiles(repoPath: string, sha: string): Promise<SyncFileStatus[]> {
    const g = gitFor(repoPath)
    const commit = await readCommitOrThrow(g, sha)
    // Initial commit: everything is Added (diff against the empty tree).
    return toFileStatuses(await g.diffNames(commit.parents[0] ?? null, commit.oid))
  }

  async commitDiff(repoPath: string, sha: string, filepath: string): Promise<FileDiffContents> {
    const commit = await readCommitOrThrow(gitFor(repoPath), sha)
    const parentSha = commit.parents[0] ?? null
    return fileDiffContents(repoPath, filepath, parentSha, sha, parentSha === null)
  }

  /** Local branches, then (GH367) the branches present only on `origin` — a clone only creates the
   *  forge's default branch locally, so without them another user never sees the other `int-*`. */
  async listBranches(repoPath: string): Promise<{ name: string; isCurrent: boolean; type: 'int' | 'dev' | 'other'; remoteOnly?: boolean }[]> {
    const g = gitFor(repoPath)
    const branches = await g.refNames('refs/heads')
    const remotes = await g.refNames('refs/remotes/origin').catch(() => [] as string[])
    const current = await g.currentBranch().catch(() => '')
    const local = new Set(branches)
    const typeOf = (name: string) => name.startsWith('int-') ? 'int' as const : name.startsWith('dev-') ? 'dev' as const : 'other' as const
    return [
      ...branches.map(name => ({ name, isCurrent: name === current, type: typeOf(name) })),
      ...remotes.filter(name => name !== 'HEAD' && !local.has(name)).sort()
        .map(name => ({ name, isCurrent: false, type: typeOf(name), remoteOnly: true })),
    ]
  }

  /**
   * Creates `name` at the current HEAD and switches to it — without writing a single file to the
   * working directory nor the index (T87): uncommitted edits sitting in the working directory at the
   * moment of creation (the routine case now that editing happens directly on the integration
   * branch, deferred to "Publier") stay as they are. Only HEAD moves (`symbolic-ref`).
   */
  async createBranch(repoPath: string, name: string): Promise<void> {
    // GH314 — HEAD left on an annotated tag object (checkout before the fix): branch from its commit.
    const g = gitFor(repoPath)
    const head = await g.resolve('HEAD').catch(() => null)
    const object = head && ((await g.resolveCommit(head).catch(() => null)) ?? head)
    // Dépôt sans commit : seul HEAD change (la branche naîtra au premier commit).
    if (object) await g.createBranch(name, object)
    await g.setHeadBranch(name)
  }

  /**
   * GH138 — `name` may be a remote-tracking label (`origin/<branch>`, as shown in the graph).
   * Checking it out as-is would detach HEAD; like `git switch <branch>`, the local `<branch>` is
   * checked out instead, created on `origin/<branch>` (with its upstream) when it doesn't exist.
   * An existing local branch is never moved: `remote` tells the caller where it stands against
   * `origin/<branch>` (`behind` → the caller may offer a fast-forward, `diverged` → report it).
   */
  async checkoutBranch(repoPath: string, name: string): Promise<CheckoutBranchResult> {
    const g = gitFor(repoPath)
    const tracking = await this.remoteTrackingBranch(repoPath, name)
    if (!tracking) {
      // GH314 — a tag (no local branch of that name) is checked out by its commit: for an
      // annotated tag, `git.checkout` would otherwise write the tag object's id into HEAD.
      const isBranch = await g.resolve(`refs/heads/${name}`).then(oid => oid !== null, () => false)
      const tagCommit = isBranch ? null : await this.resolveTag(repoPath, name)
      await safeCheckout({ dir: repoPath, ref: tagCommit ?? name })
      return { branch: name }
    }
    const { remote, branch } = tracking
    const remoteOid = await g.resolveOrThrow(`refs/remotes/${remote}/${branch}`)
    const localOid = await g.resolve(`refs/heads/${branch}`).catch(() => null)
    let state: CheckoutBranchResult['remote']
    if (!localOid) {
      await g.createBranch(branch, remoteOid)
      await g.setConfig(`branch.${branch}.remote`, remote)
      await g.setConfig(`branch.${branch}.merge`, `refs/heads/${branch}`)
      state = 'created'
    } else if (localOid === remoteOid) {
      state = 'up-to-date'
    } else if (await g.isAncestor(localOid, remoteOid).catch(() => false)) {
      state = 'behind'
    } else if (await g.isAncestor(remoteOid, localOid).catch(() => false)) {
      state = 'ahead'
    } else {
      state = 'diverged'
    }
    await safeCheckout({ dir: repoPath, ref: branch })
    return { branch, remote: state, remoteRef: `${remote}/${branch}` }
  }

  /** GH138 — `<remote>/<branch>` when `name` is a remote-tracking ref and not a local branch. */
  private async remoteTrackingBranch(repoPath: string, name: string): Promise<{ remote: string; branch: string } | null> {
    const slash = name.indexOf('/')
    if (slash <= 0) return null
    const g = gitFor(repoPath)
    const isLocal = await g.resolve(`refs/heads/${name}`).then(oid => oid !== null, () => false)
    if (isLocal) return null
    const remote = name.slice(0, slash)
    const branch = name.slice(slash + 1)
    const remotes = await g.remotes().catch(() => [])
    if (!branch || !remotes.some(r => r.name === remote)) return null
    const exists = await g.resolve(`refs/remotes/${remote}/${branch}`).then(oid => oid !== null, () => false)
    return exists ? { remote, branch } : null
  }

  async deleteBranch(repoPath: string, name: string): Promise<void> {
    await gitFor(repoPath).deleteBranch(name)
  }

  async merge(repoPath: string, fromBranch: string): Promise<MergeResult> {
    const currentBranch = await gitFor(repoPath).currentBranch()
    if (!currentBranch) throw new Error('Detached HEAD — cannot merge')
    return this.mergeBranch(repoPath, fromBranch, currentBranch)
  }

  async mergeInto(repoPath: string, fromBranch: string, intoBranch: string): Promise<MergeResult> {
    return this.mergeBranch(repoPath, fromBranch, intoBranch)
  }

  /**
   * `git.merge` (isomorphic-git) only moves the `intoBranch` ref — merge commit or fast-forward —
   * and never touches the index nor the working directory. When `intoBranch` is the checked-out
   * branch, both would be left on the old tree: `git status` then shows the merged changes as
   * staged reversals, and the next commit silently undoes the merge (GH42). So, for the
   * checked-out branch only: the tree must be clean beforehand (re-checked here, the UI guard
   * relies on a polled status), and the working directory is realigned on the new HEAD after.
   * Merging into a branch that is not checked out (Publier's `mergeInto` from `dev-*`) is
   * unchanged.
   */
  private async mergeBranch(repoPath: string, fromBranch: string, intoBranch: string): Promise<MergeResult> {
    const g = gitFor(repoPath)
    const checkedOut = (await g.currentBranch()) === intoBranch
    if (checkedOut) {
      const status = await this.status(repoPath)
      if (status.staged.length + status.unstaged.length > 0) throw new Error('Uncommitted changes — cannot merge')
    }
    const before = await g.resolveOrThrow(intoBranch)
    const author = await this.auth.getAuthor(repoPath)
    try {
      const result = await g.mergeBranches(intoBranch, fromBranch, {
        author: { name: author.name, email: author.email },
        message: `Merge branch '${fromBranch}' into ${intoBranch}`,
      })
      if (checkedOut && result.oid !== before) {
        // La fusion n'a déplacé que la ref : index et disque réalignés sur la nouvelle pointe.
        await g.checkout(intoBranch, { force: true })
      }
      return { success: true, sha: result.oid }
    } catch (err: unknown) {
      const conflicts = conflictFiles(err)
      // GH37: the refs let the caller open the merge editor (gauche = branche mergée).
      if (conflicts) return { success: false, conflicts, leftRef: fromBranch, rightRef: intoBranch }
      throw err
    }
  }

  async createBranchAt(repoPath: string, name: string, sha: string): Promise<void> {
    await gitFor(repoPath).createBranch(name, sha)
  }

  async deleteRemoteBranch(repoPath: string, name: string, remote = 'origin'): Promise<void> {
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    await this.guarded(remoteUrl, true, () => gitFor(repoPath).push(remote, [`:refs/heads/${name}`], {
      credentials: credentialsFor(this.auth, remoteUrl),
    }))
  }

  async deleteTag(repoPath: string, tagName: string): Promise<void> {
    await assertNotVersionTag(repoPath, tagName)
    const g = gitFor(repoPath)
    // Comme `git.deleteRef` : un tag absent n'est pas une erreur.
    if (await g.resolve(`refs/tags/${tagName}`)) await g.updateRefs([{ ref: `refs/tags/${tagName}`, newOid: null }])
  }

  async pushBranch(repoPath: string, branchName: string, remote = 'origin'): Promise<void> {
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    await this.guarded(remoteUrl, true, () => gitFor(repoPath).push(remote, [`refs/heads/${branchName}:refs/heads/${branchName}`], {
      credentials: credentialsFor(this.auth, remoteUrl),
    }))
    await this.pushPendingTags(repoPath, remote)
  }

  /** GH268 — tags pas encore poussés : en attente du prochain push, ou d'un nouvel essai après un échec. */
  async pendingTags(repoPath: string): Promise<string[]> {
    const file = await pendingTagsFile(repoPath).catch(() => null)
    return file ? readPendingTags(file) : []
  }

  /** GH201 — tag d'une version released, poussé au prochain push du repo (`pushPendingTags`). */
  async queueTagPush(repoPath: string, tag: string): Promise<void> {
    const file = await pendingTagsFile(repoPath)
    await this.updatePendingTags(file, tags => tags.includes(tag) ? tags : [...tags, tag])
  }

  private readonly pendingTagsQueues = new Map<string, Promise<unknown>>()

  /** Lecture-modification-écriture de la liste des tags en attente, sérialisée par fichier. */
  private updatePendingTags(file: string, fn: (tags: string[]) => string[]): Promise<void> {
    const prev = this.pendingTagsQueues.get(file) ?? Promise.resolve()
    const task = async () => {
      const next = fn(await readPendingTags(file))
      await fsP.writeFile(file, next.length > 0 ? next.join('\n') + '\n' : '', 'utf-8')
    }
    const run = prev.then(task, task)
    this.pendingTagsQueues.set(file, run.then(() => undefined, () => undefined))
    return run
  }

  /**
   * GH201 — pousse les tags en attente après un push réussi de la branche ; un tag poussé sort de la
   * liste, un échec le laisse en attente sans faire échouer le push qui vient de réussir.
   */
  async pushPendingTags(repoPath: string, remote = 'origin'): Promise<string[]> {
    const file = await pendingTagsFile(repoPath).catch(() => null)
    const tags = file ? await readPendingTags(file) : []
    if (!file || tags.length === 0) return []
    const remoteUrl = await getRemoteUrl(repoPath, remote)
    if (!remoteUrl) return []
    const g = gitFor(repoPath)
    const pushed: string[] = []
    for (const tag of tags) {
      try {
        await this.guarded(remoteUrl, true, () => g.push(remote, [`refs/tags/${tag}:refs/tags/${tag}`], {
          credentials: credentialsFor(this.auth, remoteUrl),
        }))
        pushed.push(tag)
      } catch (err) {
        console.warn(`[sync] Tag ${tag} non poussé (reste en attente) :`, err)
      }
    }
    // Relue : un tag mis en attente pendant le push y reste.
    if (pushed.length > 0) await this.updatePendingTags(file, current => current.filter(t => !pushed.includes(t)))
    return pushed
  }

  async rebase(repoPath: string, onto: string): Promise<void> {
    const g = gitFor(repoPath)
    try {
      const author = await this.auth.getAuthor(repoPath)
      await g.rebase(onto, { name: author.name, email: author.email })
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
        await g.rebaseAbort().catch(() => {})
      }
      // Prefer stderr (actual git output) over message (just the command line)
      const stderr = (err as { stderr?: string }).stderr
      const msg = stderr?.trim() || (err instanceof Error ? err.message : String(err))
      throw new Error(`Rebase failed: ${msg}`)
    }
  }

  /**
   * GH200 — diff d'un élément entre sa version de départ et un état ultérieur : `baseSha` null =
   * création (côté gauche vide), `newSha` null = fichier sur disque.
   */
  async diffElement(repoPath: string, filepath: string, baseSha: string | null, newSha: string | null): Promise<FileDiffContents> {
    return fileDiffContents(repoPath, filepath, baseSha, newSha, baseSha === null)
  }

  async diffFileBetween(
    repoPath: string,
    sha1: string,
    sha2: string,
    filepath: string,
  ): Promise<FileDiffContents> {
    return fileDiffContents(repoPath, filepath, sha1, sha2, false)
  }

  async resolveRefs(repoPath: string): Promise<GitRef[]> {
    const g = gitFor(repoPath)
    // GH337 — un seul `for-each-ref` : branches locales, branches d'origin (sans HEAD), puis tags
    // (commit visé, tag annoté déréférencé ; un tag qui ne vise pas un commit est omis).
    const all = await g.refCommits(['refs/heads', 'refs/remotes/origin', 'refs/tags']).catch(() => [])
    const refs: GitRef[] = []
    for (const r of all) {
      if (r.ref.startsWith('refs/heads/')) refs.push({ name: r.ref.slice('refs/heads/'.length), sha: r.oid, type: 'branch' })
    }
    for (const r of all) {
      if (r.ref.startsWith('refs/remotes/origin/') && r.ref !== 'refs/remotes/origin/HEAD') {
        refs.push({ name: r.ref.slice('refs/remotes/'.length), sha: r.oid, type: 'remote-branch' })
      }
    }
    for (const r of all) {
      if (r.ref.startsWith('refs/tags/') && r.commit) refs.push({ name: r.ref.slice('refs/tags/'.length), sha: r.commit, type: 'tag' })
    }

    // Recent commits (50 last) — append only commits not already referenced above
    try {
      const commits = await g.log('HEAD', { limit: 50 })
      const seen = new Set(refs.map(r => r.sha))
      for (const c of commits) {
        if (seen.has(c.oid)) continue
        seen.add(c.oid)
        refs.push({
          name: c.oid.slice(0, 7),
          sha: c.oid,
          type: 'commit',
          short: c.oid.slice(0, 7),
          message: c.message.split('\n')[0].slice(0, 60),
        })
      }
    } catch {}

    return refs
  }

  async diffBetween(repoPath: string, sha1: string, sha2: string): Promise<SyncFileStatus[]> {
    return toFileStatuses(await gitFor(repoPath).diffNames(sha1, sha2))
  }
}

/** GH45 — `owner/repo` of an HTTPS remote URL, for user-facing messages. */
function repoLabel(remoteUrl: string): string {
  try {
    return new URL(remoteUrl).pathname.replace(/^\/+|\.git$|\/+$/g, '') || remoteUrl
  } catch {
    return remoteUrl
  }
}

/** GH201 — liste locale (non versionnée) des tags à pousser : `<gitdir>/polenta-pending-tags`. */
async function pendingTagsFile(repoPath: string): Promise<string> {
  const dotGit = path.join(repoPath, '.git')
  const stat = await fsP.stat(dotGit)
  if (stat.isDirectory()) return path.join(dotGit, 'polenta-pending-tags')
  // Worktree / sous-module : `.git` est un fichier `gitdir: <chemin>`.
  const gitdir = (await fsP.readFile(dotGit, 'utf-8')).replace(/^gitdir:\s*/, '').trim()
  return path.join(path.resolve(repoPath, gitdir), 'polenta-pending-tags')
}

async function readPendingTags(file: string): Promise<string[]> {
  const text = await fsP.readFile(file, 'utf-8').catch(() => '')
  return text.split(/\r?\n/).map(t => t.trim()).filter(Boolean)
}

async function getRemoteUrl(repoPath: string, remote: string): Promise<string | null> {
  try {
    const remotes = await gitFor(repoPath).remotes()
    return remotes.find(r => r.name === remote)?.url ?? null
  } catch {
    return null
  }
}
