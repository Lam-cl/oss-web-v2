import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Banner } from './banner.entity';

@Injectable()
export class BannersService {
  constructor(
    @InjectRepository(Banner)
    private bannerRepo: Repository<Banner>,
  ) {}

  async findAll(): Promise<Banner[]> {
    return this.bannerRepo.find({
      where: { is_active: true },
      order: { sort_order: 'ASC' },
    });
  }
}
