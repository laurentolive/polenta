import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ProjectsService } from './projects.service'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { CreateProjectSchema, type CreateProjectDto } from '@polenta/zod-schemas'

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  findAll() {
    return this.service.getAll()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.getOne(id)
  }

  @Post()
  create(@Body(new ZodValidationPipe(CreateProjectSchema)) dto: CreateProjectDto) {
    return this.service.create(dto)
  }

  @Post(':id/fork')
  fork(@Param('id') id: string, @Body() body: { name: string }) {
    return this.service.fork(id, body.name)
  }
}
