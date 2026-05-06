import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
export interface NumberResult {
    phoneNo: string;
    displayNo: string;
    planId: number;
    category: string;
    price: number;
    label: string;
}
export declare class NumbersService {
    private httpService;
    private configService;
    private legacyApiUrl;
    constructor(httpService: HttpService, configService: ConfigService);
    private formatPhoneNumber;
    searchSpecialNumbers(digits: string): Promise<NumberResult[]>;
}
