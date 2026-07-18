import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common'
import { TraceabilityService } from './traceability.service'
import { AcknowledgeImpactSchema, GenerateTestPlanSchema } from '@polenta/zod-schemas'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import type { MatrixFiltersDto } from '@polenta/zod-schemas'

@Controller('projects/:projectId/branches/:branchId/traceability')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  @Get('matrix')
  getMatrix(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Query() query: Record<string, string>,
  ) {
    const filters: MatrixFiltersDto = {
      type: query['type'],
      status: query['status'],
      parentId: query['parentId'],
      tags: query['tags'] ? query['tags'].split(',').filter(Boolean) : undefined,
      testType: query['testType'] as MatrixFiltersDto['testType'],
    }
    return this.traceabilityService.getMatrix(projectId, branchId, filters)
  }

  @Get('missing-links')
  getMissingLinks(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
  ) {
    return this.traceabilityService.getMissingLinks(projectId, branchId)
  }

  @Get('impact/:reqId')
  getImpactReport(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('reqId') reqId: string,
    @Query('depth') depth?: string,
  ) {
    return this.traceabilityService.getImpactReport(projectId, branchId, reqId, depth ? parseInt(depth, 10) : 1)
  }

  @Post('impact/:reqId/acknowledge')
  acknowledgeImpact(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('reqId') reqId: string,
    @Body(new ZodValidationPipe(AcknowledgeImpactSchema)) dto: any,
  ) {
    return this.traceabilityService.acknowledgeImpact(projectId, branchId, reqId, dto)
  }

  @Post('test-plan')
  generateTestPlan(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Body(new ZodValidationPipe(GenerateTestPlanSchema)) dto: any,
  ) {
    return this.traceabilityService.generateTestPlan(projectId, branchId, dto)
  }

  @Get('export/csv')
  exportCsv(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Query() query: Record<string, string>,
  ) {
    const filters: MatrixFiltersDto = {
      type: query['type'],
      status: query['status'],
      parentId: query['parentId'],
      tags: query['tags'] ? query['tags'].split(',').filter(Boolean) : undefined,
      testType: query['testType'] as MatrixFiltersDto['testType'],
    }
    return this.traceabilityService.exportCsv(projectId, branchId, filters)
  }
}
