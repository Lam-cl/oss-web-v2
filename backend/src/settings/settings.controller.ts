import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('settings')
export class SettingsController {
  constructor(private config: ConfigService) {}

  @Get()
  getSettings() {
    return {
      showDevices: this.config.get('SHOW_DEVICES', 'false') === 'true',
      showMerchandise: this.config.get('SHOW_MERCHANDISE', 'false') === 'true',
      simBasePrice: parseFloat(this.config.get('SIM_BASE_PRICE', '19.50')),
    };
  }
}
