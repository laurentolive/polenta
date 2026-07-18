import { Module } from '@nestjs/common'
import { TraceabilityService } from './traceability.service'
import { TraceabilityController } from './traceability.controller'
import { IndexModule } from '../index/index.module'
import { GitModule } from '../git/git.module'
import { ProjectsModule } from '../projects/projects.module'

@Module({
  imports: [IndexModule, GitModule, ProjectsModule],
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
})
export class TraceabilityModule {}
