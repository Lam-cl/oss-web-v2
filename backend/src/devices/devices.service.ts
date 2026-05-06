import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { QueryDeviceDto } from './dto/query-device.dto';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private deviceRepo: Repository<Device>,
  ) {}

  async findAll(query: QueryDeviceDto) {
    const { brand, page = 1, limit = 6, search } = query;

    const qb = this.deviceRepo
      .createQueryBuilder('device')
      .leftJoinAndSelect('device.brand', 'brand')
      .where('device.is_active = :active', { active: true });

    // Filter by brand slug
    if (brand && brand !== 'all') {
      qb.andWhere('brand.slug = :brand', { brand });
    }

    // Search by name
    if (search) {
      qb.andWhere('device.name ILIKE :search', { search: `%${search}%` });
    }

    // Order: API devices first (not sold out), then sold out by sort_order
    qb.orderBy('device.is_sold_out', 'ASC')
      .addOrderBy('device.sort_order', 'ASC')
      .addOrderBy('device.id', 'ASC');

    // Pagination
    const skip = (page - 1) * limit;
    qb.skip(skip).take(limit);

    const [devices, total] = await qb.getManyAndCount();

    return {
      data: devices,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: number): Promise<Device> {
    return this.deviceRepo.findOne({
      where: { id, is_active: true },
      relations: ['brand'],
    });
  }

  async findBySlug(slug: string): Promise<Device> {
    return this.deviceRepo.findOne({
      where: { slug, is_active: true },
      relations: ['brand'],
    });
  }
}
