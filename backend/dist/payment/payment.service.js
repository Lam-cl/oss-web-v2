"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var PaymentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
const order_entity_1 = require("../orders/order.entity");
const whatsapp_service_1 = require("./whatsapp.service");
let PaymentService = PaymentService_1 = class PaymentService {
    constructor(orderRepo, httpService, configService, whatsappService) {
        this.orderRepo = orderRepo;
        this.httpService = httpService;
        this.configService = configService;
        this.whatsappService = whatsappService;
        this.logger = new common_1.Logger(PaymentService_1.name);
        this.bundleApiUrl = this.configService.get('BUNDLE_API_URL', 'https://bundleapi.tonewow.com/api');
        this.frontendUrl = this.configService.get('FRONTEND_URL', 'https://shop.tonewow.com');
        this.backendUrl = this.configService.get('BACKEND_URL', 'https://shop.tonewow.com/api');
    }
    getFrontendUrl() {
        return this.frontendUrl;
    }
    async initiateSwiftPayment(checkoutData) {
        try {
            const FormData = (await Promise.resolve().then(() => __importStar(require('form-data')))).default;
            const fd = new FormData();
            fd.append('checkoutData', JSON.stringify(checkoutData));
            const url = `${this.bundleApiUrl}/payment/swiftpay/initiate-with-order-guest`;
            this.logger.log(`SwiftPay initiate: ${url}`);
            const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.post(url, fd, {
                headers: {
                    ...fd.getHeaders(),
                    Accept: 'application/json',
                },
            }));
            return data;
        }
        catch (err) {
            this.logger.error('SwiftPay error:', err?.response?.data || err.message);
            if (err?.response?.data)
                return err.response.data;
            return { success: false, message: err.message || 'SwiftPay request failed' };
        }
    }
    async initiateGkashPayment(data) {
        try {
            const { data: gkashData } = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${this.bundleApiUrl}/payment/gkash/initiate`, {
                amount: data.amount,
                orderId: data.orderId,
                customerName: data.customerName,
                description: data.description || `tone wow Order ${data.orderId}`,
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
            }));
            if (!gkashData.success) {
                throw new Error('Failed to initiate GKash payment');
            }
            const paymentParams = {
                ...gkashData.paymentParams,
                returnurl: `${this.backendUrl}/payment/gkash/return`,
                callbackurl: `${this.backendUrl}/payment/gkash/callback`,
                failureurl: `${this.backendUrl}/payment/gkash/return`,
            };
            await this.orderRepo.update({ order_number: data.orderId }, { payment_method: 'gkash', status: 'awaiting_payment' });
            this.logger.log(`GKash payment initiated for order ${data.orderId}`);
            return {
                success: true,
                paymentUrl: gkashData.paymentUrl,
                paymentParams,
                cartId: gkashData.cartId,
            };
        }
        catch (error) {
            this.logger.error(`Payment initiation failed: ${error.message}`);
            return {
                success: false,
                error: error.message || 'Payment initiation failed',
            };
        }
    }
    async processPaymentReturn(params) {
        this.logger.log(`Payment return received: ${JSON.stringify(params)}`);
        const refNo = params.refNo || params.RefNo || params.ref_no || '';
        if (!refNo)
            return { success: false, refNo: '', source: 'none', alreadyProcessed: false };
        const order = await this.orderRepo.findOne({ where: { payment_ref: refNo } });
        if (order?.status === 'paid') {
            return { success: true, refNo, source: 'already_processed', alreadyProcessed: true };
        }
        try {
            const statusUrl = `https://www.tonewow.net/tgpayment/getPaymentStatus?refNo=${encodeURIComponent(refNo)}`;
            const { data: statusData } = await (0, rxjs_1.firstValueFrom)(this.httpService.get(statusUrl, { timeout: 10000 }));
            this.logger.log(`getPaymentStatus response: ${JSON.stringify(statusData).substring(0, 300)}`);
            const paymentStatus = statusData?.data?.[0]?.status;
            if (paymentStatus === '2') {
                await this.markOrderPaid(refNo, refNo);
                return { success: true, refNo, source: 'tgpayment', alreadyProcessed: false };
            }
            if (paymentStatus === '1') {
                return { success: false, refNo, source: 'tgpayment_pending', alreadyProcessed: false };
            }
        }
        catch (err) {
            this.logger.warn(`getPaymentStatus failed: ${err.message}`);
        }
        return { success: false, refNo, source: 'none', alreadyProcessed: false };
    }
    async markOrderPaid(refNo, transactionId) {
        const order = await this.orderRepo.findOne({ where: { payment_ref: refNo } });
        if (!order) {
            this.logger.warn(`markOrderPaid: no order found for refNo ${refNo}`);
            return;
        }
        if (order.status === 'paid')
            return;
        await this.orderRepo.update(order.id, { status: 'paid', payment_ref: transactionId });
        this.logger.log(`Order ${order.order_number} marked as paid`);
        if (order.customer_phone) {
            await this.whatsappService.sendOrderConfirmation(order.customer_phone, order.customer_name || 'Pelanggan', refNo);
        }
    }
    async markOrderFailed(refNo) {
        await this.orderRepo.update({ payment_ref: refNo }, { status: 'payment_failed' });
    }
    startPaymentPolling(refNo) {
        const maxAttempts = 20;
        let attempt = 0;
        const poll = async () => {
            attempt++;
            this.logger.log(`Payment poll #${attempt} for refNo: ${refNo}`);
            const order = await this.orderRepo.findOne({ where: { payment_ref: refNo } });
            if (!order) {
                this.logger.warn(`Poll: no order with payment_ref ${refNo}`);
                return;
            }
            if (order.status === 'paid') {
                this.logger.log(`Poll: order ${order.order_number} already paid, stopping`);
                return;
            }
            const result = await this.processPaymentReturn({ refNo });
            if (result.success) {
                this.logger.log(`Poll: payment confirmed for ${refNo} via ${result.source}`);
                return;
            }
            if (attempt < maxAttempts) {
                setTimeout(poll, 30000);
            }
            else {
                this.logger.warn(`Poll: max attempts reached for ${refNo}, giving up`);
            }
        };
        setTimeout(poll, 15000);
    }
    async processGkashReturn(data) {
        this.logger.log(`GKash return received: ${JSON.stringify(data)}`);
        const cartId = data.cartid || data.CARTID || data.v_cartid || '';
        const status = data.status || data.Status || '';
        const transactionId = data.POID || data.poid || data.txnid || '';
        const amount = data.amount || data.v_amount || '';
        let orderId = cartId;
        if (cartId.includes('order-')) {
            orderId = cartId.split('order-').pop() || cartId;
        }
        let statusMessage = 'Unknown';
        if (status === '88') {
            statusMessage = 'Payment Successful';
            await this.orderRepo.update({ order_number: orderId }, { status: 'paid', payment_ref: transactionId });
            this.logger.log(`Order ${orderId} marked as paid, ref: ${transactionId}`);
        }
        else if (status === '66') {
            statusMessage = 'Payment Pending';
            await this.orderRepo.update({ order_number: orderId }, { status: 'payment_pending', payment_ref: transactionId });
        }
        else {
            statusMessage = 'Payment Failed';
            await this.orderRepo.update({ order_number: orderId }, { status: 'payment_failed', payment_ref: transactionId });
        }
        return { status, statusMessage, orderId, transactionId, amount };
    }
    async processGkashCallback(data) {
        this.logger.log(`GKash callback received: ${JSON.stringify(data)}`);
        const result = await this.processGkashReturn(data);
        try {
            await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${this.bundleApiUrl}/payment/gkash/callback`, data, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
            }));
        }
        catch (error) {
            this.logger.warn(`Bundle API callback forward failed: ${error.message}`);
        }
        return { success: true, ...result };
    }
};
exports.PaymentService = PaymentService;
exports.PaymentService = PaymentService = PaymentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        axios_1.HttpService,
        config_1.ConfigService,
        whatsapp_service_1.WhatsAppService])
], PaymentService);
//# sourceMappingURL=payment.service.js.map