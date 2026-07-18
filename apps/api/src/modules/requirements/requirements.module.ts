import { Module } from '@nestjs/common'
import { RequirementsController } from './requirements.controller'
import { RequirementsService } from './requirements.service'
import { GitModule } from '../git/git.module'
import { IndexModule } from '../index/index.module'
import { ProjectsModule } from '../projects/projects.module'

@Module({
  imports: [GitModule, IndexModule, ProjectsModule],
  controllers: [RequirementsController],
  providers: [RequirementsService],
})
export class RequirementsModule {}
