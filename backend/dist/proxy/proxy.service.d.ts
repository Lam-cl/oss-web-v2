import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
export declare class ProxyService {
    private httpService;
    private configService;
    constructor(httpService: HttpService, configService: ConfigService);
    private validateUrl;
    proxyGet(url: string): Promise<any>;
    proxyPost(url: string, body: any): Promise<any>;
}
