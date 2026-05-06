import { ProxyService } from './proxy.service';
export declare class ProxyController {
    private readonly proxyService;
    constructor(proxyService: ProxyService);
    proxyGet(url: string): Promise<any>;
    proxyPost(url: string, body: any): Promise<any>;
}
