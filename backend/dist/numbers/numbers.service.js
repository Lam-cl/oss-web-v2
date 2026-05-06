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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NumbersService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
const PLAN_MAP = {
    1: { category: 'PREMIUM', price: 988, label: 'PREMIUM' },
    2: { category: 'VIP', price: 2298, label: 'VIP' },
    3: { category: 'VVIP', price: 3088, label: 'VVIP' },
};
let NumbersService = class NumbersService {
    constructor(httpService, configService) {
        this.httpService = httpService;
        this.configService = configService;
        this.legacyApiUrl = this.configService.get('LEGACY_API_URL', 'https://www.tonewow.net/tgpayment');
    }
    formatPhoneNumber(phoneNo) {
        let local = phoneNo.startsWith('60')
            ? '0' + phoneNo.substring(2)
            : phoneNo;
        if (local.length === 11) {
            return `${local.substring(0, 3)}-${local.substring(3, 7)} ${local.substring(7)}`;
        }
        if (local.length === 12) {
            return `${local.substring(0, 4)}-${local.substring(4, 8)} ${local.substring(8)}`;
        }
        return local;
    }
    async searchSpecialNumbers(digits) {
        const promises = [1, 2, 3].map(async (planId) => {
            try {
                const url = `${this.legacyApiUrl}/getVipPremiumNumber?planId=${planId}&phoneNo=${encodeURIComponent(digits)}`;
                const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.get(url, {
                    headers: {
                        Accept: 'application/json',
                        Referer: 'https://shop.tonewow.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                }));
                if (data.systemCode === '0' &&
                    Array.isArray(data.data) &&
                    data.data.length > 0) {
                    const plan = PLAN_MAP[planId];
                    return data.data.map((phoneNo) => ({
                        phoneNo,
                        displayNo: this.formatPhoneNumber(phoneNo),
                        planId,
                        category: plan.category,
                        price: plan.price,
                        label: plan.label,
                    }));
                }
                return [];
            }
            catch {
                return [];
            }
        });
        const results = await Promise.all(promises);
        const merged = results.flat();
        const priority = { VVIP: 0, VIP: 1, PREMIUM: 2 };
        merged.sort((a, b) => priority[a.category] - priority[b.category]);
        return merged;
    }
};
exports.NumbersService = NumbersService;
exports.NumbersService = NumbersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService])
], NumbersService);
//# sourceMappingURL=numbers.service.js.map