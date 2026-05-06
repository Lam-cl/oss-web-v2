import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
export declare class OrdersController {
    private readonly ordersService;
    constructor(ordersService: OrdersService);
    create(dto: CreateOrderDto): Promise<import("./order.entity").Order>;
    findOne(id: string): Promise<import("./order.entity").Order>;
    guestCheckout(body: any): Promise<any>;
    initiatePayment(body: any): Promise<any>;
}
