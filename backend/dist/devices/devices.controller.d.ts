import { DevicesService } from './devices.service';
import { QueryDeviceDto } from './dto/query-device.dto';
export declare class DevicesController {
    private readonly devicesService;
    constructor(devicesService: DevicesService);
    findAll(query: QueryDeviceDto): Promise<{
        data: import("./device.entity").Device[];
        meta: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: string): Promise<import("./device.entity").Device>;
}
