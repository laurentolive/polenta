import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import git from 'isomorphic-git'
import type { ReadmeState, ReadmeSyncOutcome } from '@polenta/types'

import type { GitService } from '../git.service'
import { racySafeStatusMatrix } from '../racy-status.util'
import type { SyncService } from '../sync.service'

const README = 'README.md'

/** `# titre`, ligne vide, paragraphe de texte ; le reste du fichier est conservé. */
const STANDARD = /^(# [^\n]+\n\n)((?:(?![#>`|<!\-*\s])[^\n]+\n?)+)([\s\S]*)$/

/**
 * GH108 — le `README.md` suit la description du repo (spec GH103 §3.2, design §1) : commit sur
 * l'intégration, seulement si le fichier a la forme standard. Un README de forme libre n'est pas
 * réécrit, et des modifications en attente sur ce fichier ne sont jamais écrasées.
 */
export class RepoSettingsService {
  constructor(private readonly gitService: GitService, private readonly sync: SyncService) {}

  async readmeState(repoPath: string): Promise<ReadmeState> {
    const content = await this.sync.readFileAtHead(repoPath, README)
    if (content === null) return 'none'
    return STANDARD.test(content.replace(/\r\n/g, '\n')) ? 'standard' : 'free'
  }

  async syncReadme(repoPath: string, description: string): Promise<ReadmeSyncOutcome> {
    const text = description.trim()
    if (!text) throw new Error('La description est obligatoire.')
    const integration = await this.gitService.getIntegrationBranch(repoPath)
    const current = await git.currentBranch({ fs, dir: repoPath }).catch(() => undefined)
    if (current !== integration) return { status: 'not-on-integration', branch: integration }
    // GH326 — pas `git.status`, aveugle à une réécriture à taille égale dans la seconde de l'indexation.
    const row = (await racySafeStatusMatrix(repoPath, [README])).find(([filepath]) => filepath === README)
    if (row && !(row[1] === 1 && row[2] === 1 && row[3] === 1)) return { status: 'pending-changes' }

    const head = await this.sync.readFileAtHead(repoPath, README)
    let next: string
    if (head === null) {
      next = `# ${path.basename(repoPath)}\n\n${text}\n`
    } else {
      const normalized = head.replace(/\r\n/g, '\n')
      const match = STANDARD.exec(normalized)
      if (!match) return { status: 'free' }
      next = `${match[1]}${text}\n${match[3]}`
      if (next === normalized) return { status: 'unchanged' }
    }
    await this.sync.commitSingleFile(repoPath, README, next, 'Description du repo')
    await fsPromises.writeFile(path.join(repoPath, README), next, 'utf-8')
    try {
      await this.sync.pushBranch(repoPath, integration)
      return { status: 'committed' }
    } catch (err) {
      return { status: 'committed', pushError: err instanceof Error ? err.message : String(err) }
    }
  }
}
