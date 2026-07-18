import * as fs from 'fs'
import git from 'isomorphic-git'

export interface BaselineComponentRecord {
  name: string
  tag: string
}

export interface BaselineRecord {
  tag: string
  createdAt: string
  message: string
  components: BaselineComponentRecord[]
}

export interface BaselineComponentRef {
  name: string
  repoPath: string
}

export interface CreateBaselineComponentDto {
  name: string
  tag: string
  createTag: boolean
}

export interface CreateBaselineDto {
  tag: string
  message?: string
  components: CreateBaselineComponentDto[]
}

export class BaselineService {
  private async tagExists(repoPath: string, tag: string): Promise<boolean> {
    try {
      await git.resolveRef({ fs, dir: repoPath, ref: `refs/tags/${tag}` })
      return true
    } catch {
      return false
    }
  }

  /**
   * Peels the tag ref: an annotated tag object (created via `createAnnotatedTag`, carrying a
   * baseline message) resolves to a tag object oid, so `readTag` is tried first to recover the
   * commit sha, message and tagger date. Falls back to a lightweight tag (oid is the commit itself).
   */
  private async readTagMeta(repoPath: string, tag: string): Promise<{ createdAt: string; message: string }> {
    try {
      const oid = await git.resolveRef({ fs, dir: repoPath, ref: `refs/tags/${tag}` })
      try {
        const { tag: tagObj } = await git.readTag({ fs, dir: repoPath, oid })
        return {
          createdAt: new Date(tagObj.tagger.timestamp * 1000).toISOString(),
          message: tagObj.message.trim(),
        }
      } catch {
        const { commit } = await git.readCommit({ fs, dir: repoPath, oid })
        return { createdAt: new Date(commit.committer.timestamp * 1000).toISOString(), message: '' }
      }
    } catch {
      return { createdAt: new Date(0).toISOString(), message: '' }
    }
  }

  /**
   * Lists baselines derived directly from git tags (never from a versioned file), so the list
   * no longer depends on which commit/branch happens to be checked out.
   *
   * A tag on `repoPath` counts as a baseline only if the same tag name also exists on every repo
   * in `components` — this filters out unrelated tags created ad hoc (e.g. from the commit graph
   * view) on a single repo. When `components` is empty (simple project, or a single component
   * repo picked in isolation), every tag on `repoPath` is treated as a baseline.
   */
  async list(repoPath: string, components: BaselineComponentRef[] = []): Promise<BaselineRecord[]> {
    const mainTags = await git.listTags({ fs, dir: repoPath }).catch(() => [] as string[])

    const results = await Promise.all(
      mainTags.map(async tag => {
        const componentRecords: BaselineComponentRecord[] = []
        for (const comp of components) {
          if (!(await this.tagExists(comp.repoPath, tag))) return null
          componentRecords.push({ name: comp.name, tag })
        }
        const { createdAt, message } = await this.readTagMeta(repoPath, tag)
        return { tag, createdAt, message, components: componentRecords }
      })
    )

    return results
      .filter((r): r is BaselineRecord => r !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async get(repoPath: string, tag: string, components: BaselineComponentRef[] = []): Promise<BaselineRecord | null> {
    const all = await this.list(repoPath, components)
    return all.find(b => b.tag === tag) ?? null
  }

  /** Deletes the tag on the main repo and on every component repo it was mirrored to. */
  async delete(repoPath: string, tag: string, components: BaselineComponentRef[] = []): Promise<void> {
    await git.deleteRef({ fs, dir: repoPath, ref: `refs/tags/${tag}` }).catch(() => {})
    for (const comp of components) {
      await git.deleteRef({ fs, dir: comp.repoPath, ref: `refs/tags/${tag}` }).catch(() => {})
    }
  }
}
