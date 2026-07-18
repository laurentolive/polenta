import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common'
import { TestsService } from './tests.service'
import { CreateTestCaseSchema, UpdateTestCaseSchema, ExecuteTestCaseSchema } from '@polenta/zod-schemas'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'

@Controller('projects/:projectId/branches/:branchId/tests')
export class TestsController {
  constructor(private readonly testsService: TestsService) {}

  @Get()
  async findAll(@Param('projectId') projectId: string, @Param('branchId') branchId: string) {
    return this.testsService.findAll(projectId, branchId)
  }

  @Get(':id')
  async findOne(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.testsService.findOne(projectId, branchId, id)
  }

  @Get(':id/runs')
  async findRuns(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.testsService.findRuns(projectId, branchId, id)
  }

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Body(new ZodValidationPipe(CreateTestCaseSchema)) dto: any,
  ) {
    return this.testsService.create(projectId, branchId, dto)
  }

  @Patch(':id')
  async update(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTestCaseSchema)) dto: any,
  ) {
    return this.testsService.update(projectId, branchId, id, dto)
  }

  @Post(':id/execute')
  async execute(
    @Param('projectId') projectId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ExecuteTestCaseSchema)) dto: any,
  ) {
    return this.testsService.execute(projectId, branchId, id, dto)
  }
}
