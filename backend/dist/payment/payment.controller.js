"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var PaymentController_1;
var _a, _b, _c, _d;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentController = void 0;
const common_1 = require("@nestjs/common");
const express_1 = require("express");
const payment_service_1 = require("./payment.service");
let PaymentController = PaymentController_1 = class PaymentController {
    constructor(paymentService) {
        this.paymentService = paymentService;
        this.logger = new common_1.Logger(PaymentController_1.name);
    }
    async handleOssPayReturn(query, res) {
        this.logger.log(`OSS return GET: ${JSON.stringify(query)}`);
        const result = await this.paymentService.processPaymentReturn(query);
        const frontendUrl = this.paymentService.getFrontendUrl();
        if (result.alreadyProcessed || result.success) {
            return res.redirect(`${frontendUrl}/sim/purchase/success?refNo=${encodeURIComponent(result.refNo)}&source=${result.source}`);
        }
        return res.redirect(`${frontendUrl}/sim/purchase/failed?refNo=${encodeURIComponent(result.refNo)}`);
    }
    async handleOssPayReturnPost(body, res) {
        this.logger.log(`OSS return POST: ${JSON.stringify(body)}`);
        const result = await this.paymentService.processPaymentReturn(body);
        const frontendUrl = this.paymentService.getFrontendUrl();
        if (result.alreadyProcessed || result.success) {
            return res.redirect(`${frontendUrl}/sim/purchase/success?refNo=${encodeURIComponent(result.refNo)}&source=${result.source}`);
        }
        return res.redirect(`${frontendUrl}/sim/purchase/failed?refNo=${encodeURIComponent(result.refNo)}`);
    }
    async startPolling(refNo) {
        this.logger.log(`Starting payment poll for refNo: ${refNo}`);
        this.paymentService.startPaymentPolling(refNo);
        return { success: true, message: 'Polling started' };
    }
    async checkPayment(refNo) {
        const result = await this.paymentService.processPaymentReturn({ refNo });
        return result;
    }
    async initiateSwiftPay(body) {
        return this.paymentService.initiateSwiftPayment(body);
    }
    async initiatePayment(body) {
        return this.paymentService.initiateGkashPayment(body);
    }
    async handleGkashReturn(body, res) {
        const result = await this.paymentService.processGkashReturn(body);
        if (result.status === '88') {
            return res.redirect(`${this.paymentService.getFrontendUrl()}/payment/success?order=${result.orderId}&ref=${result.transactionId}`);
        }
        else {
            return res.redirect(`${this.paymentService.getFrontendUrl()}/payment/failed?order=${result.orderId}&reason=${encodeURIComponent(result.statusMessage || 'Payment failed')}`);
        }
    }
    async handleGkashReturnGet(query, res) {
        const result = await this.paymentService.processGkashReturn(query);
        if (result.status === '88') {
            return res.redirect(`${this.paymentService.getFrontendUrl()}/payment/success?order=${result.orderId}&ref=${result.transactionId}`);
        }
        else {
            return res.redirect(`${this.paymentService.getFrontendUrl()}/payment/failed?order=${result.orderId}&reason=${encodeURIComponent(result.statusMessage || 'Payment failed')}`);
        }
    }
    async handleGkashCallback(body) {
        return this.paymentService.processGkashCallback(body);
    }
};
exports.PaymentController = PaymentController;
__decorate([
    (0, common_1.Get)('return'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, typeof (_a = typeof express_1.Response !== "undefined" && express_1.Response) === "function" ? _a : Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "handleOssPayReturn", null);
__decorate([
    (0, common_1.Post)('return'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, typeof (_b = typeof express_1.Response !== "undefined" && express_1.Response) === "function" ? _b : Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "handleOssPayReturnPost", null);
__decorate([
    (0, common_1.Post)('poll/:refNo'),
    __param(0, (0, common_1.Param)('refNo')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "startPolling", null);
__decorate([
    (0, common_1.Get)('check/:refNo'),
    __param(0, (0, common_1.Param)('refNo')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "checkPayment", null);
__decorate([
    (0, common_1.Post)('swiftpay/initiate'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "initiateSwiftPay", null);
__decorate([
    (0, common_1.Post)('initiate'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "initiatePayment", null);
__decorate([
    (0, common_1.Post)('gkash/return'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, typeof (_c = typeof express_1.Response !== "undefined" && express_1.Response) === "function" ? _c : Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "handleGkashReturn", null);
__decorate([
    (0, common_1.Get)('gkash/return'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, typeof (_d = typeof express_1.Response !== "undefined" && express_1.Response) === "function" ? _d : Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "handleGkashReturnGet", null);
__decorate([
    (0, common_1.Post)('gkash/callback'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "handleGkashCallback", null);
exports.PaymentController = PaymentController = PaymentController_1 = __decorate([
    (0, common_1.Controller)('payment'),
    __metadata("design:paramtypes", [payment_service_1.PaymentService])
], PaymentController);
//# sourceMappingURL=payment.controller.js.map