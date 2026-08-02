import * as path from 'path'
import chokidar from 'chokidar'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'

/**
 * `relPath` is `'*'` for a ref change (checkout/pull/merge/rebase) — no per-file signal is
 * available there (see `onRefChanged`), so listeners must treat it as "invalidate everything
 * for this repoPath" rather than trying to pattern-match a specific file.
 */
export type FileChangeListener = (repoPath: string, relPath: string) => void

export class RepoWatcherService {
  private readonly watchers = new Map<string, ReturnType<typeof chokidar.watch>>()
  // T112 — createdAt/updatedAt are now derived from git log rather than stored in the
  // YAML, so the requirements/tests index also needs to refresh whenever HEAD moves
  // (commit, merge, rebase, checkout) even when that operation touches no working-tree
  // file (e.g. a fast-forward with no diff) — invisible to the main watcher above, which
  // ignores `.git` entirely. A dedicated second watcher, scoped strictly to `.git/HEAD`
  // and `.git/refs/**` (not all of `.git` — `.git/objects`/`.git/logs` churn on every
  // loose object write and would flood this watcher for no reason).
  private readonly refWatchers = new Map<string, ReturnType<typeof chokidar.watch>>()

  private readonly listeners: FileChangeListener[] = []

  constructor(
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
  ) {}

  /**
   * Subscribes to every file change detected under a watched repo, AFTER the built-in
   * reqIndex/testsIndex invalidation above has already run. Decoupled from those two on
   * purpose — this service only detects/normalizes changes, it doesn't know or care what a
   * caller does with them (busting SchemaService's cache, pushing an IPC event to the
   * renderer for live UI sync, …). Returns an unsubscribe function.
   */
  onFileChange(listener: FileChangeListener): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i !== -1) this.listeners.splice(i, 1)
    }
  }

  watch(repoPath: string): void {
    if (this.watchers.has(repoPath)) return

    const watcher = chokidar.watch(repoPath, {
      ignored: [/\.git/, /node_modules/],
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    })

    watcher
      .on('change', (filePath) => this.onFileChanged(repoPath, filePath))
      .on('add', (filePath) => this.onFileChanged(repoPath, filePath))
      .on('unlink', (filePath) => this.onFileChanged(repoPath, filePath))

    this.watchers.set(repoPath, watcher)

    const refWatcher = chokidar.watch(
      [path.join(repoPath, '.git', 'HEAD'), path.join(repoPath, '.git', 'refs')],
      { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } },
    )

    refWatcher
      .on('change', () => this.onRefChanged(repoPath))
      .on('add', () => this.onRefChanged(repoPath))
      .on('unlink', () => this.onRefChanged(repoPath))

    this.refWatchers.set(repoPath, refWatcher)
  }

  unwatch(repoPath: string): void {
    const watcher = this.watchers.get(repoPath)
    if (watcher) {
      watcher.close()
      this.watchers.delete(repoPath)
    }
    const refWatcher = this.refWatchers.get(repoPath)
    if (refWatcher) {
      refWatcher.close()
      this.refWatchers.delete(repoPath)
    }
  }

  unwatchAll(): void {
    for (const repoPath of Array.from(this.watchers.keys())) {
      this.unwatch(repoPath)
    }
  }

  private onFileChanged(repoPath: string, absolutePath: string): void {
    const rel = path.relative(repoPath, absolutePath)
    this.reqIndex.invalidateFile(repoPath, rel)
    this.testsIndex.invalidateFile(repoPath, rel)
    // Normalized to posix separators so listeners can pattern-match a single, OS-independent
    // form (`path.relative` returns backslashes on Windows) — mirrors `rel` above but that one
    // must stay in OS form for `invalidateFile`, which re-joins it against the filesystem.
    const relPosix = rel.split(path.sep).join('/')
    for (const listener of this.listeners) listener(repoPath, relPosix)
  }

  // A ref change carries no per-object-type path — always a full invalidation, same
  // "nuke + lazy rebuild on next access" semantics as invalidateFile above.
  private onRefChanged(repoPath: string): void {
    this.reqIndex.invalidate(repoPath)
    this.testsIndex.invalidate(repoPath)
    for (const listener of this.listeners) listener(repoPath, '*')
  }
}
