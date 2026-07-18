import { Controller, Post, Body, Param } from '@nestjs/common'
import { IndexerService } from './indexer.service'

@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexer: IndexerService) {}

  // Called by git post-commit hook or manually
  @Post('sync/:projectId')
  async sync(
    @Param('projectId') projectId: string,
    @Body() body: { branch: string; commitSha: string },
  ) {
    await this.indexer.syncCommit(projectId, body.branch, body.commitSha)
    return { ok: true }
  }

  @Post('reindex/:projectId')
  async reindex(@Param('projectId') projectId: string) {
    await this.indexer.reindexProject(projectId)
    return { ok: true }
  }
}
