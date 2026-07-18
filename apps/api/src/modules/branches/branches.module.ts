import { Module } from '@nestjs/common'
import { BranchesController } from './branches.controller'
import { BranchesService } from './branches.service'
import { GitModule } from '../git/git.module'
import { IndexModule } from '../index/index.module'
import { ProjectsModule } from '../projects/projects.module'

@Module({
  imports: [GitModule, IndexModule, ProjectsModule],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
