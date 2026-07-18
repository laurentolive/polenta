import { Module } from '@nestjs/common'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'
import { ProjectsRegistryService } from './projects-registry.service'
import { GitModule } from '../git/git.module'
import { IndexModule } from '../index/index.module'

@Module({
  imports: [GitModule, IndexModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRegistryService],
  exports: [ProjectsRegistryService],
})
export class ProjectsModule {}
