import * as fsP from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import type { PolentaRepoManifest } from '@polenta/types'

export class PolentaRepoService {
  /**
   * Read polenta-repo.yaml from a repo root.
   * Returns null if the file is absent (leaf repo).
   * Throws a ParseError if the file exists but is invalid YAML.
   */
  async readManifest(repoPath: string): Promise<PolentaRepoManifest | null> {
    const filePath = path.join(repoPath, 'polenta-repo.yaml')
    let raw: string
    try {
      raw = await fsP.readFile(filePath, 'utf-8')
    } catch {
      // File absent → leaf repo
      return null
    }

    const parsed = yaml.load(raw)
    if (parsed === null || parsed === undefined) return {}
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`[PolentaRepoService] Invalid polenta-repo.yaml in ${repoPath}: expected a YAML object`)
    }
    return parsed as PolentaRepoManifest
  }

  /**
   * Write polenta-repo.yaml to a repo root.
   */
  async writeManifest(repoPath: string, manifest: PolentaRepoManifest): Promise<void> {
    await fsP.mkdir(repoPath, { recursive: true })
    const filePath = path.join(repoPath, 'polenta-repo.yaml')
    await fsP.writeFile(filePath, yaml.dump(manifest, { lineWidth: 120 }), 'utf-8')
  }
}
