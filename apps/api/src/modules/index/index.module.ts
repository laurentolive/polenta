import { Module } from '@nestjs/common'
import { RequirementsIndexService } from './requirements-index.service'
import { TestsIndexService } from './tests-index.service'
import { GitModule } from '../git/git.module'

@Module({
  imports: [GitModule],
  providers: [RequirementsIndexService, TestsIndexService],
  exports: [RequirementsIndexService, TestsIndexService],
})
export class IndexModule {}
