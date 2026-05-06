export declare class Order {
    id: number;
    order_number: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    customer_ic: string;
    shipping_address: any;
    items: any[];
    subtotal: number;
    shipping_cost: number;
    total: number;
    status: string;
    payment_method: string;
    payment_ref: string;
    promoter_id: string;
    created_at: Date;
    updated_at: Date;
}
