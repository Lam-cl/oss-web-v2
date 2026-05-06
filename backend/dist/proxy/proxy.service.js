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
exports.ProxyService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
const ALLOWED_HOSTS = ['tonewow.net', 'bundleapi.tonewow.com'];
let ProxyService = class ProxyService {
    constructor(httpService, configService) {
        this.httpService = httpService;
        this.configService = configService;
    }
    validateUrl(url) {
        if (!url)
            throw new common_1.BadRequestException('Missing url parameter');
        try {
            const parsed = new URL(url);
            const isAllowed = ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
            if (!isAllowed) {
                throw new common_1.ForbiddenException(`Host not allowed: ${parsed.hostname}`);
            }
        }
        catch (e) {
            if (e instanceof common_1.ForbiddenException || e instanceof common_1.BadRequestException)
                throw e;
            throw new common_1.BadRequestException('Invalid URL');
        }
    }
    async proxyGet(url) {
        this.validateUrl(url);
        const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.get(url, {
            headers: {
                Accept: 'application/json',
                Referer: 'https://shop.tonewow.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        }));
        return data;
    }
    async proxyPost(url, body) {
        this.validateUrl(url);
        try {
            const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.post(url, body, {
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Referer: 'https://shop.tonewow.com/',
                },
            }));
            return data;
        }
        catch (err) {
            if (err?.response?.data) {
                return err.response.data;
            }
            throw err;
        }
    }
};
exports.ProxyService = ProxyService;
exports.ProxyService = ProxyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService])
], ProxyService);
//# sourceMappingURL=proxy.service.js.map