import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Order } from '../orders/order.entity';
import { WhatsAppService } from './whatsapp.service';
export declare class PaymentService {
    private orderRepo;
    private httpService;
    private configService;
    private whatsappService;
    private readonly logger;
    private bundleApiUrl;
    private frontendUrl;
    private backendUrl;
    constructor(orderRepo: Repository<Order>, httpService: HttpService, configService: ConfigService, whatsappService: WhatsAppService);
    getFrontendUrl(): string;
    initiateSwiftPayment(checkoutData: any): Promise<any>;
    initiateGkashPayment(data: {
        orderId: string;
        amount: number;
        customerName: string;
        customerEmail: string;
        description?: string;
    }): Promise<{
        success: boolean;
        paymentUrl: any;
        paymentParams: any;
        cartId: any;
        error?: undefined;
    } | {
        success: boolean;
        error: any;
        paymentUrl?: undefined;
        paymentParams?: undefined;
        cartId?: undefined;
    }>;
    processPaymentReturn(params: Record<string, string>): Promise<{
        success: boolean;
        refNo: string;
        source: string;
        alreadyProcessed: boolean;
    }>;
    private markOrderPaid;
    private markOrderFailed;
    startPaymentPolling(refNo: string): void;
    processGkashReturn(data: any): Promise<{
        status: any;
        statusMessage: string;
        orderId: any;
        transactionId: any;
        amount: any;
    }>;
    processGkashCallback(data: any): Promise<{
        status: any;
        statusMessage: string;
        orderId: any;
        transactionId: any;
        amount: any;
        success: boolean;
    }>;
}
