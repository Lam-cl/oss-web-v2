import { Repository } from 'typeorm';
import { Banner } from './banner.entity';
export declare class BannersService {
    private bannerRepo;
    constructor(bannerRepo: Repository<Banner>);
    findAll(): Promise<Banner[]>;
}
