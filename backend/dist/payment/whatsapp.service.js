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
var WhatsAppService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("@nestjs/axios");
const rxjs_1 = require("rxjs");
let WhatsAppService = WhatsAppService_1 = class WhatsAppService {
    constructor(configService, httpService) {
        this.configService = configService;
        this.httpService = httpService;
        this.logger = new common_1.Logger(WhatsAppService_1.name);
        this.apiVersion = 'v22.0';
        this.token = this.configService.get('WABA_TOKEN', '');
        this.phoneNumberId = this.configService.get('WABA_PHONE_NUMBER_ID', '');
        this.templateName = this.configService.get('WABA_TEMPLATE_NAME', 'tonewow_order_success');
        this.templateLanguage = this.configService.get('WABA_TEMPLATE_LANGUAGE', 'ms');
    }
    formatPhone(phone) {
        let num = phone.replace(/\D/g, '');
        if (num.startsWith('60'))
            return num;
        if (num.startsWith('0'))
            return '60' + num.slice(1);
        return '60' + num;
    }
    async sendOrderConfirmation(phone, customerName, refNo) {
        if (!this.token || !this.phoneNumberId) {
            this.logger.warn('WhatsApp credentials not configured');
            return false;
        }
        const formattedPhone = this.formatPhone(phone);
        const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
        const payload = {
            messaging_product: 'whatsapp',
            to: formattedPhone,
            type: 'template',
            template: {
                name: this.templateName,
                language: { code: this.templateLanguage },
                components: [
                    {
                        type: 'header',
                        parameters: [
                            {
                                type: 'image',
                                image: { link: this.configService.get('WABA_HEADER_IMAGE', 'https://xbot.xifuhalim.com/uploads/tonewow/order_confirmation_header.jpeg') },
                            },
                        ],
                    },
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: customerName },
                            { type: 'text', text: refNo },
                        ],
                    },
                ],
            },
        };
        try {
            const { data } = await (0, rxjs_1.firstValueFrom)(this.httpService.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
            }));
            const msgId = data?.messages?.[0]?.id;
            this.logger.log(`WhatsApp sent to ${formattedPhone}, msgId: ${msgId}, refNo: ${refNo}`);
            return true;
        }
        catch (error) {
            const errData = error?.response?.data;
            this.logger.error(`WhatsApp send failed for ${formattedPhone}: ${JSON.stringify(errData || error.message)}`);
            return false;
        }
    }
};
exports.WhatsAppService = WhatsAppService;
exports.WhatsAppService = WhatsAppService = WhatsAppService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        axios_1.HttpService])
], WhatsAppService);
//# sourceMappingURL=whatsapp.service.js.map