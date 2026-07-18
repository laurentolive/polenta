import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { BranchesService } from './branches.service'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { CreateBranchSchema, type CreateBranchDto } from '@polenta/zod-schemas'

@Controller('projects/:projectId/branches')
export class BranchesController {
  constructor(private readonly service: BranchesService) {}

  @Get()
  findAll(@Param('projectId') projectId: string) {
    return this.service.getAll(projectId)
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateBranchSchema)) dto: CreateBranchDto,
  ) {
    return this.service.create(projectId, dto)
  }

  @Post(':id/merge')
  merge(
    @Param('projectId') projectId: string,
    @Param('id') branchId: string,
    @Body() body: { targetBranchId: string },
  ) {
    return this.service.merge(projectId, branchId, body.targetBranchId)
  }

  @Get(':id/conflicts')
  conflicts(@Param('projectId') projectId: string, @Param('id') branchId: string) {
    return this.service.getConflicts(projectId, branchId)
  }
}
