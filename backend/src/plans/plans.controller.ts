import { Controller, Get, Param } from '@nestjs/common';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async findAll() {
    return this.plansService.findAll();
  }

  @Get(':slug')
  async findOne(@Param('slug') slug: string) {
    return this.plansService.findBySlug(slug);
  }
}
