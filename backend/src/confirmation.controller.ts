import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

@Controller('confirmation')
export class ConfirmationController {
  private getValue(query: any, body: any, key: string) {
    return query[key] ?? body[key] ?? '';
  }

  private hasEsimDetails(query: any, body: any = {}) {
    return ['simserial', 'esimQR', 'puk1', 'pin1', 'puk2', 'pin2']
      .some((key) => this.getValue(query, body, key));
  }

  private redirectToEsimSuccess(req: Request, res: Response, query: any, body: any = {}) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const baseUrl = `${proto}://${host}`;
    const url = new URL('/sim/esim-success', baseUrl);
    const refno = query.refno || body.refno || body.cartid || body.refNo || '';
    const locale = query.locale || body.locale || 'en';

    if (refno) url.searchParams.set('refno', String(refno));
    url.searchParams.set('locale', String(locale));

    ['simserial', 'esimQR', 'puk1', 'pin1', 'puk2', 'pin2'].forEach((key) => {
      const value = this.getValue(query, body, key);
      if (value) url.searchParams.set(key, String(value));
    });

    return res.redirect(303, url.toString());
  }

  private redirectToThankYou(req: Request, res: Response, query: any, body: any = {}) {
    const refno = query.refno || body.refno || body.cartid || body.refNo || '';
    const locale = query.locale || body.locale || 'en';
    const status = query.status || body.status || '';
    const description = query.description || body.description || body.desc || '';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const baseUrl = `${proto}://${host}`;
    const url = new URL('/thank-you', baseUrl);

    if (refno) url.searchParams.set('refno', String(refno));
    url.searchParams.set('locale', String(locale));
    if (status) url.searchParams.set('status', String(status));
    if (description) url.searchParams.set('desc', String(description));

    return res.redirect(303, url.toString());
  }

  @Get()
  handleGet(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    if (this.hasEsimDetails(query)) {
      return this.redirectToEsimSuccess(req, res, query);
    }
    return this.redirectToThankYou(req, res, query);
  }

  @Post()
  handlePost(@Req() req: Request, @Res() res: Response, @Query() query: any, @Body() body: any) {
    if (this.hasEsimDetails(query, body)) {
      return this.redirectToEsimSuccess(req, res, query, body);
    }
    return this.redirectToThankYou(req, res, query, body);
  }
}
