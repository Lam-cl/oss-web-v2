import { Device } from '../devices/device.entity';
export declare class Brand {
    id: number;
    name: string;
    slug: string;
    sort_order: number;
    is_active: boolean;
    created_at: Date;
    devices: Device[];
}
