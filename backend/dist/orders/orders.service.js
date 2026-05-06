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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
const order_entity_1 = require("./order.entity");
let OrdersService = class OrdersService {
    constructor(orderRepo, httpService, configService) {
        this.orderRepo = orderRepo;
        this.httpService = httpService;
        this.configService = configService;
        this.bundleApiUrl = this.configService.get('BUNDLE_API_URL', 'https://bundleapi.tonewow.com/api');
    }
    generateOrderNumber() {
        const now = new Date();
        const prefix = 'TW';
        const date = now.toISOString().slice(0, 10).replace(/-/g, '');
        const rand = Math.floor(Math.random() * 10000)
            .toString()
            .padStart(4, '0');
        return `${prefix}${date}${rand}`;
    }
    async create(dto) {
        const order = this.orderRepo.create({
            ...dto,
            order_number: this.generateOrderNumber(),
            subtotal: dto.total,
            shipping_cost: dto.shipping || 0,
            status: 'pending',
        });
        return this.orderRepo.save(order);
    }
    async findByOrderNumber(orderNumber) {
        const order = await this.orderRepo.findOne({
            where: { order_number: orderNumber },
        });
        if (!order)
            throw new common_1.NotFoundException('Order not found');
        return order;
    }
    async findById(id) {
        const order = await this.orderRepo.findOne({ where: { id } });
        if (!order)
            throw new common_1.NotFoundException('Order not found');
        return order;
    }
    async guestCheckout(orderData) {
        try {
            const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${this.bundleApiUrl}/payment/initiate-with-order-guest`, orderData, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Referer: 'https://shop.tonewow.com/',
                },
            }));
            return data;
        }
        catch (error) {
            return { error: true, message: error.message };
        }
    }
    async initiatePayment(paymentData) {
        try {
            const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${this.bundleApiUrl}/payment/gkash/initiate`, paymentData, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
            }));
            return data;
        }
        catch (error) {
            return { error: true, message: error.message };
        }
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        axios_1.HttpService,
        config_1.ConfigService])
], OrdersService);
//# sourceMappingURL=orders.service.js.map