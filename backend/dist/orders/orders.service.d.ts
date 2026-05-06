import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Order } from './order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
export declare class OrdersService {
    private orderRepo;
    private httpService;
    private configService;
    private bundleApiUrl;
    constructor(orderRepo: Repository<Order>, httpService: HttpService, configService: ConfigService);
    private generateOrderNumber;
    create(dto: CreateOrderDto): Promise<Order>;
    findByOrderNumber(orderNumber: string): Promise<Order>;
    findById(id: number): Promise<Order>;
    guestCheckout(orderData: any): Promise<any>;
    initiatePayment(paymentData: any): Promise<any>;
}
