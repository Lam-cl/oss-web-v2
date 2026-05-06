import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

const ALLOWED_HOSTS = ['tonewow.net', 'bundleapi.tonewow.com'];

@Injectable()
export class ProxyService {
  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  private validateUrl(url: string): void {
    if (!url) throw new BadRequestException('Missing url parameter');

    try {
      const parsed = new URL(url);
      const isAllowed = ALLOWED_HOSTS.some(
        (h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h),
      );
      if (!isAllowed) {
        throw new ForbiddenException(`Host not allowed: ${parsed.hostname}`);
      }
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof BadRequestException) throw e;
      throw new BadRequestException('Invalid URL');
    }
  }

  async proxyGet(url: string): Promise<any> {
    this.validateUrl(url);
    const { data } = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          Accept: 'application/json',
          Referer: 'https://shop.tonewow.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }),
    );
    return data;
  }

  async proxyPost(url: string, body: any): Promise<any> {
    this.validateUrl(url);
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, body, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Referer: 'https://shop.tonewow.com/',
          },
        }),
      );
      return data;
    } catch (err: any) {
      // Return error response body instead of throwing (e.g. 422 from external API)
      if (err?.response?.data) {
        return err.response.data;
      }
      throw err;
    }
  }
}
