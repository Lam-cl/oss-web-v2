import { Repository } from 'typeorm';
import { Brand } from './brand.entity';
export declare class BrandsService {
    private brandRepo;
    constructor(brandRepo: Repository<Brand>);
    findAll(): Promise<Brand[]>;
    findBySlug(slug: string): Promise<Brand>;
    findById(id: number): Promise<Brand>;
}
