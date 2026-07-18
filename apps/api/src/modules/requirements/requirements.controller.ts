import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { RequirementsService } from './requirements.service'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import {
  CreateRequirementSchema,
  UpdateRequirementSchema,
  TransitionRequirementSchema,
  type CreateRequirementDto,
  type UpdateRequirementDto,
  type TransitionRequirementDto,
} from '@polenta/zod-schemas'

@Controller('projects/:projectId/branches/:branchId/requirements')
export class RequirementsController {
  constructor(private readonly service: RequirementsService) {}

  @Get('debug')
  async debug(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
  ) {
    try {
      const result = await this.service.findAll(projectId, branchId, {})
      return { ok: true, count: result.length }
    } catch (err: any) {
      return { ok: false, error: err?.message, stack: err?.stack?.split('\n').slice(0, 5) }
    }
  }

  @Get()
  findAll(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Query('objectTypeRef') objectTypeRef?: string,
    @Query('status') status?: string,
    @Query('q') search?: string,
  ) {
    return this.service.findAll(projectId, branchId, { objectTypeRef, status, search })
  }

  @Get(':id')
  findOne(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(projectId, branchId, id)
  }

  @Get(':id/links')
  findLinks(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.service.findLinks(projectId, branchId, id)
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Body(new ZodValidationPipe(CreateRequirementSchema)) dto: CreateRequirementDto,
  ) {
    return this.service.create(projectId, branchId, dto)
  }

  @Patch(':id')
  update(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateRequirementSchema)) dto: UpdateRequirementDto,
  ) {
    return this.service.update(projectId, branchId, id, dto)
  }

  @Post(':id/transition')
  transition(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransitionRequirementSchema)) dto: TransitionRequirementDto,
  ) {
    return this.service.transition(projectId, branchId, id, dto)
  }

}
