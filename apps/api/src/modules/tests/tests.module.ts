import { Module } from '@nestjs/common'
import { TestsService } from './tests.service'
import { TestsController } from './tests.controller'
import { GitModule } from '../git/git.module'
import { ProjectsModule } from '../projects/projects.module'
import { IndexModule } from '../index/index.module'

@Module({
  imports: [GitModule, ProjectsModule, IndexModule],
  controllers: [TestsController],
  providers: [TestsService],
  exports: [TestsService],
})
export class TestsModule {}
