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

  private isAdx(query: any, body: any = {}) {
    const flow = String(this.getValue(query, body, 'flow')).toLowerCase();
    const prodDesc = String(
      this.getValue(query, body, 'prodDesc')
      || this.getValue(query, body, 'proddesc')
      || this.getValue(query, body, 'PRODDESC'),
    ).toLowerCase();
    return flow === 'adx' || prodDesc === 'osspaymentadx';
  }

  private isEsim(query: any, body: any = {}) {
    const esim = String(
      this.getValue(query, body, 'esim')
      || this.getValue(query, body, 'isEsim'),
    ).toLowerCase();
    return esim === '1' || esim === 'true' || String(this.getValue(query, body, 'flow')).toLowerCase() === 'esim';
  }

  private redirectToEsimSuccess(req: Request, res: Response, query: any, body: any = {}) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const baseUrl = `${proto}://${host}`;
    const url = new URL(this.isAdx(query, body) ? '/adx/esim-success' : '/sim/esim-success', baseUrl);
    const refno = query.refno || body.refno || body.cartid || body.refNo || '';
    const locale = query.locale || body.locale || 'en';
    const refctx = query.refctx || body.refctx || '';

    if (refno) url.searchParams.set('refno', String(refno));
    url.searchParams.set('locale', String(locale));
    if (refctx) url.searchParams.set('refctx', String(refctx));

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
    const refctx = query.refctx || body.refctx || '';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const baseUrl = `${proto}://${host}`;
    const url = new URL(this.isAdx(query, body) ? '/adx/thank-you' : '/thank-you', baseUrl);

    if (refno) url.searchParams.set('refno', String(refno));
    url.searchParams.set('locale', String(locale));
    if (this.isEsim(query, body)) url.searchParams.set('esim', '1');
    if (refctx) url.searchParams.set('refctx', String(refctx));
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

  @Get('esim')
  handleEsimGet(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    if (this.hasEsimDetails(query)) {
      return this.redirectToEsimSuccess(req, res, query);
    }
    return this.redirectToThankYou(req, res, { ...query, esim: '1' });
  }

  @Post()
  handlePost(@Req() req: Request, @Res() res: Response, @Query() query: any, @Body() body: any) {
    if (this.hasEsimDetails(query, body)) {
      return this.redirectToEsimSuccess(req, res, query, body);
    }
    return this.redirectToThankYou(req, res, query, body);
  }

  @Post('esim')
  handleEsimPost(@Req() req: Request, @Res() res: Response, @Query() query: any, @Body() body: any) {
    if (this.hasEsimDetails(query, body)) {
      return this.redirectToEsimSuccess(req, res, query, body);
    }
    return this.redirectToThankYou(req, res, query, { ...body, esim: '1' });
  }
}
