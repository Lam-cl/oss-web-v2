import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { ProxyService } from './proxy.service';

@Controller('proxy')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Get()
  async proxyGet(@Query('url') url: string) {
    return this.proxyService.proxyGet(url);
  }

  @Post()
  async proxyPost(@Query('url') url: string, @Body() body: any) {
    return this.proxyService.proxyPost(url, body);
  }
}
