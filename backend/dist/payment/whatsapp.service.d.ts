import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
export declare class WhatsAppService {
    private configService;
    private httpService;
    private readonly logger;
    private readonly token;
    private readonly phoneNumberId;
    private readonly templateName;
    private readonly templateLanguage;
    private readonly apiVersion;
    constructor(configService: ConfigService, httpService: HttpService);
    private formatPhone;
    sendOrderConfirmation(phone: string, customerName: string, refNo: string): Promise<boolean>;
}
