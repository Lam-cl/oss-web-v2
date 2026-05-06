import { Brand } from '../brands/brand.entity';
export declare class Device {
    id: number;
    slug: string;
    name: string;
    brand: Brand;
    brand_id: number;
    tag: string;
    rrp: number;
    monthly_price: number;
    image_url: string;
    is_sold_out: boolean;
    is_api_device: boolean;
    external_id: string;
    sort_order: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}
