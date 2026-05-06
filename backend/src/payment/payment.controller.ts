import { Controller, Post, Body, Get, Query, Param, Res, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { PaymentService } from './payment.service';

@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * OSSPayment return URL — called after customer pays on osspay.jsp
   * Handles 3-checkpoint payment success detection
   */
  @Get('return')
  async handleOssPayReturn(@Query() query: any, @Res() res: Response) {
    this.logger.log(`OSS return GET: ${JSON.stringify(query)}`);
    const result = await this.paymentService.processPaymentReturn(query);
    const frontendUrl = this.paymentService.getFrontendUrl();

    if (result.alreadyProcessed || result.success) {
      return res.redirect(`${frontendUrl}/sim/purchase/success?refNo=${encodeURIComponent(result.refNo)}&source=${result.source}`);
    }
    return res.redirect(`${frontendUrl}/sim/purchase/failed?refNo=${encodeURIComponent(result.refNo)}`);
  }

  @Post('return')
  async handleOssPayReturnPost(@Body() body: any, @Res() res: Response) {
    this.logger.log(`OSS return POST: ${JSON.stringify(body)}`);
    const result = await this.paymentService.processPaymentReturn(body);
    const frontendUrl = this.paymentService.getFrontendUrl();

    if (result.alreadyProcessed || result.success) {
      return res.redirect(`${frontendUrl}/sim/purchase/success?refNo=${encodeURIComponent(result.refNo)}&source=${result.source}`);
    }
    return res.redirect(`${frontendUrl}/sim/purchase/failed?refNo=${encodeURIComponent(result.refNo)}`);
  }

  /**
   * Start background polling for a refNo — called by frontend after redirect to osspay.jsp
   */
  @Post('poll/:refNo')
  async startPolling(@Param('refNo') refNo: string) {
    this.logger.log(`Starting payment poll for refNo: ${refNo}`);
    this.paymentService.startPaymentPolling(refNo);
    return { success: true, message: 'Polling started' };
  }

  /**
   * Manual check — check payment status for a refNo on demand
   */
  @Get('check/:refNo')
  async checkPayment(@Param('refNo') refNo: string) {
    const result = await this.paymentService.processPaymentReturn({ refNo });
    return result;
  }

  @Post('swiftpay/initiate')
  async initiateSwiftPay(@Body() body: any) {
    return this.paymentService.initiateSwiftPayment(body);
  }

  @Post('initiate')
  async initiatePayment(@Body() body: {
    orderId: string;
    amount: number;
    customerName: string;
    customerEmail: string;
    description?: string;
  }) {
    return this.paymentService.initiateGkashPayment(body);
  }

  @Post('gkash/return')
  async handleGkashReturn(@Body() body: any, @Res() res: Response) {
    const result = await this.paymentService.processGkashReturn(body);
    if (result.status === '88') {
      // Payment success
      return res.redirect(
        `${this.paymentService.getFrontendUrl()}/payment/success?order=${result.orderId}&ref=${result.transactionId}`,
      );
    } else {
      // Payment failed
      return res.redirect(
        `${this.paymentService.getFrontendUrl()}/payment/failed?order=${result.orderId}&reason=${encodeURIComponent(result.statusMessage || 'Payment failed')}`,
      );
    }
  }

  @Get('gkash/return')
  async handleGkashReturnGet(@Query() query: any, @Res() res: Response) {
    // Some GKash versions redirect via GET
    const result = await this.paymentService.processGkashReturn(query);
    if (result.status === '88') {
      return res.redirect(
        `${this.paymentService.getFrontendUrl()}/payment/success?order=${result.orderId}&ref=${result.transactionId}`,
      );
    } else {
      return res.redirect(
        `${this.paymentService.getFrontendUrl()}/payment/failed?order=${result.orderId}&reason=${encodeURIComponent(result.statusMessage || 'Payment failed')}`,
      );
    }
  }

  @Post('gkash/callback')
  async handleGkashCallback(@Body() body: any) {
    return this.paymentService.processGkashCallback(body);
  }
}
