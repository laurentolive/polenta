import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { GitModule } from './modules/git/git.module'
import { IndexModule } from './modules/index/index.module'
import { IndexerModule } from './modules/indexer/indexer.module'
import { ProjectsModule } from './modules/projects/projects.module'
import { BranchesModule } from './modules/branches/branches.module'
import { RequirementsModule } from './modules/requirements/requirements.module'
import { TestsModule } from './modules/tests/tests.module'
import { TraceabilityModule } from './modules/traceability/traceability.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GitModule,
    IndexModule,
    IndexerModule,
    ProjectsModule,
    BranchesModule,
    RequirementsModule,
    TestsModule,
    TraceabilityModule,
  ],
})
export class AppModule {}
