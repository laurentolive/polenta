import { Module } from '@nestjs/common'
import { GitService } from './git.service'
import { SchemaService } from './schema.service'

@Module({
  providers: [GitService, SchemaService],
  exports: [GitService, SchemaService],
})
export class GitModule {}
