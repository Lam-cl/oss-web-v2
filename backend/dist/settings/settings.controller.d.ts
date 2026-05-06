import { ConfigService } from '@nestjs/config';
export declare class SettingsController {
    private config;
    constructor(config: ConfigService);
    getSettings(): {
        showDevices: boolean;
        showMerchandise: boolean;
        simBasePrice: number;
    };
}
