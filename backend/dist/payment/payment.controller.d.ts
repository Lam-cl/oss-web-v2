import { Response } from 'express';
import { PaymentService } from './payment.service';
export declare class PaymentController {
    private readonly paymentService;
    private readonly logger;
    constructor(paymentService: PaymentService);
    handleOssPayReturn(query: any, res: Response): Promise<any>;
    handleOssPayReturnPost(body: any, res: Response): Promise<any>;
    startPolling(refNo: string): Promise<{
        success: boolean;
        message: string;
    }>;
    checkPayment(refNo: string): Promise<{
        success: boolean;
        refNo: string;
        source: string;
        alreadyProcessed: boolean;
    }>;
    initiateSwiftPay(body: any): Promise<any>;
    initiatePayment(body: {
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
    handleGkashReturn(body: any, res: Response): Promise<any>;
    handleGkashReturnGet(query: any, res: Response): Promise<any>;
    handleGkashCallback(body: any): Promise<{
        status: any;
        statusMessage: string;
        orderId: any;
        transactionId: any;
        amount: any;
        success: boolean;
    }>;
}
