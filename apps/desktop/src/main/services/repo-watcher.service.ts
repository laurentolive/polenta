import * as path from 'path'
import chokidar from 'chokidar'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'

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

  constructor(
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
  ) {}

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
  }

  // A ref change carries no per-object-type path — always a full invalidation, same
  // "nuke + lazy rebuild on next access" semantics as invalidateFile above.
  private onRefChanged(repoPath: string): void {
    this.reqIndex.invalidate(repoPath)
    this.testsIndex.invalidate(repoPath)
  }
}
