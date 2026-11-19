import { gitFor } from '../git/git-backend'
import { assertNotVersionTag, frozenVersionTags } from './version-tags.util'

/** Noms des tags du dépôt (`[]` hors dépôt). */
async function listTagNames(repoPath: string): Promise<string[]> {
  try {
    return await gitFor(repoPath).refNames('refs/tags')
  } catch {
    return []
  }
}

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
      return (await gitFor(repoPath).resolve(`refs/tags/${tag}`)) !== null
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
    const epoch = { createdAt: new Date(0).toISOString(), message: '' }
    try {
      const g = gitFor(repoPath)
      const ref = `refs/tags/${tag}`
      const oid = await g.resolve(ref)
      if (!oid) return epoch
      const tagObj = await g.readTag(oid)
      if (tagObj?.tagger) {
        return {
          createdAt: new Date(tagObj.tagger.timestamp * 1000).toISOString(),
          message: tagObj.message.trim(),
        }
      }
      const commit = await g.readCommit(ref) // `ref^{commit}` : tag annoté sans tagger pelé
      return commit ? { createdAt: new Date(commit.committer.timestamp * 1000).toISOString(), message: '' } : epoch
    } catch {
      return epoch
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
    // GH268 — le tag d'une version n'est pas une baseline, même sans composants.
    const versionTags = await frozenVersionTags(repoPath)
    const mainTags = (await listTagNames(repoPath)).filter(tag => !versionTags.has(tag))

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
    await assertNotVersionTag(repoPath, tag)
    await gitFor(repoPath).deleteTag(tag).catch(() => {})
    for (const comp of components) {
      await gitFor(comp.repoPath).deleteTag(tag).catch(() => {})
    }
  }
}
