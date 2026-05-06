import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { QueryDeviceDto } from './dto/query-device.dto';
export declare class DevicesService {
    private deviceRepo;
    constructor(deviceRepo: Repository<Device>);
    findAll(query: QueryDeviceDto): Promise<{
        data: Device[];
        meta: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findById(id: number): Promise<Device>;
    findBySlug(slug: string): Promise<Device>;
}
