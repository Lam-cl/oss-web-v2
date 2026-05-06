import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './plan.entity';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan)
    private planRepo: Repository<Plan>,
  ) {}

  async findAll(): Promise<Plan[]> {
    return this.planRepo.find({
      where: { is_active: true },
      order: { sort_order: 'ASC' },
    });
  }

  async findBySlug(slug: string): Promise<Plan> {
    return this.planRepo.findOne({ where: { slug } });
  }
}
