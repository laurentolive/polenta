import { Injectable, Logger } from '@nestjs/common'
import { RequirementsIndexService } from '../index/requirements-index.service'

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name)

  constructor(private readonly index: RequirementsIndexService) {}

  // Called by git post-commit hook — invalidates the branch so it's rebuilt on next access
  async syncCommit(projectId: string, branch: string, _commitSha: string): Promise<void> {
    this.logger.log(`Invalidating index: ${projectId}/${branch} (commit ${_commitSha})`)
    this.index.invalidate(projectId, branch)
  }

  async reindexProject(projectId: string): Promise<void> {
    this.logger.log(`Full invalidation for project ${projectId}`)
    this.index.invalidateAll(projectId)
  }
}
