import { Module } from '@nestjs/common'
import { IndexerService } from './indexer.service'
import { IndexerController } from './indexer.controller'
import { IndexModule } from '../index/index.module'

@Module({
  imports: [IndexModule],
  providers: [IndexerService],
  controllers: [IndexerController],
})
export class IndexerModule {}
