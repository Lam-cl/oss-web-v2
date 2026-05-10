import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly templateName: string;
  private readonly templateLanguage: string;
  private readonly apiVersion = 'v22.0';

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.token = this.configService.get('WABA_TOKEN', '');
    this.phoneNumberId = this.configService.get('WABA_PHONE_NUMBER_ID', '');
    this.templateName = this.configService.get('WABA_TEMPLATE_NAME', 'tonewow_order_success');
    this.templateLanguage = this.configService.get('WABA_TEMPLATE_LANGUAGE', 'ms');
  }

  /**
   * Format Malaysian phone number to WhatsApp format (601XXXXXXXX)
   */
  private formatPhone(phone: string): string {
    // Remove all non-digits
    let num = phone.replace(/\D/g, '');
    // Remove leading 0, add 60
    if (num.startsWith('60')) return num;
    if (num.startsWith('0')) return '60' + num.slice(1);
    return '60' + num;
  }

  /**
   * Send order confirmation template message
   * Template: tonewow_order_success
   * {{1}} = customer name, {{2}} = refNo
   */
  async sendOrderConfirmation(phone: string, customerName: string, refNo: string): Promise<boolean> {
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
      const { data } = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      const msgId = data?.messages?.[0]?.id;
      this.logger.log(`WhatsApp sent to ${formattedPhone}, msgId: ${msgId}, refNo: ${refNo}`);
      return true;
    } catch (error) {
      const errData = error?.response?.data;
      this.logger.error(`WhatsApp send failed for ${formattedPhone}: ${JSON.stringify(errData || error.message)}`);
      return false;
    }
  }
}
