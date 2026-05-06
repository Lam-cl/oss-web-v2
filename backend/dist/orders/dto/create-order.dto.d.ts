export declare class CreateOrderDto {
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    customer_ic?: string;
    shipping_address?: any;
    items: any[];
    total: number;
    payment_method?: string;
    promoter_id?: string;
    payment_ref?: string;
    shipping?: number;
}
