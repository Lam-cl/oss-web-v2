import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface NumberResult {
  phoneNo: string;
  displayNo: string;
  planId: number;
  category: string;
  price: number;
  label: string;
}

const PLAN_MAP = {
  1: { category: 'PREMIUM', price: 988, label: 'PREMIUM' },
  2: { category: 'VIP', price: 2298, label: 'VIP' },
  3: { category: 'VVIP', price: 3088, label: 'VVIP' },
};

@Injectable()
export class NumbersService {
  private legacyApiUrl: string;

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.legacyApiUrl = this.configService.get(
      'LEGACY_API_URL',
      'https://www.tonewow.net/tgpayment',
    );
  }

  private formatPhoneNumber(phoneNo: string): string {
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

  async searchSpecialNumbers(digits: string): Promise<NumberResult[]> {
    const promises = [1, 2, 3].map(async (planId) => {
      try {
        const url = `${this.legacyApiUrl}/getVipPremiumNumber?planId=${planId}&phoneNo=${encodeURIComponent(digits)}`;
        const { data } = await firstValueFrom(
          this.httpService.get(url, {
            headers: {
              Accept: 'application/json',
              Referer: 'https://shop.tonewow.com/',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          }),
        );

        if (
          data.systemCode === '0' &&
          Array.isArray(data.data) &&
          data.data.length > 0
        ) {
          const plan = PLAN_MAP[planId];
          return data.data.map((phoneNo: string) => ({
            phoneNo,
            displayNo: this.formatPhoneNumber(phoneNo),
            planId,
            category: plan.category,
            price: plan.price,
            label: plan.label,
          }));
        }
        return [];
      } catch {
        return [];
      }
    });

    const results = await Promise.all(promises);
    const merged = results.flat();

    // Sort: VVIP first, then VIP, then PREMIUM
    const priority = { VVIP: 0, VIP: 1, PREMIUM: 2 };
    merged.sort((a, b) => priority[a.category] - priority[b.category]);

    return merged;
  }
}
